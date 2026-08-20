/**
 * adapter_sheets.js  データ層のアダプタ（本番用・Google スプレッドシート）
 *
 * ★adapter_memory.js と同じ関数を、同じ形で持つ。
 *   API層はどちらが動いているかを知らない。
 *   api.js の1行を書き換えるだけで、保存先が切り替わる。
 *
 * このファイルは Google Apps Script の上で動く。
 * ブラウザでは動かない（SpreadsheetApp が存在しないため）。
 *
 * ------------------------------------------------------------------
 * スプレッドシートの持ち方
 *
 *   本体のブック      M3〜M6・T1〜T8 を、1シート1テーブルで持つ
 *   個人情報のブック  M1・M2 だけを別のブックに分ける
 *                     ★アクセス権を分けるため。職員でも通常は開けない
 *
 *   1行目が見出し。日本語で書く。開いた人がそのまま読めるようにする。
 *   コードの側は英語のキーを使い、その対応は schema.js が持つ。
 * ------------------------------------------------------------------
 */

var SheetsAdapter = (function () {

  // スクリプトプロパティに入れておくID。コードに直接書かない。
  //   MAIN_BOOK_ID      本体のブック
  //   PERSONAL_BOOK_ID  個人情報のブック
  var PERSONAL_TABLES = { M_USER: true, M_STAFF: true };

  var cache = {};   // 同じ実行の中では読み直さない

  function prop(key) {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    if (!v) throw new Error('スクリプトプロパティ ' + key + ' が設定されていません');
    return v;
  }

  function bookOf(table) {
    var id = PERSONAL_TABLES[table] ? prop('PERSONAL_BOOK_ID') : prop('MAIN_BOOK_ID');
    return SpreadsheetApp.openById(id);
  }

  function sheetOf(table) {
    var def = SCHEMA[table];
    if (!def) throw new Error('未定義の表　' + table);
    var sh = bookOf(table).getSheetByName(def.sheet);
    if (!sh) throw new Error('シートがありません　' + def.sheet);
    return sh;
  }

  /** 値を、その項目の型に応じて読める形に直す */
  function fromCell(v, col) {
    if (v === '' || v === null || v === undefined) return '';
    if (col.type === 'date' && v instanceof Date) {
      return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
    }
    if (col.type === 'datetime' && v instanceof Date) {
      return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    }
    if (col.type === 'bool') return (v === true || v === 'TRUE' || v === '○');
    if (col.type === 'number') return (v === '') ? null : Number(v);
    if (col.type === 'list') {
      return String(v).split('／').filter(function (x) { return x; });
    }
    return v;
  }

  /** 書き込むときの形に直す */
  function toCell(v, col) {
    if (v === undefined || v === null) return '';
    if (col.type === 'bool') return v ? true : false;
    if (col.type === 'list') return Array.isArray(v) ? v.join('／') : v;
    return v;
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

  /** シート全体を読み、行のオブジェクトの配列にして返す */
  function load(table) {
    if (cache[table]) return cache[table];

    var def = SCHEMA[table];
    var sh = sheetOf(table);
    var last = sh.getLastRow();
    if (last < 2) { cache[table] = []; return []; }

    var values = sh.getRange(1, 1, last, def.columns.length).getValues();
    var header = values[0];

    // 見出しの位置から、項目の並びを決める。
    // ★列を入れ替えても壊れないようにするため、位置は固定にしない。
    var indexOf = {};
    def.columns.forEach(function (c) {
      var i = header.indexOf(c.label);
      indexOf[c.key] = (i >= 0) ? i : -1;
    });

    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var raw = values[r];
      if (raw.join('') === '') continue;      // 空行は飛ばす
      var obj = { _row: r + 1 };              // 書き換えのために行番号を持つ
      def.columns.forEach(function (c) {
        var i = indexOf[c.key];
        obj[c.key] = (i >= 0) ? fromCell(raw[i], c) : '';
      });
      rows.push(obj);
    }
    cache[table] = rows;
    return rows;
  }

  function rowToArray(table, row) {
    return SCHEMA[table].columns.map(function (c) {
      return toCell(row[c.key], c);
    });
  }

  return {
    name: 'sheets',

    readAll: function (table) {
      return load(table).map(function (r) {
        var c = {};
        for (var k in r) if (k !== '_row') c[k] = r[k];
        return c;
      });
    },

    findByKey: function (table, key) {
      var want = keyFromArg(key);
      var rows = load(table);
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(table, rows[i]) === want) {
          var c = {};
          for (var k in rows[i]) if (k !== '_row') c[k] = rows[i][k];
          return c;
        }
      }
      return null;
    },

    insert: function (table, row) {
      var sh = sheetOf(table);
      sh.appendRow(rowToArray(table, row));
      delete cache[table];
      return row;
    },

    /** まとめて足す。1行ずつ appendRow するより格段に速い */
    insertMany: function (table, rows) {
      if (!rows.length) return 0;
      var sh = sheetOf(table);
      var start = sh.getLastRow() + 1;
      var values = rows.map(function (r) { return rowToArray(table, r); });
      sh.getRange(start, 1, values.length, values[0].length).setValues(values);
      delete cache[table];
      return rows.length;
    },

    update: function (table, key, patch) {
      var want = keyFromArg(key);
      var rows = load(table);
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(table, rows[i]) === want) {
          for (var k in patch) rows[i][k] = patch[k];
          var sh = sheetOf(table);
          var arr = rowToArray(table, rows[i]);
          sh.getRange(rows[i]._row, 1, 1, arr.length).setValues([arr]);
          delete cache[table];
          return rows[i];
        }
      }
      return null;
    },

    remove: function (table, key) {
      var want = keyFromArg(key);
      var rows = load(table);
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(table, rows[i]) === want) {
          sheetOf(table).deleteRow(rows[i]._row);
          delete cache[table];
          return true;
        }
      }
      return false;
    },

    nextId: function (table, prefix) {
      var rows = load(table);
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

    /**
     * 鍵のない表の、n 番目の行だけを書き換える
     *
     * ★鍵のある表には update を使うこと。これは最後の手段。
     *   ログイン用の合言葉のように、
     *   同じ相手に何度も行を作る表には鍵が置けないため用意した。
     *
     * @param {string} table  表の名前
     * @param {number} index  readAll で返る配列の中の位置（0から）
     * @param {Object} patch  書き換える項目
     */
    updateAt: function (table, index, patch) {
      if (index < 0) return false;
      var sh = sheetOf(table);
      var cols = SCHEMA[table].columns;
      var r = index + 2;              // 1行目は見出し
      cols.forEach(function (c, j) {
        if (patch.hasOwnProperty(c.key)) {
          sh.getRange(r, j + 1).setValue(patch[c.key]);
        }
      });
      cache = {};
      return true;
    },

    /**
     * 鍵のない表の、n 番目の行を消す
     * ★後ろから順に消すこと。前から消すと位置がずれる。
     */
    removeAt: function (table, index) {
      if (index < 0) return false;
      sheetOf(table).deleteRow(index + 2);
      cache = {};
      return true;
    },

    /** 読み込みの結果を捨てる。書き込みの後に自動で呼ばれる */
    clearCache: function () { cache = {}; }
  };
})();


