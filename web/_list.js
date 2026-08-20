/**
 * _list.js  申込一覧
 *
 * ■ 直した点（2026-08-20 本人指摘）
 *   検索欄に1文字入れるたびに画面全体を作り直していたため、
 *   入力欄そのものが作り直され、フォーカスが外れていた。
 *   → 枠は1度だけ作り、表の中身だけを描き直す。
 *
 * ■ 加えた点
 *   ・列見出しを押すと並べ替えられる
 *   ・未処理のものを上に出す切り替え
 *   ・新しい申込を職員が手で作れる
 */

var ListView = (function () {

  var sortKey = 'date_from';
  var sortAsc = false;
  var built = false;

  // 列の定義。ここを直せば表の形が変わる
  var COLS = [
    { key: 'app_id',    label: '申込ID',    cls: 'nowrap', w: 118 },
    { key: 'date_from', label: '期間',      cls: 'nowrap', w: 120 },
    { key: 'n_days',    label: '日数',      cls: 'num',    w: 52 },
    { key: 'rep_name',  label: '代表者',    cls: '',       w: 110 },
    { key: 'rep_org',   label: '所属',      cls: '',       w: 220 },
    { key: 'purpose',   label: '利用目的',  cls: '',       w: null },
    { key: 'total_people', label: '人数',   cls: 'num',    w: 56 },
    { key: 'status',    label: 'ステータス', cls: 'nowrap', w: 104 },
    { key: 'n_unregistered', label: '個人情報', cls: 'nowrap', w: 92 }
  ];

  /** 明細をつけて、並べ替えに使う値をそろえる */
  function fetch() {
    var apps = API.getApplications({
      forest_id: state.forest,
      status: state.filterStatus || '',
      keyword: state.keyword || ''
    });

    apps.forEach(function (a) {
      var full = API.getApplication(a.app_id);
      a.n_days = full.n_days;
      a.total_people = full.total_people;
      a.n_unregistered = full.n_unregistered;
    });

    if (state.onlyOpen) {
      apps = apps.filter(function (a) { return a.status_open; });
    }

    apps.sort(function (x, y) {
      var vx = x[sortKey], vy = y[sortKey];
      if (typeof vx === 'number' && typeof vy === 'number') {
        return sortAsc ? vx - vy : vy - vx;
      }
      vx = String(vx == null ? '' : vx);
      vy = String(vy == null ? '' : vy);
      var r = vx.localeCompare(vy, 'ja');
      return sortAsc ? r : -r;
    });
    return apps;
  }

  function head() {
    return '<tr>' + COLS.map(function (c) {
      var on = (sortKey === c.key);
      var mark = on ? (sortAsc ? ' ▲' : ' ▼') : '';
      return '<th class="sortable' + (on ? ' on' : '') + '"' +
             (c.w ? ' style="width:' + c.w + 'px"' : '') +
             ' onclick="ListView.sort(\'' + c.key + '\')">' +
             esc(c.label) + mark + '</th>';
    }).join('') + '</tr>';
  }

  function rowsHtml(apps) {
    if (!apps.length) {
      return '<tr><td colspan="' + COLS.length +
             '" class="empty">該当する申込がありません</td></tr>';
    }
    return apps.map(function (a) {
      return '<tr onclick="openDetail(\'' + a.app_id + '\')">' +
        '<td class="nowrap">' + esc(a.app_id) + '</td>' +
        '<td class="nowrap">' + fmtDate(a.date_from) + ' 〜 ' +
          fmtDate(a.date_to) + '</td>' +
        '<td class="num">' + a.n_days + '</td>' +
        '<td>' + esc(a.rep_name) + '</td>' +
        '<td>' + esc(a.rep_org).slice(0, 30) + '</td>' +
        '<td>' + esc(a.purpose).slice(0, 40) + '</td>' +
        '<td class="num">' + a.total_people + '</td>' +
        '<td><span class="chip" style="background:' + a.status_color + '">' +
          esc(a.status_label) + '</span></td>' +
        '<td class="nowrap">' + (a.n_unregistered ?
          '<span class="warn">未登録 ' + a.n_unregistered + '</span>' : '—') + '</td>' +
      '</tr>';
    }).join('');
  }

  /** 表の中身と件数だけを描き直す。枠は触らない */
  function refresh() {
    var apps = fetch();
    var tb = document.getElementById('list-body');
    var th = document.getElementById('list-head');
    var ct = document.getElementById('list-count');
    if (!tb) { build(); return; }
    th.innerHTML = head();
    tb.innerHTML = rowsHtml(apps);
    ct.textContent = apps.length + ' 件';
  }

  /** 枠を作る。初回と、演習林を切り替えたときだけ */
  function build() {
    var m = API.getMasters(state.forest);

    document.getElementById('p-list').innerHTML =
      '<div class="bar">' +
        '<label>ステータス</label>' +
        '<select onchange="state.filterStatus=this.value;ListView.refresh()">' +
          '<option value="">すべて</option>' +
          m.statuses.map(function (s) {
            return '<option value="' + s.code + '"' +
              (state.filterStatus === s.code ? ' selected' : '') + '>' +
              esc(s.label) + '</option>';
          }).join('') +
        '</select>' +

        '<label>検索</label>' +
        '<input type="text" id="list-kw" value="' + esc(state.keyword || '') + '" ' +
          'placeholder="代表者・所属・目的" style="width:210px" ' +
          'oninput="state.keyword=this.value;ListView.refresh()">' +

        '<label style="cursor:pointer">' +
          '<input type="checkbox" id="list-open"' +
          (state.onlyOpen ? ' checked' : '') + ' ' +
          'onchange="state.onlyOpen=this.checked;ListView.refresh()" ' +
          'style="width:auto;margin-right:4px">対応中のみ</label>' +

        '<button class="btn" onclick="ListView.newApp()">＋ 新しい申込</button>' +
        '<span class="count" id="list-count"></span>' +
      '</div>' +
      '<table><thead id="list-head"></thead><tbody id="list-body"></tbody></table>' +
      devNote('getApplications( ) で絞り込み、getApplication( ) で明細を取っている。' +
              '検索のたびに作り直すのは表の中身だけで、入力欄には触れない');

    built = true;
    refresh();

    // 入力欄に文字が入っていたら、続きから打てるようにする
    var kw = document.getElementById('list-kw');
    if (kw && state.keyword) {
      kw.focus();
      kw.setSelectionRange(kw.value.length, kw.value.length);
    }
  }

  function sort(key) {
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = (key === 'app_id' || key === 'rep_name'); }
    refresh();
  }

  /**
   * 職員が新しい申込を手で作る
   * ★電話や紙で受けたものを、その場で入れられるようにする。
   *   これがないと、決められた経路以外の申込を受けられない。
   */
  function newApp() {
    var f = API.getMasters().forests.filter(function (x) {
      return x.forest_id === state.forest; })[0];

    var purpose = prompt('利用目的を入力してください\n（' +
                         (f ? f.name : state.forest) + '）');
    if (!purpose) return;
    var from = prompt('利用開始日　例 2026-10-01');
    if (!from) return;
    var to = prompt('利用終了日　例 2026-10-03', from);
    if (!to) return;
    var org = prompt('利用代表者の所属') || '';

    var id = API.saveApplication({
      forest_id: state.forest,
      rep_user_id: '',
      rep_org: org,
      purpose: purpose,
      category: '研究',
      place: '',
      date_from: from,
      date_to: to
    });
    API.addMessage(id, {
      kind: '所内メモ', from: state.staff, to: '所内',
      body: '職員が代理で登録した'
    });
    refresh();
    openDetail(id);
  }

  return {
    build: build,
    refresh: refresh,
    sort: sort,
    newApp: newApp,
    reset: function () { built = false; }
  };
})();
