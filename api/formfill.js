/**
 * formfill.js  演習林の様式に、申込の内容を流し込む
 *
 * ■ 何をするか
 *   演習林が配っている Word の様式（原本）に、
 *   システムに入力された内容をそのまま埋めて返す。
 *
 *   利用される方は、様式をダウンロードして手で書き写す必要がなくなる。
 *   職員の方は、いつもと同じ見た目の様式を受け取れる。
 *
 * ■ しくみ
 *   docx は、実は zip でまとめられた XML の集まりである。
 *   その中の word/document.xml に本文が入っている。
 *
 *     1  ひな形（原本に {{項目名}} を入れたもの）を Drive から読む
 *     2  zip を開く
 *     3  document.xml の {{項目名}} を値に置き換える
 *     4  zip に戻す
 *
 *   ★様式を一から組み立て直すのではない。
 *     原本をそのまま使うので、見た目が変わらない。
 *     演習林が様式を改訂したら、ひな形を作り直すだけで済む。
 *     （ひな形を作るのは src/forms/_make_template.py）
 *
 * ■ 気をつけること
 *   ・値に < > & が入ると XML が壊れる。必ず逃がす
 *   ・ひな形が見つからないときは、黙って空の様式を返さない。
 *     何が足りないのかを言う
 */

var FormFill = (function () {

  /** ひな形を置く Drive フォルダの名前 */
  var TEMPLATE_FOLDER = '演習林_様式ひな形';

  /**
   * XML に入れてよい形に直す
   * ★これを忘れると、氏名に & が入っただけで
   *   Word が「ファイルが壊れています」と言い出す。
   */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function templateFolder() {
    var it = DriveApp.getFoldersByName(TEMPLATE_FOLDER);
    if (it.hasNext()) return it.next();
    return DriveApp.createFolder(TEMPLATE_FOLDER);
  }

  /**
   * ひな形を探す
   * ★Word（docx）と Excel（xlsx）の両方がある。
   *   どちらかを決め打ちにしない。
   */
  function findTemplate(code) {
    var folder = templateFolder();
    var exts = ['docx', 'xlsx'];
    for (var i = 0; i < exts.length; i++) {
      var it = folder.getFilesByName(code + '.' + exts[i]);
      if (it.hasNext()) {
        return { file: it.next(), ext: exts[i] };
      }
    }
    throw new Error(
      '様式のひな形が見つかりません　' + code + String.fromCharCode(10) +
      'Drive の「' + TEMPLATE_FOLDER + '」フォルダに置いてください。');
  }

  /**
   * 値を流し込んで、新しい docx を作る
   *
   * @param {string} code    様式の記号　例 'HKD-B'
   * @param {Object} values  { rep_name: '青木 涼太', ... }
   * @param {string} name    できあがるファイルの名前
   * @return {Blob}
   */
  function fill(code, values, name) {
    var found = findTemplate(code);
    var parts = Utilities.unzip(found.file.getBlob().setContentType(
      'application/zip'));

    var made = [];
    var left = [];

    // ★どのファイルに文字が入っているかは、形式によって違う。
    //   Word　　word/document.xml
    //   Excel　 xl/worksheets/sheet*.xml
    var isTarget = function (n) {
      if (found.ext === 'xlsx') {
        return n.indexOf('xl/worksheets/sheet') === 0 && n.slice(-4) === '.xml';
      }
      return n === 'word/document.xml';
    };

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!isTarget(p.getName())) {
        made.push(p);
        continue;
      }
      var xml = p.getDataAsString('UTF-8');

      for (var k in values) {
        if (!values.hasOwnProperty(k)) continue;
        xml = xml.split('{{' + k + '}}').join(esc(values[k]));
      }

      // 埋め残しを数える。★黙って空欄のまま返さない
      var m = xml.match(/\{\{(\w+)\}\}/g);
      if (m) {
        for (var j = 0; j < m.length; j++) {
          var key = m[j].replace(/[{}]/g, '');
          if (left.indexOf(key) < 0) left.push(key);
        }
        // 値のない目印は、空にして残さない
        xml = xml.replace(/\{\{\w+\}\}/g, '');
      }

      made.push(Utilities.newBlob(xml, 'text/xml', p.getName()));
    }

    var MIME = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    var outName = name || (code + '.' + found.ext);
    if (outName.slice(-5) !== '.' + found.ext) {
      outName = outName.replace(/\.(docx|xlsx)$/, '') + '.' + found.ext;
    }

    var zipped = Utilities.zip(made, outName);
    var blob = zipped.setContentType(MIME[found.ext] || MIME.docx);

    return { blob: blob, missing: left, ext: found.ext };
  }

  /**
   * 申込の内容を、様式の項目名に対応させる
   *
   * ★ここが「システムの言葉」と「様式の言葉」の変換表。
   *   様式ごとに項目名が違うので、様式ごとに書く。
   *   様式が増えたら、ここに足すだけでよい。
   */
  var MAP = {

    'HKD-B': function (a, rep, forest) {
      var d = new Date();
      return {
        apply_date:   d.getFullYear() + '年 ' + (d.getMonth() + 1) +
                      '月 ' + d.getDate() + '日',
        rep_name:     rep.name || '',
        rep_title:    (a.rep_org || rep.org || '') +
                      (rep.title ? '　' + rep.title : ''),
        // ★ひな形では〒と住所が1つの欄になっている（42文字）
        address:      (rep.zip ? '〒' + rep.zip + '　' : '') + (rep.address || ''),
        tel:          rep.tel || '',
        fax:          rep.fax || '',
        email:        rep.email || '',
        supervisor:   a.supervisor || '',
        project_name: a.purpose || '',
        use_dates:    dateRange(a.date_from, a.date_to),
        use_content:  a.use_content || a.purpose || '',
        arrive_place: a.arrive_place || '',
        arrive_time:  timeBox(a.arrive_at),
        depart_place: a.depart_place || '',
        depart_time:  timeBox(a.depart_at),
        cb_transport: mark(a.need_transport),
        cb_support:   mark(a.has_staff_support),
        cb_lend:      mark(a.need_equipment),
        cb_other:     mark(a.need_other)
      };
    }

  };

  // ------------------------------------------------ 北海道　様式A1・A2
  //
  //   ★A1・A2・B は、上半分（誰が申し込むか）が同じ形。
  //     同じ関数から作り、下半分だけを足す。

  function hkdCommon(a, rep) {
    return {
      rep_name:   rep.name || '',
      rep_title:  (a.rep_org || rep.org || '') +
                  (rep.title ? '　' + rep.title : ''),
      address:    (rep.zip ? '〒' + rep.zip + '　' : '') + (rep.address || ''),
      tel:        rep.tel || '',
      fax:        rep.fax || '',
      email:      rep.email || '',
      supervisor: a.supervisor || ''
    };
  }

  MAP['HKD-A1'] = function (a, rep, forest) {
    var v = hkdCommon(a, rep);
    v.project_name = a.purpose || '';
    v.use_content  = a.use_content || a.purpose || '';
    return v;
  };

  MAP['HKD-A2'] = function (a, rep, forest) {
    var v = hkdCommon(a, rep);
    v.project_name = a.purpose || '';
    return v;
  };

  // ------------------------------------------------ 樹芸研究所　様式1

  MAP['JUG-1'] = function (a, rep, forest) {
    return {
      rep_name:   rep.name || '',
      rep_title:  rep.title || rep.status_type || '',
      rep_org:    a.rep_org || rep.org || '',
      address:    (rep.zip ? '〒' + rep.zip + '　' : '') + (rep.address || ''),
      supervisor: a.supervisor || '',
      purpose:    a.purpose || '',
      place:      a.place || ''
    };
  };

  // ------------------------------------------------ 千葉演習林　利用申込書
  //
  //   ★千葉は「入力シート」方式。
  //     1枚目に入れると、2枚目以降の申込書に自動で反映される。

  MAP['CHB-1'] = function (a, rep, forest) {
    var d = new Date();
    return {
      apply_date:   d.getFullYear() + '年' + (d.getMonth() + 1) +
                    '月' + d.getDate() + '日',
      rep_org:      a.rep_org || rep.org || '',
      rep_name:     rep.name || '',
      zip:          rep.zip || '',
      address:      rep.address || '',
      tel:          rep.tel || '',
      mobile:       rep.mobile || '',
      email:        rep.email || '',

      sup_org:      a.supervisor_org || '',
      sup_name:     a.supervisor || '',
      sup_tel:      a.supervisor_tel || '',
      sup_mobile:   '',
      sup_email:    a.supervisor_email || '',
      sup_approved: a.supervisor ? '承認済み' : '',

      category:     a.category || '',
      category2:    '',
      purpose:      a.purpose || '',
      place:        a.place || '',
      date_from:    slash(a.date_from),
      date_to:      slash(a.date_to),
      alt_from:     '',
      alt_to:       '',
      arrive_hour:  hourOf(a.arrive_at),
      arrive_place: a.arrive_place || '',
      depart_hour:  hourOf(a.depart_at),
      transport:    a.transport || '',
      transport2:   '',
      need_key:     a.need_key ? '希望する' : '',
      coop_request: a.coop_request || '',
      facility:     a.facility_name || '',
      lodging:      a.lodging_name || ''
    };
  };

  // ------------------------------------------------ 秩父演習林　様式Ⅱ-1

  MAP['CHC-2-1'] = function (a, rep, forest) {
    return {
      rep_name:    rep.name || '',
      org_type:    a.org_type || rep.org_type || '',
      rep_org:     a.rep_org || rep.org || '',
      status_type: rep.status_type || '',
      grade:       rep.grade || '',
      email:       rep.email || '',
      tel:         rep.tel || '',
      category:    a.category || '',
      purpose:     a.purpose || '',
      place:       a.place || ''
    };
  };

  /** 2026-09-14 を 2026/9/14 にする */
  function slash(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return String(iso || '');
    return Number(p[0]) + '/' + Number(p[1]) + '/' + Number(p[2]);
  }

  /** 2026-09-14 13:00 から「13」を取り出す */
  function hourOf(at) {
    var m = String(at || '').match(/[ T](\d{1,2}):/);
    return m ? String(Number(m[1])) : '';
  }

  function mark(v) {
    return v ? '☑' : '□';
  }

  function dateRange(from, to) {
    if (!from) return '';
    var a = ymd(from);
    if (!to || to === from) return a + '　1日間';
    var days = Math.round(
      (new Date(to) - new Date(from)) / 86400000) + 1;
    return a + ' 〜 ' + ymd(to, true) + '　' + days + '日間';
  }

  function ymd(iso, shortYear) {
    var p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    var head = shortYear ? '' : (Number(p[0]) + '年');
    return head + Number(p[1]) + '月' + Number(p[2]) + '日（' + w + '）';
  }

  function timeBox(at) {
    if (!at) return '予定時刻［　　月　　日　　時頃］';
    // 2026-09-01 13:00 の形を想定
    var m = String(at).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2})/);
    if (!m) return '予定時刻［　　月　　日　　時頃］';
    return '予定時刻［ ' + Number(m[2]) + '月 ' + Number(m[3]) +
           '日 ' + Number(m[4]) + '時頃］';
  }

  /**
   * 申込から様式を作る
   * @param {string} appId  申込ID
   * @param {string} code   様式の記号
   */
  function forApplication(appId, code) {
    if (!MAP[code]) {
      throw new Error(
        'この様式の対応表がまだありません　' + code + String.fromCharCode(10) +
        'formfill.js の MAP に足してください。');
    }

    var a = API.getApplication(appId);
    if (!a) throw new Error('申込が見つかりません　' + appId);

    var db = API.adapter();
    var rep = db.findByKey('M_USER', a.rep_user_id) || {};
    var forest = db.findByKey('M_FOREST', a.forest_id) || {};

    var values = MAP[code](a, rep, forest);
    var name = appId + '_' + code + '.docx';

    return fill(code, values, name);
  }

  return {
    fill: fill,
    forApplication: forApplication,
    templateFolder: templateFolder,
    TEMPLATE_FOLDER: TEMPLATE_FOLDER,
    /** 対応表のある様式の一覧 */
    available: function () { return Object.keys(MAP); }
  };
})();