/* ==================================================================
   初期セットアップ
   ------------------------------------------------------------------
   スプレッドシートを新しく作るときに、1度だけ実行する。
   schema.js の定義どおりにシートと見出しを作る。

   ★手でシートを作らないこと。
     schema.js を直してこれを実行すれば、定義とシートが必ず一致する。
   ================================================================== */

function setupSheets() {
  var mainId = PropertiesService.getScriptProperties().getProperty('MAIN_BOOK_ID');
  var persId = PropertiesService.getScriptProperties().getProperty('PERSONAL_BOOK_ID');
  if (!mainId || !persId) {
    throw new Error('MAIN_BOOK_ID と PERSONAL_BOOK_ID をスクリプトプロパティに設定してください');
  }

  var main = SpreadsheetApp.openById(mainId);
  var pers = SpreadsheetApp.openById(persId);
  var personal = { M_USER: true, M_STAFF: true };
  var made = [];
  var warn = [];
  var NLC = String.fromCharCode(10);

  Object.keys(SCHEMA).forEach(function (table) {
    var def = SCHEMA[table];
    var book = personal[table] ? pers : main;
    var sh = book.getSheetByName(def.sheet) || book.insertSheet(def.sheet);

    var header = def.columns.map(function (c) { return c.label; });

    // ★すでにあるシートの見出しと比べる。
    //   定義の途中に項目を足すと、入っているデータが1列ずれる。
    //   見出しだけ書き換えると、ずれたことに誰も気づけない。
    var last = sh.getLastColumn();
    if (last > 0 && sh.getLastRow() > 1) {
      var before = sh.getRange(1, 1, 1, last).getValues()[0];
      var moved = [];
      for (var i = 0; i < Math.min(before.length, header.length); i++) {
        if (String(before[i]).trim() && String(before[i]).trim() !== header[i]) {
          moved.push((i + 1) + '列目　' + before[i] + ' → ' + header[i]);
        }
      }
      if (moved.length) {
        warn.push(def.sheet + '　すでに ' + (sh.getLastRow() - 1) +
                  ' 行入っている状態で、見出しが変わります' + NLC +
                  moved.map(function (x) { return '　　' + x; }).join(NLC));
      }
    }

    // 列が足りなければ足す
    if (sh.getMaxColumns() < header.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(),
                            header.length - sh.getMaxColumns());
    }

    sh.getRange(1, 1, 1, header.length).setValues([header]);

    var h = sh.getRange(1, 1, 1, header.length);
    h.setBackground('#1F3864').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);

    // 項目の説明を、見出しのメモとして残す
    def.columns.forEach(function (c, i) {
      var note = c.type + (c.required ? '（必須）' : '');
      if (c.options) note += '　選択肢　' + OPTIONS[c.options].join('／');
      if (c.ref) note += '　参照　' + SCHEMA[c.ref].sheet;
      if (c.note) note += '\n' + c.note;
      sh.getRange(1, i + 1).setNote(note);
    });

    made.push(def.sheet + '（' + header.length + '列）');
  });

  // 使わない既定のシートを消す
  [main, pers].forEach(function (b) {
    var s = b.getSheetByName('シート1') || b.getSheetByName('Sheet1');
    if (s && b.getSheets().length > 1) b.deleteSheet(s);
  });

  var out = '作成したシート' + NLC + made.join(NLC);

  if (warn.length) {
    // ★黙って進めない。ずれたことに気づけるのは、この瞬間だけ。
    out += NLC + NLC +
      '───────────────────────' + NLC +
      '★ご確認ください　列の並びが変わりました' + NLC +
      '───────────────────────' + NLC +
      warn.join(NLC) + NLC + NLC +
      'すでに入っているデータは動いていません。' + NLC +
      '見出しだけが変わったため、中身と見出しが食い違っている可能性があります。' + NLC +
      'シートを開いて確かめてください。';
  }

  Logger.log(out);
  return made;
}


/**
 * 動作の確認
 * セットアップの後に実行して、読み書きができることを確かめる。
 */
function testSheets() {
  API.useAdapter(SheetsAdapter);

  var id = API.saveApplication({
    forest_id: 'HKD',
    rep_user_id: 'U0001',
    rep_org: '動作確認',
    purpose: '書き込みの確認',
    category: '研究',
    date_from: '2026-09-01',
    date_to: '2026-09-03'
  });
  Logger.log('作成した申込ID　' + id);

  var a = API.getApplication(id);
  Logger.log('読み戻し　利用日 ' + a.days.length + '日　' + a.days.join(', '));

  var r = API.updateStatus(id, '審査中', 'S001', '動作確認');
  Logger.log('ステータス　' + JSON.stringify(r));

  Logger.log('操作ログ　' + API.getAudit({ target: id }).length + '件');
  return id;
}
