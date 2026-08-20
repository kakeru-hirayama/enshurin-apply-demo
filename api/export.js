/**
 * export.js  Excel と Word の書き出し
 *
 * 打ち合わせで確認したこと
 *   ・集計結果がWeb上にだけあると、職員の方が直せない
 *   ・現実的には Word か Excel で出せるのがよい
 *   ・年報の様式、本部への月次データは、現在の形のまま出す必要がある
 *
 * 外部のライブラリを使わずに作る。理由は2つ。
 *   ① 大学の環境で、外部から読み込むファイルに制限がかかる場合がある
 *   ② 引き継いだ人が、ライブラリの更新に追われないようにする
 *
 * 作り方
 *   Excel　SpreadsheetML（Excel 2003 XML）。Excelがそのまま開ける
 *   Word 　HTMLをWordの形式として渡す。Wordがそのまま開いて編集できる
 *   CSV 　 BOM付きUTF-8。Excelで文字化けしない
 */

var Exporter = (function () {

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /** ブラウザでファイルとして落とす */
  function download(filename, content, mime) {
    var blob = new Blob(['﻿' + content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ------------------------------------------------ Excel

  /**
   * Excel を作る
   * @param {Array} sheets [{ name, columns:[{label,width,align}], rows:[[...]] }]
   */
  function buildExcel(sheets, title) {
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' +
      ' xmlns:o="urn:schemas-microsoft-com:office:office"' +
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"' +
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
      '<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">' +
      '<Title>' + esc(title || '') + '</Title>' +
      '<Author>演習林 利用申込システム</Author></DocumentProperties>\n' +
      '<Styles>\n' +
      '<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/>' +
      '<Font ss:FontName="ＭＳ Ｐゴシック" ss:Size="10"/></Style>\n' +
      '<Style ss:ID="head"><Font ss:FontName="ＭＳ Ｐゴシック" ss:Size="10"' +
      ' ss:Bold="1" ss:Color="#FFFFFF"/>' +
      '<Interior ss:Color="#1F3864" ss:Pattern="Solid"/>' +
      '<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>' +
      '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>' +
      '</Borders></Style>\n' +
      '<Style ss:ID="title"><Font ss:FontName="ＭＳ Ｐゴシック" ss:Size="13"' +
      ' ss:Bold="1" ss:Color="#1F3864"/></Style>\n' +
      '<Style ss:ID="cell"><Alignment ss:Vertical="Top" ss:WrapText="1"/>' +
      '<Borders>' +
      '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>' +
      '<Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>' +
      '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>' +
      '</Borders></Style>\n' +
      '<Style ss:ID="num" ss:Parent="cell">' +
      '<Alignment ss:Horizontal="Right" ss:Vertical="Top"/></Style>\n' +
      '</Styles>\n';

    sheets.forEach(function (sh) {
      xml += '<Worksheet ss:Name="' + esc(sh.name) + '">\n<Table>\n';
      sh.columns.forEach(function (c) {
        xml += '<Column ss:Width="' + (c.width || 80) + '"/>\n';
      });

      if (sh.title) {
        xml += '<Row ss:Height="22"><Cell ss:StyleID="title"><Data ss:Type="String">' +
               esc(sh.title) + '</Data></Cell></Row>\n<Row/>\n';
      }

      xml += '<Row ss:Height="26">';
      sh.columns.forEach(function (c) {
        xml += '<Cell ss:StyleID="head"><Data ss:Type="String">' +
               esc(c.label) + '</Data></Cell>';
      });
      xml += '</Row>\n';

      sh.rows.forEach(function (r) {
        xml += '<Row>';
        r.forEach(function (v) {
          if (isNum(v)) {
            xml += '<Cell ss:StyleID="num"><Data ss:Type="Number">' + v + '</Data></Cell>';
          } else {
            xml += '<Cell ss:StyleID="cell"><Data ss:Type="String">' +
                   esc(v) + '</Data></Cell>';
          }
        });
        xml += '</Row>\n';
      });

      xml += '</Table>\n<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">' +
             '<FreezePanes/><FrozenNoSplit/><SplitHorizontal>' +
             (sh.title ? 3 : 1) + '</SplitHorizontal>' +
             '<TopRowBottomPane>' + (sh.title ? 3 : 1) + '</TopRowBottomPane>' +
             '<ActivePane>2</ActivePane></WorksheetOptions>\n</Worksheet>\n';
    });

    return xml + '</Workbook>';
  }

  // ------------------------------------------------ Word

  /**
   * Word を作る
   * HTMLをWordの形式として渡す。開いたあと、そのまま編集できる。
   */
  function buildWord(title, bodyHtml, landscape) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'xmlns="http://www.w3.org/TR/REC-html40">\n<head><meta charset="utf-8">\n' +
      '<title>' + esc(title) + '</title>\n' +
      '<!--[if gte mso 9]><xml><w:WordDocument>' +
      '<w:View>Print</w:View><w:Zoom>100</w:Zoom>' +
      '</w:WordDocument></xml><![endif]-->\n' +
      '<style>\n' +
      '@page{size:' + (landscape ? 'A4 landscape' : 'A4 portrait') +
      ';margin:18mm 16mm}\n' +
      'body{font-family:"ＭＳ 明朝",serif;font-size:10.5pt;line-height:1.7}\n' +
      'h1{font-family:"ＭＳ ゴシック",sans-serif;font-size:15pt;color:#1F3864;' +
      'margin:0 0 4pt}\n' +
      'h2{font-family:"ＭＳ ゴシック",sans-serif;font-size:12pt;color:#1F3864;' +
      'margin:14pt 0 5pt}\n' +
      '.sub{color:#555;font-size:9pt;margin:0 0 14pt}\n' +
      'table{border-collapse:collapse;width:100%;font-size:9pt}\n' +
      'th{background:#1F3864;color:#fff;padding:4pt 5pt;text-align:left;' +
      'font-family:"ＭＳ ゴシック",sans-serif;font-size:8.5pt}\n' +
      'td{border:0.5pt solid #BBB;padding:3pt 5pt;vertical-align:top}\n' +
      'td.num{text-align:right}\n' +
      '.foot{margin-top:14pt;font-size:8.5pt;color:#666}\n' +
      '</style></head>\n<body>' + bodyHtml + '</body></html>';
  }

  function tableHtml(columns, rows) {
    var h = '<table><thead><tr>' +
      columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>' + r.map(function (v) {
        return '<td' + (isNum(v) ? ' class="num"' : '') + '>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table>';
  }

  // ------------------------------------------------ 年報

  var NENPO_COLS = [
    { label: 'No', width: 28, key: 'no' },
    { label: '月', width: 28, key: 'month' },
    { label: '日数', width: 34, key: 'days' },
    { label: '利用者所属', width: 190, key: 'rep_org' },
    { label: '教職員', width: 42, key: 'staff' },
    { label: '学生', width: 38, key: 'student' },
    { label: '院生', width: 38, key: 'grad' },
    { label: 'その他', width: 42, key: 'other' },
    { label: '計', width: 38, key: 'total' },
    { label: '利用目的', width: 250, key: 'purpose' },
    { label: '宿泊施設', width: 100, key: 'lodging' }
  ];

  function nenpoRows(rows) {
    return rows.map(function (r) {
      return NENPO_COLS.map(function (c) {
        var v = r[c.key];
        if (['staff', 'student', 'grad', 'other'].indexOf(c.key) >= 0 && !v) return '';
        return v;
      });
    });
  }

  /**
   * 年報の表を Excel で出す
   * ★現在エクセルの数式で作られているものを、そのまま置き換える
   */
  function nenpoExcel(forestName, year, rows, filename) {
    var xml = buildExcel([{
      name: String(year) + '年度',
      title: forestName + '　' + year + '年度　利用状況',
      columns: NENPO_COLS,
      rows: nenpoRows(rows)
    }], forestName + ' ' + year + '年度 利用状況');
    download(filename || ('演習林利用状況_' + forestName + '_' + year + '年度.xls'),
             xml, 'application/vnd.ms-excel');
  }

  /** 年報の表を Word で出す。横向き */
  function nenpoWord(forestName, year, rows, filename) {
    var body =
      '<h1>' + esc(forestName) + '</h1>' +
      '<p class="sub">' + year + '年度　利用状況</p>' +
      tableHtml(NENPO_COLS, nenpoRows(rows)) +
      '<p class="foot">件数 ' + rows.length + '件　' +
      '延べ利用日数 ' + rows.reduce(function (s, r) { return s + r.days; }, 0) + '日　' +
      '延べ人数 ' + rows.reduce(function (s, r) { return s + r.total; }, 0) + '名<br>' +
      '演習林 利用申込システムより出力　' +
      new Date().toLocaleDateString('ja-JP') + '</p>';
    download(filename || ('演習林利用状況_' + forestName + '_' + year + '年度.doc'),
             buildWord(forestName + ' ' + year + '年度 利用状況', body, true),
             'application/msword');
  }

  // ------------------------------------------------ 本部への月次

  /**
   * 本部へ渡す月次データを CSV で出す
   * ★現在のCSVと同じ「一日一行」の形。受け取る側は何も変えなくてよい
   */
  function monthlyCsv(forestName, yyyymm, rows, filename) {
    var head = ['演習林', '番号', '日付', '開始日', '終了日', '利用代表者',
                '代表者所属', '所属属性', '利用目的', '区分', '場所', '宿泊'];

    // 人数の内訳は、区分ごとの列に展開する（現在の様式に合わせる）
    var kinds = [];
    rows.forEach(function (r) {
      r.headcounts.forEach(function (h) {
        var k = h.org_type + '･' + h.status_type;
        if (kinds.indexOf(k) < 0) kinds.push(k);
      });
    });
    kinds.sort();

    var lines = [head.concat(kinds).map(q).join(',')];
    rows.forEach(function (r) {
      var lodge = r.lodgings.length ? r.lodgings[0].facility_id : '日帰り';
      var base = [r.forest, r.legacy_no, r.date, r.date_from, r.date_to,
                  r.rep_name, r.rep_org, r.org_type, r.purpose, r.category,
                  r.place, lodge];
      var counts = kinds.map(function (k) {
        var n = 0;
        r.headcounts.forEach(function (h) {
          if (h.org_type + '･' + h.status_type === k) n += h.count;
        });
        return n || '';
      });
      lines.push(base.concat(counts).map(q).join(','));
    });

    download(filename || ('利用実績_' + forestName + '_' + yyyymm + '.csv'),
             lines.join('\r\n'), 'text/csv');
  }

  function q(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ------------------------------------------------ 月次利用状況報告

  /**
   * 月次の利用状況報告を Word で出す
   * ★職員の方が開いてそのまま直せる形にする。
   *   Web上にだけ表示すると、直したいときに直せなくなる
   */
  function monthlyReportWord(forestName, yyyymm, apps, filename) {
    var cols = [
      { label: 'No' }, { label: '期間' }, { label: '日数' },
      { label: '利用代表者' }, { label: '所属' },
      { label: '人数' }, { label: '利用目的' }, { label: '宿泊' }
    ];
    var rows = apps.map(function (a, i) {
      return [i + 1,
              a.date_from + ' 〜 ' + a.date_to,
              a.n_days,
              a.rep_name, a.rep_org, a.total_people,
              a.purpose, a.lodging || ''];
    });

    var body =
      '<h1>' + esc(forestName) + '　利用状況報告</h1>' +
      '<p class="sub">' + yyyymm.replace('-', '年 ') + '月分</p>' +
      tableHtml(cols, rows) +
      '<h2>集計</h2>' +
      '<table><tbody>' +
      '<tr><td style="width:120pt">利用件数</td><td>' + apps.length + ' 件</td></tr>' +
      '<tr><td>延べ利用日数</td><td>' +
        apps.reduce(function (s, a) { return s + a.n_days; }, 0) + ' 日</td></tr>' +
      '<tr><td>延べ人数</td><td>' +
        apps.reduce(function (s, a) { return s + a.total_people; }, 0) + ' 名</td></tr>' +
      '</tbody></table>' +
      '<p class="foot">演習林 利用申込システムより出力　' +
      new Date().toLocaleDateString('ja-JP') + '</p>';

    download(filename || ('利用状況報告_' + forestName + '_' + yyyymm + '.doc'),
             buildWord(forestName + ' 利用状況報告', body, false),
             'application/msword');
  }

  // ------------------------------------------------ 利用者名簿

  /**
   * 利用者名簿を Excel で出す
   * ★宿泊施設に渡す用。個人情報を含むため、出力した記録を残すこと
   */
  function participantsExcel(app, participants, filename) {
    var cols = [
      { label: '氏名', width: 110 }, { label: 'ふりがな', width: 100 },
      { label: '所属', width: 200 }, { label: '身分', width: 60 },
      { label: '性別', width: 44 }, { label: '年齢', width: 44 },
      { label: 'アレルギー', width: 110 }
    ];
    var rows = participants.map(function (p) {
      return [p.name, p.name_kana || '', p.org || '', p.status_type || '',
              p.gender || '', p.age != null ? p.age : '', p.allergy || ''];
    });
    var xml = buildExcel([{
      name: '利用者名簿',
      title: app.app_id + '　' + app.purpose,
      columns: cols, rows: rows
    }], '利用者名簿');
    download(filename || ('利用者名簿_' + app.app_id + '.xls'),
             xml, 'application/vnd.ms-excel');
  }

  return {
    download: download,
    buildExcel: buildExcel,
    buildWord: buildWord,
    nenpoExcel: nenpoExcel,
    nenpoWord: nenpoWord,
    monthlyCsv: monthlyCsv,
    monthlyReportWord: monthlyReportWord,
    participantsExcel: participantsExcel
  };
})();
