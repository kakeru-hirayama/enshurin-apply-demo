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
      ensure(table).push(row);
      return row;
    },

    /** まとめて足す。移行や初期投入で使う */
    insertMany: function (table, rows) {
      var t = ensure(table);
      rows.forEach(function (r) { t.push(r); });
      return rows.length;
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
    reset: function () { db = {}; },

    /** 開発用。中身を丸ごと見る */
    dump: function () { return db; }
  };
})();
