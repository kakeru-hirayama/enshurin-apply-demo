/**
 * adapter_remote.js  データ層のアダプタ（ブラウザ側・サーバーに保存する）
 *
 * ■ 何をするものか
 *   画面のコードを書き換えずに、データの保存先をサーバーに移すためのもの。
 *
 *   起動時に、サーバーから全データを受け取って手元に持つ。
 *   読み取りは手元から返す（速い・書き換え不要）。
 *   書き込みは手元に反映しつつ、サーバーにも送る。
 *
 * ■ なぜこの形にするか
 *   Google Apps Script のサーバー呼び出しは非同期である。
 *   すべての読み取りを非同期にすると、画面のコードをすべて書き換えることになる。
 *
 *   年間の申込は約1000件、データは1.5MB程度。
 *   起動時に一度受け取ってしまえば、以後の読み取りは手元で済む。
 *   職員が1日に扱う件数を考えれば、この形で足りる。
 *
 * ■ 保存が失敗したとき
 *   手元には反映されているが、サーバーには届いていない状態になる。
 *   この状態を画面に伝えるため、onSyncError を呼ぶ。
 *   ★黙って失敗しないこと。入力が消えたように見えるのが最も困る。
 */

var RemoteAdapter = (function () {

  var db = {};          // 手元に持つデータ
  var pending = 0;      // サーバーへ送信中の件数
  var handlers = { onSyncStart: null, onSyncEnd: null, onSyncError: null };

  function ensure(table) {
    if (!db[table]) db[table] = [];
    return db[table];
  }

  function keyOf(table, row) {
    var k = SCHEMA[table].key;
    if (!k) return null;
    if (Array.isArray(k)) return k.map(function (x) { return row[x]; }).join('');
    return row[k];
  }

  function keyFromArg(key) {
    return Array.isArray(key) ? key.join('') : key;
  }

  function copy(r) {
    var c = {};
    for (var k in r) c[k] = r[k];
    return c;
  }

  /**
   * サーバーの関数を呼ぶ
   * Google Apps Script の上と、ふつうのWebサーバーの上の両方で動くようにする
   */
  function callServer(fn, args) {
    return new Promise(function (resolve, reject) {
      if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .rpc(fn, JSON.stringify(args || []), RemoteAdapter.token || '');
      } else if (typeof RemoteAdapter.endpoint === 'string') {
        fetch(RemoteAdapter.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fn: fn, args: args || [],
                                 token: RemoteAdapter.token || '' })
        }).then(function (r) { return r.json(); })
          .then(function (j) { j.ok ? resolve(j.result) : reject(new Error(j.error)); })
          .catch(reject);
      } else {
        reject(new Error('サーバーにつながっていません'));
      }
    });
  }

  /** 書き込みをサーバーへ送る。結果は待たない */
  function push(fn, args) {
    pending++;
    if (handlers.onSyncStart) handlers.onSyncStart(pending);
    callServer(fn, args)
      .then(function () {
        pending--;
        if (handlers.onSyncEnd) handlers.onSyncEnd(pending);
      })
      .catch(function (e) {
        pending--;
        if (handlers.onSyncError) handlers.onSyncError(e, fn, args);
        else console.error('保存できませんでした', fn, e);
      });
  }

  return {
    name: 'remote',
    endpoint: null,        // ふつうのWebサーバーで動かすときに設定する

    /** 画面から、同期の状態を受け取れるようにする */
    on: function (name, fn) { handlers[name] = fn; },
    pendingCount: function () { return pending; },

    /**
     * サーバーから全データを受け取る
     * ★画面はこれを待ってから描き始める
     */
    load: function () { return RemoteAdapter.reload(); },

    readAll: function (table) {
      return ensure(table).map(copy);
    },

    findByKey: function (table, key) {
      var want = keyFromArg(key);
      var rows = ensure(table);
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(table, rows[i]) === want) return copy(rows[i]);
      }
      return null;
    },

    insert: function (table, row) {
      ensure(table).push(row);
      push('insert', [table, row]);
      return row;
    },

    insertMany: function (table, rows) {
      var t = ensure(table);
      rows.forEach(function (r) { t.push(r); });
      push('insertMany', [table, rows]);
      return rows.length;
    },

    update: function (table, key, patch) {
      var want = keyFromArg(key);
      var rows = ensure(table);
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(table, rows[i]) === want) {
          for (var k in patch) rows[i][k] = patch[k];
          push('update', [table, key, patch]);
          return rows[i];
        }
      }
      return null;
    },

    remove: function (table, key) {
      var want = keyFromArg(key);
      var rows = ensure(table);
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(table, rows[i]) === want) {
          rows.splice(i, 1);
          push('remove', [table, key]);
          return true;
        }
      }
      return false;
    },

    /**
     * 新しいIDを作る
     * ★手元で作ると、同時に申し込まれたときに重なる可能性がある。
     *   IDの採番だけはサーバーに任せ、結果を待つ。
     */
    nextId: function (table, prefix) {
      var rows = ensure(table);
      var k = SCHEMA[table].key;
      if (Array.isArray(k) || !k) return String(rows.length + 1);
      var max = 0;
      rows.forEach(function (r) {
        var v = String(r[k] || '');
        if (prefix && v.indexOf(prefix) !== 0) return;
        var m = v.match(/(\d+)$/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
      var n = max + 1;
      return prefix ? (prefix + String('0000' + n).slice(-4)) : String(n);
    },

    /* ------------------------------------------------ ログインの印

       サーバーが発行した印を持ち、呼び出しのたびに添える。
       ★ここには「誰か」の判断を持たせない。
         誰かを決めるのはサーバーだけ。
         画面側の持ち物で判断すると、書き換えられてしまう。
    */
    token: null,

    /** 印を持つ。次に開いたときも続くよう、ブラウザにも控える */
    setToken: function (t) {
      RemoteAdapter.token = t || null;
      try {
        if (t) localStorage.setItem('enshurin_token', t);
        else localStorage.removeItem('enshurin_token');
      } catch (e) {
        // ブラウザの設定で使えないことがある。
        // その場合は、閉じるまでの間だけ有効になる。
      }
    },

    /** 前に開いたときの印を思い出す */
    restoreToken: function () {
      try {
        var t = localStorage.getItem('enshurin_token');
        if (t) RemoteAdapter.token = t;
        return t;
      } catch (e) { return null; }
    },

    /**
     * サーバーからデータを受け取る
     *
     * ★印が変わると見える範囲が変わるため、
     *   ログインし直したときは必ずここを通る。
     *
     *   受け取ったものの中に __me が入っている。
     *   これがサーバーの決めた「誰か」で、画面側の判断はこれに従う。
     */
    reload: function () {
      return callServer('loadAll', []).then(function (data) {
        db = (typeof data === 'string') ? JSON.parse(data) : data;

        var who = db.__me || null;
        delete db.__me;
        if (typeof Auth !== 'undefined' && Auth.adopt) Auth.adopt(who);

        return db;
      });
    },

    /** サーバーの関数を直に呼ぶ。ログインなど、表の読み書き以外に使う */
    call: function (fn, args) { return callServer(fn, args); },

    reset: function () { db = {}; },
    dump: function () { return db; }
  };
})();