/**
 * 動作の確認　ひな形に架空の値を入れて、Drive に置く
 * ★ひな形を Drive に置いてから実行する
 */
function testFormFill() {
  var NLC = String.fromCharCode(10);
  var r = FormFill.fill('HKD-B', {
    apply_date:   '2026年 8月 20日',
    rep_name:     '青木 涼太',
    rep_title:    '東京大学大学院農学生命科学研究科　博士課程2年',
    zip:          '060-0808',
    address:      '北海道札幌市北区北8条西5丁目',
    tel:          '011-706-0000',
    fax:          '011-706-0001',
    email:        'aoki@example.ac.jp',
    supervisor:   '教授　森下 健一',
    project_name: '北方林におけるカラマツ人工林の炭素収支の解明',
    use_dates:    '2026年9月1日（火）〜 9月3日（木）　3日間',
    use_content:  '林内調査地における毎木調査および土壌サンプルの採取',
    arrive_place: '山部宿泊施設',
    arrive_time:  '予定時刻［ 9月 1日 13時頃］',
    depart_place: '山部宿泊施設',
    depart_time:  '予定時刻［ 9月 3日 15時頃］',
    cb_transport: '☑',
    cb_support:   '☑',
    cb_lend:      '□',
    cb_other:     '□'
  }, '動作確認_様式B.docx');

  var f = FormFill.templateFolder().createFile(r.blob);

  var log = ['様式を作りました', '', '　' + f.getUrl(), ''];
  if (r.missing.length) {
    log.push('★値が入らなかった項目　' + r.missing.join('、'));
  } else {
    log.push('すべての項目が埋まりました');
  }
  Logger.log(log.join(NLC));
  return log.join(NLC);
}
