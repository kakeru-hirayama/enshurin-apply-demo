/**
 * adapter_memory.js  データ層のアダプタ（開発・デモ用）
 *
 * データをブラウザのメモリ上に持つ。画面の動きを確かめるためのもの。
 *
 * ★このファイルと adapter_sheets.js は、同じ関数を同じ形で持つ。
 *   API層はどちらが動いているかを知らない。
 *   本番に切り替えるときは、読み込むファイルを差し替えるだけでよい。
 *
 * 持つべき関数
 *   readAll(table)              その表の全行を配列で返す
 *   findByKey(table, key)       主キーで1行返す。無ければ null
 *   insert(table, row)          1行足す
 *   update(table, key, patch)   主キーで探して書き換える
 *   remove(table, key)          主キーで探して消す
 *   nextId(table, prefix)       新しいIDを作る
 */

var MemoryAdapter = (function () {

  var db = {};      // { 表名: [行, 行, ...] }

  function ensure(table) {
    if (!db[table]) db[table] = [];
    return db[table];
  }

  function keyOf(table, row) {
    var k = SCHEMA[table].key;
    if (!k) return null;
    if (Array.isArray(k)) return k.map(function (x) { return row[x]; }).join('');
    return row[k];
  }

  function keyFromArg(table, key) {
    return Array.isArray(key) ? key.join('') : key;
  }


  /**
   * 順番待ちの列
   * ★手元では1人しか使わないので、そのまま実行する。
   *   ここに同じ名前を用意しておくことで、
   *   API層は保存先の違いを気にしなくてよくなる。
   */
  function withLock(fn) { return fn(); }

  /**
   * 鍵が重なっていないかを確かめる
   *
   * ★鍵のある表に同じ鍵の行が2つできると、
   *   どちらが本当か分からなくなる。
   *   集計では二重に数えられ、更新では片方だけが直る。
   *
   *   実際、T_USAGE_DAY に同じ［申込ID・日付］の行があり、
   *   年報と月次の延べ人数が食い違っていた。
   *   （2026-08-20 に判明。AIC で624人の差）
   *
   *   入る前に止める。入ってからでは、どちらを消すか誰にも決められない。
   */
  function checkKeys(table, rows, existing) {
    var k = SCHEMA[table].key;
    if (!k) return;                      // 鍵のない表は素通り

    var keyOfRow = function (r) {
      return Array.isArray(k)
        ? k.map(function (x) { return r[x]; }).join('/')
        : r[k];
    };

    var have = {};
    (existing || []).forEach(function (r) { have[keyOfRow(r)] = true; });

    var dup = [];
    var inBatch = {};
    rows.forEach(function (r) {
      var key = keyOfRow(r);
      if (have[key] || inBatch[key]) {
        if (dup.indexOf(key) < 0) dup.push(key);
      }
      inBatch[key] = true;
    });

    if (dup.length) {
      // ★止めない。飛ばして、飛ばしたことを伝える。
      //
      //   はじめは例外にしていたが、それだと
      //   実データの移行が途中で止まってしまう。
      //   （2026-08-21　実績データの重複66件で実際に止まった）
      //
      //   重なった行は入れず、何件飛ばしたかをログに残す。
      //   入れてしまうより、入れずに知らせるほうがよい。
      var NLC = String.fromCharCode(10);
      var msg = SCHEMA[table].sheet + '　すでにある行を ' + dup.length +
                ' 件飛ばしました' + NLC +
                dup.slice(0, 3).map(function (x) { return '　・' + x; }).join(NLC) +
                (dup.length > 3 ? NLC + '　　ほか ' + (dup.length - 3) + ' 件' : '');
      try { Logger.log(msg); } catch (e) { /* ブラウザ側では出せない */ }
    }
    return dup;
  }

  /** 重なっている行を取り除く */
  function dropDuplicates(table, rows, existing) {
    var k = SCHEMA[table].key;
    if (!k) return rows;

    var keyOfRow = function (r) {
      return Array.isArray(k)
        ? k.map(function (x) { return r[x]; }).join('/')
        : r[k];
    };

    var have = {};
    (existing || []).forEach(function (r) { have[keyOfRow(r)] = true; });

    var out = [];
    rows.forEach(function (r) {
      var key = keyOfRow(r);
      if (have[key]) return;
      have[key] = true;
      out.push(r);
    });
    return out;
  }

  return {
    name: 'memory',

    /** 全行を返す。呼び出し側が書き換えても内部に影響しないよう複製する */
    readAll: function (table) {
      return ensure(table).map(function (r) {
        var c = {};
        for (var k in r) c[k] = r[k];
        return c;
      });
    },

    findByKey: function (table, key) {
      var want = keyFromArg(table, key);
      var rows = ensure(table);
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(table, rows[i]) === want) {
          var c = {};
          for (var k in rows[i]) c[k] = rows[i][k];
          return c;
        }
      }
      return null;
    },

    insert: function (table, row) {
      var t = ensure(table);
      if (dropDuplicates(table, [row], t).length === 0) {
        checkKeys(table, [row], t);      // ログに残すため
        return row;                       // すでにあるので、入れない
      }
      t.push(row);
      return row;
    },

    /**
     * まとめて足す。移行や初期投入で使う
     * ★すでにある行は飛ばす。止めない
     */
    insertMany: function (table, rows) {
      var t = ensure(table);
      checkKeys(table, rows, t);          // 何件重なるかをログに残す
      var use = dropDuplicates(table, rows, t);
      use.forEach(function (r) { t.push(r); });
      return use.length;
    },

    update: function (table, key, patch) {
      var want = keyFromArg(table, key);
      var rows = ensure(table);
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(table, rows[i]) === want) {
          for (var k in patch) rows[i][k] = patch[k];
          return rows[i];
        }
      }
      return null;
    },

    remove: function (table, key) {
      var want = keyFromArg(table, key);
      var rows = ensure(table);
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(table, rows[i]) === want) {
          rows.splice(i, 1);
          return true;
        }
      }
      return false;
    },

    /**
     * 新しいIDを作る
     *   申込ID   2026-HKD-0001   年度＋演習林＋連番
     *   その他   U0001 のような連番
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
      if (!prefix) return String(n);
      var width = (prefix.indexOf('-') >= 0) ? 4 : 4;
      return prefix + String('0000' + n).slice(-width);
    },

    /** 開発用。中身を空にする */
    withLock: withLock,
    reset: function () { db = {}; },

    /** 開発用。中身を丸ごと見る */
    dump: function () { return db; }
  };
})();
