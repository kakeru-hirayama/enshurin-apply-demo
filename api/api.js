/**
 * api.js  API層
 *
 * 画面から呼ばれる窓口。ここに書かれた関数だけが外に出る。
 *
 * ★守っていること
 *   ① 画面は、この層より下を直接触らない
 *   ② この層は、Adapter の関数だけを呼ぶ。スプレッドシートを直接触らない
 *   ③ したがって、データの保存先を変えても画面は変わらない
 *
 * 引き継ぐときは、このファイルの関数一覧と、
 * それぞれの入力と出力の形（docs/API仕様.md）を読めばよい。
 * データがどこにどう保存されているかを知る必要はない。
 */

var API = (function () {

  /**
   * どのアダプタを使うか
   *
   * ★API層は、特定のアダプタに依存してはいけない。
   *   ここでは「その環境にあるもの」を既定として選ぶだけにする。
   *
   *     ブラウザ        MemoryAdapter（手元で動かすとき）
   *     Apps Script     SheetsAdapter（スプレッドシートに保存するとき）
   *
   *   どちらもなければ null のままにし、useAdapter( ) で必ず渡してもらう。
   *   （以前ここを MemoryAdapter と決め打ちしていたため、
   *     Apps Script 上で「MemoryAdapter is not defined」になった）
   */
  var db = (typeof MemoryAdapter !== 'undefined') ? MemoryAdapter
         : (typeof SheetsAdapter !== 'undefined') ? SheetsAdapter
         : null;

  // ------------------------------------------------ 内部の道具

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function now() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  function fiscalYear(dateStr) {
    var d = new Date(dateStr);
    return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  }

  /** 期間の日付を1日ずつ並べる */
  function eachDate(from, to) {
    var out = [], d = new Date(from), end = new Date(to);
    while (d <= end) {
      out.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  function byId(rows, key) {
    var m = {};
    rows.forEach(function (r) { m[r[key]] = r; });
    return m;
  }

  // ------------------------------------------------ 申込

  /**
   * 申込を絞り込んで返す
   * @param {Object} q  { forest_id, status, from, to, rep_user_id, keyword }
   * @return {Array} 申込の配列。代表者名とステータス名を添える
   */
  function getApplications(q) {
    q = q || {};
    var apps = db.readAll('T_APPLICATION');
    var users = byId(db.readAll('M_USER'), 'user_id');
    var statuses = db.readAll('M_STATUS');

    // ★探すときは、ふせんの名前と職員メモも見る。
    //   「返事待ち」で絞れないと、ふせんを貼る意味が半分になる。
    //   （2026-08-21 ご指摘）
    //
    //   引くのは、探す言葉があるときだけ。
    //   毎回引くと、一覧を開くたびに2つの表を読むことになる。
    var tagsBy = {}, memoBy = {};
    if (q.keyword) {
      var tagName = {};
      db.readAll('M_TAG').forEach(function (t) { tagName[t.tag_id] = t.name; });
      db.readAll('T_APP_TAG').forEach(function (r) {
        var n = tagName[r.tag_id];
        if (!n) return;
        tagsBy[r.app_id] = (tagsBy[r.app_id] || '') + ' ' + n;
      });
      db.readAll('T_MESSAGE').forEach(function (m) {
        if (m.kind !== '所内メモ') return;
        memoBy[m.app_id] = (memoBy[m.app_id] || '') + ' ' + m.body;
      });
    }

    return apps.filter(function (a) {
      if (q.forest_id && a.forest_id !== q.forest_id) return false;
      if (q.status && a.status !== q.status) return false;
      if (q.rep_user_id && a.rep_user_id !== q.rep_user_id) return false;
      if (q.from && a.date_to < q.from) return false;
      if (q.to && a.date_from > q.to) return false;
      if (q.keyword) {
        var hay = [a.purpose, a.rep_org, a.place, a.app_id].join(' ');
        var u = users[a.rep_user_id];
        if (u) hay += ' ' + u.name;
        hay += (tagsBy[a.app_id] || '') + (memoBy[a.app_id] || '');
        if (hay.indexOf(q.keyword) < 0) return false;
      }
      return true;
    }).map(function (a) {
      return decorate(a, users, statuses);
    }).sort(function (x, y) {
      return (x.date_from < y.date_from) ? 1 : -1;
    });
  }

  /** 一覧に出すために、参照先の名前を添える */
  function decorate(a, users, statuses) {
    var u = users[a.rep_user_id];
    var st = null;
    for (var i = 0; i < statuses.length; i++) {
      if (statuses[i].forest_id === a.forest_id && statuses[i].code === a.status) {
        st = statuses[i];
        break;
      }
    }
    a.rep_name = u ? u.name : '（未登録）';
    a.status_label = st ? st.label : a.status;
    a.status_color = st ? st.color : '#999999';
    a.status_open = st ? !!st.is_open : true;
    return a;
  }

  /**
   * 申込1件を、関連するものを全部つけて返す
   * ★画面の「申込の詳細」がこれ1回の呼び出しで描ける
   */
  function getApplication(appId) {
    var a = db.findByKey('T_APPLICATION', appId);
    if (!a) return null;

    var users = byId(db.readAll('M_USER'), 'user_id');
    decorate(a, users, db.readAll('M_STATUS'));

    a.days = db.readAll('T_USAGE_DAY')
      .filter(function (r) { return r.app_id === appId; })
      .map(function (r) { return r.date; })
      .sort();

    a.participants = db.readAll('T_PARTICIPANT')
      .filter(function (r) { return r.app_id === appId; })
      .map(function (r) {
        var u = users[r.user_id];
        r.name = u ? u.name : r.invite_name;
        r.org = u ? u.org : '';
        return r;
      });

    a.headcounts = db.readAll('T_HEADCOUNT')
      .filter(function (r) { return r.app_id === appId; });

    a.lodgings = db.readAll('T_LODGING')
      .filter(function (r) { return r.app_id === appId; });

    a.documents = db.readAll('T_DOCUMENT')
      .filter(function (r) { return r.app_id === appId; })
      .sort(function (x, y) { return x.submitted_at < y.submitted_at ? -1 : 1; });

    a.messages = db.readAll('T_MESSAGE')
      .filter(function (r) { return r.app_id === appId; })
      .sort(function (x, y) { return x.at < y.at ? -1 : 1; });

    // 集計値
    a.total_people = a.headcounts.reduce(function (s, h) { return s + (h.count || 0); }, 0);
    a.n_days = a.days.length;
    a.n_unregistered = a.participants.filter(function (p) {
      return p.reg_status !== '登録済';
    }).length;

    return a;
  }

  /**
   * 申込を保存する。app_id が無ければ新規に採番する
   * ★利用日（T2）も同時に作る。期間から自動で展開する
   */
  /**
   * 申込を保存する
   *
   * ★入口で必ず確かめる。
   *   確かめないと、こういうものが実際に入る（2026-08-20 の試験で判明）
   *
   *     forest_id なし　　→  2026-undefined-0001
   *     date_from が 2026-13-45 →  NaN-HKD-0001
   *     終了日 < 開始日　　→  利用日が0件の申込
   *
   *   利用日が0件だと、月次にも年報にも出てこない。
   *   誰も気づかないまま「見えない申込」として残り続ける。
   *   これは、あとから探し出すのがいちばん難しい形の壊れ方である。
   */
  function saveApplication(data) {
    var isNew = !data.app_id;

    if (isNew) {
      checkApplication(data);
    }

    if (isNew) {
      // ★採番と書き込みは、ひとまとめにして行う。
      //   間に他の方が割り込むと、同じ受付番号が2件できてしまう。
      //   順番待ちの列があるかどうかは保存先によって違うので、
      //   無ければそのまま実行する。
      var lock = db.withLock || function (fn) { return fn(); };

      lock(function () {
        var prefix = fiscalYear(data.date_from || today()) +
                     '-' + data.forest_id + '-';
        data.app_id = db.nextId('T_APPLICATION', prefix);
        data.created_at = now();
        data.applied_at = data.applied_at || today();
        data.status = data.status || firstStatusOf(data.forest_id);
        data.updated_at = now();
        db.insert('T_APPLICATION', data);
      });
    } else {
      data.updated_at = now();
      db.update('T_APPLICATION', data.app_id, data);
    }

    if (data.date_from && data.date_to) {
      syncUsageDays(data.app_id, data.date_from, data.date_to);
    }
    return data.app_id;
  }

  /**
   * 申込の中身を確かめる
   * ★通らないものは、必ず例外にする。
   *   黙って直すと、直したことに誰も気づけない。
   */
  function checkApplication(data) {
    var ng = [];
    var NLC = String.fromCharCode(10);

    // ---- 演習林
    if (!data.forest_id) {
      ng.push('演習林が選ばれていません');
    } else if (!db.findByKey('M_FOREST', data.forest_id)) {
      ng.push('知らない演習林です　' + data.forest_id);
    }

    // ---- 日付
    if (!isDate(data.date_from)) {
      ng.push('利用開始日が正しくありません　' + (data.date_from || '（空）'));
    }
    if (!isDate(data.date_to)) {
      ng.push('利用終了日が正しくありません　' + (data.date_to || '（空）'));
    }
    if (isDate(data.date_from) && isDate(data.date_to) &&
        data.date_to < data.date_from) {
      ng.push('終了日が開始日より前になっています　' +
              data.date_from + ' 〜 ' + data.date_to);
    }

    // ---- 利用の目的
    if (!String(data.purpose || '').trim()) {
      ng.push('利用目的が空です');
    }

    // ---- 代表者
    if (!data.rep_user_id) {
      ng.push('利用代表者が決まっていません');
    }

    if (ng.length) {
      throw new Error(
        '申込の内容に足りないところがあります' + NLC +
        ng.map(function (x) { return '　・' + x; }).join(NLC));
    }
    return true;
  }

  /**
   * 2026-09-01 の形になっていて、実在する日かを見る
   * ★形だけでなく、実在も見る。
   *   2026-13-45 は形は合っているが、そんな日はない。
   */
  function isDate(v) {
    var s = String(v || '');
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y &&
           dt.getMonth() === mo - 1 &&
           dt.getDate() === d;
  }

  /**
   * '202605' も '2026-05' も '2026-5' も、'2026-05' に揃える
   * 正しくない形なら null
   */
  function normalizeYm(v) {
    var s = String(v || '').trim();
    var m = s.match(/^(\d{4})-?(\d{1,2})$/);
    if (!m) return null;
    var mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    return m[1] + '-' + ('0' + mo).slice(-2);
  }

  /**
   * その月の最後の日
   * ★'-31' の決め打ちにしない。2月も4月もある
   */
  function lastDayOf(ym) {
    var p = ym.split('-');
    var d = new Date(Number(p[0]), Number(p[1]), 0);   // 翌月の0日＝当月末
    return ('0' + d.getDate()).slice(-2);
  }

  /**
   * 職員が申込を開いたことを記録する
   *
   * ■ なぜ要るか
   *   紙で運用しておられたときは、机の上に置いてあるかどうかで
   *   「まだ見ていないもの」が分かった。
   *   画面になると、その手がかりがなくなる。
   *
   *   メールソフトと同じ考え方で、未読と既読を分ける。
   *
   * ★担当の方が1〜2名の施設が多いため、
   *   「誰かが開いたら既読」という単純な形にする。
   *   職員ごとに持つと、列が人数分に増えて扱いにくい。
   */
  function markSeen(appId, staffId) {
    var a = db.findByKey('T_APPLICATION', appId);
    if (!a) return { ok: false, error: '申込が見つかりません' };
    if (a.seen_at) return { ok: true, already: true };   // すでに既読

    db.update('T_APPLICATION', appId, {
      seen_at: now(),
      seen_by: staffId || ''
    });
    return { ok: true, already: false };
  }

  /**
   * まだ誰も開いていない申込の件数
   * @param {string} forestId  空なら全演習林
   */
  function countUnseen(forestId) {
    return db.readAll('T_APPLICATION').filter(function (a) {
      if (forestId && a.forest_id !== forestId) return false;
      return !a.seen_at;
    }).length;
  }

  /**
   * 未読に戻す
   * ★あとで見返したいときに使う。メールソフトと同じ。
   */
  function markUnseen(appId) {
    var a = db.findByKey('T_APPLICATION', appId);
    if (!a) return { ok: false, error: '申込が見つかりません' };
    db.update('T_APPLICATION', appId, { seen_at: '', seen_by: '' });
    return { ok: true };
  }

  /**
   * 印（スター）を付ける・外す
   * @param {boolean} on  省略すると、いまと反対にする
   */
  function setStar(appId, on) {
    var a = db.findByKey('T_APPLICATION', appId);
    if (!a) return { ok: false, error: '申込が見つかりません' };
    var next = (on === undefined) ? !truthy(a.starred) : !!on;
    db.update('T_APPLICATION', appId, { starred: next });
    return { ok: true, starred: next };
  }

  function truthy(v) {
    return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
  }

  // ------------------------------------------------ ふせん（タグ）

  /**
   * その演習林で使えるふせんの一覧
   * ★演習林を指定しないものは、どこでも使える
   */
  function getTags(forestId) {
    return db.readAll('M_TAG')
      .filter(function (t) {
        if (t.active === false) return false;
        return !t.forest_id || !forestId || t.forest_id === forestId;
      })
      .sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
  }

  /**
   * ふせんを作る
   * ★名前も色も、職員の方が自由に決められる。
   *   決まりごと（ステータス）と違い、ここは現場の都合で増やしてよい。
   */
  function createTag(forestId, name, color, staffId) {
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'ふせんの名前を入れてください' };

    var same = getTags(forestId).filter(function (t) { return t.name === name; });
    if (same.length) return { ok: false, error: '同じ名前のふせんがあります' };

    var id = db.nextId('M_TAG', 'G');
    var seq = db.readAll('M_TAG').length + 1;
    db.insert('M_TAG', {
      tag_id: id, forest_id: forestId || '', name: name,
      color: color || '#4A7A4A', seq: seq, active: true
    });
    writeAudit(staffId, 'ふせんを作った', id, name);
    return { ok: true, tag_id: id };
  }

  /** ふせんの名前や色を変える */
  function updateTag(tagId, patch, staffId) {
    var t = db.findByKey('M_TAG', tagId);
    if (!t) return { ok: false, error: 'ふせんが見つかりません' };
    var allow = {};
    ['name', 'color', 'seq', 'active'].forEach(function (k) {
      if (patch[k] !== undefined) allow[k] = patch[k];
    });
    db.update('M_TAG', tagId, allow);
    writeAudit(staffId, 'ふせんを変えた', tagId, JSON.stringify(allow));
    return { ok: true };
  }

  /** 申込にふせんを貼る・はがす */
  function toggleTag(appId, tagId, staffId) {
    var has = db.findByKey('T_APP_TAG', [appId, tagId]);
    if (has) {
      db.remove('T_APP_TAG', [appId, tagId]);
      return { ok: true, on: false };
    }
    db.insert('T_APP_TAG', {
      app_id: appId, tag_id: tagId, at: now(), by: staffId || ''
    });
    return { ok: true, on: true };
  }

  /** 申込に貼られているふせん */
  function getAppTags(appId) {
    var tags = byId(db.readAll('M_TAG'), 'tag_id');
    return db.readAll('T_APP_TAG')
      .filter(function (r) { return r.app_id === appId; })
      .map(function (r) { return tags[r.tag_id]; })
      .filter(function (t) { return !!t; });
  }

  /**
   * 申込ごとのふせんを、まとめて引く
   * ★一覧で1件ずつ引くと、件数の分だけ読み込みが起きる
   */
  function getTagsByApp(appIds) {
    var want = {};
    (appIds || []).forEach(function (x) { want[x] = true; });
    var tags = byId(db.readAll('M_TAG'), 'tag_id');
    var out = {};
    db.readAll('T_APP_TAG').forEach(function (r) {
      if (appIds && !want[r.app_id]) return;
      if (!out[r.app_id]) out[r.app_id] = [];
      var t = tags[r.tag_id];
      if (t) out[r.app_id].push(t);
    });
    return out;
  }

  // ------------------------------------------------ まとめて行う

  /**
   * 選んだ申込に、同じことをまとめて行う
   *
   * ★1件ずつ開いて操作するのは、件数が増えると現実的でない。
   *
   * @param {Array}  appIds  申込ID
   * @param {string} what    'seen' / 'unseen' / 'star' / 'unstar' /
   *                         'tag' / 'untag'
   * @param {Object} opt     { tag_id, staff_id }
   */
  function bulk(appIds, what, opt) {
    opt = opt || {};
    var n = 0;
    var errs = [];

    (appIds || []).forEach(function (id) {
      try {
        if (what === 'seen')        { markSeen(id, opt.staff_id); n++; }
        else if (what === 'unseen') { markUnseen(id); n++; }
        else if (what === 'star')   { setStar(id, true); n++; }
        else if (what === 'unstar') { setStar(id, false); n++; }
        else if (what === 'tag') {
          if (!db.findByKey('T_APP_TAG', [id, opt.tag_id])) {
            db.insert('T_APP_TAG', {
              app_id: id, tag_id: opt.tag_id, at: now(), by: opt.staff_id || ''
            });
          }
          n++;
        }
        else if (what === 'untag') {
          if (db.findByKey('T_APP_TAG', [id, opt.tag_id])) {
            db.remove('T_APP_TAG', [id, opt.tag_id]);
          }
          n++;
        }
        else { errs.push('知らない操作　' + what); }
      } catch (e) {
        errs.push(id + '　' + e.message);
      }
    });

    if (opt.staff_id && n) {
      writeAudit(opt.staff_id, 'まとめて操作', what,
                 n + '件' + (opt.tag_id ? '　' + opt.tag_id : ''));
    }
    return { ok: errs.length === 0, done: n, errors: errs };
  }

  // ------------------------------------------------ 職員のメモ

  /**
   * 申込にメモを書き足す
   *
   * ★1つの欄を上書きする形ではなく、書き足していく形にする。
   *   上書きだと、あとから書いた人が前の内容を消してしまう。
   *   誰がいつ書いたのかも残らない。
   *
   *   電話で伺ったことは、日付と担当者が分かってはじめて役に立つ。
   *
   * ★書いた内容は、職員の方には全員に見える。
   *   個人あての連絡には使わない。
   */
  function addMemo(appId, body, staffId) {
    body = String(body || '').trim();
    if (!body) return { ok: false, error: '内容を入れてください' };

    var a = db.findByKey('T_APPLICATION', appId);
    if (!a) return { ok: false, error: '申込が見つかりません' };

    var staff = staffId ? db.findByKey('M_STAFF', staffId) : null;
    if (!staff || staff.active === false) {
      return { ok: false, error: 'この操作には職員としてのログインが必要です' };
    }

    var id = db.nextId('T_MESSAGE', 'M');
    db.insert('T_MESSAGE', {
      msg_id: id,
      app_id: appId,
      at: now(),
      kind: '所内メモ',
      from: staffId,
      to: '',
      body: body
    });
    return { ok: true, msg_id: id };
  }

  /**
   * 申込に書かれたメモを、古い順に返す
   * ★誰が書いたかは、職員の名前に置き換えて返す
   */
  function getMemos(appId) {
    var staff = byId(db.readAll('M_STAFF'), 'staff_id');
    return db.readAll('T_MESSAGE')
      .filter(function (m) {
        return m.app_id === appId && m.kind === '所内メモ';
      })
      .sort(function (x, y) { return String(x.at) < String(y.at) ? -1 : 1; })
      .map(function (m) {
        var w = staff[m.from];
        return {
          msg_id: m.msg_id,
          at: m.at,
          from: m.from,
          from_name: w ? w.name : (m.from || '（不明）'),
          body: m.body
        };
      });
  }

  /**
   * 自分が書いたメモを消す
   *
   * ★消せるのは自分が書いたものだけ。
   *   他の方の書き込みを消せると、
   *   「言った・言わない」を後から作り出せてしまう。
   */
  function removeMemo(msgId, staffId) {
    var m = db.findByKey('T_MESSAGE', msgId);
    if (!m) return { ok: false, error: '見つかりません' };
    if (m.from !== staffId) {
      return { ok: false,
               error: 'ご自身が書いたものだけ、お消しいただけます' };
    }
    db.remove('T_MESSAGE', msgId);
    writeAudit(staffId, 'メモを削除', m.app_id, String(m.body).slice(0, 40));
    return { ok: true };
  }

  function firstStatusOf(forestId) {
    var list = db.readAll('M_STATUS')
      .filter(function (s) { return s.forest_id === forestId; })
      .sort(function (x, y) { return x.seq - y.seq; });
    return list.length ? list[0].code : '受付';
  }

  /** 期間が変わったら、利用日の行を作り直す */
  function syncUsageDays(appId, from, to) {
    db.readAll('T_USAGE_DAY')
      .filter(function (r) { return r.app_id === appId; })
      .forEach(function (r) { db.remove('T_USAGE_DAY', [r.app_id, r.date]); });

    eachDate(from, to).forEach(function (d) {
      db.insert('T_USAGE_DAY', { app_id: appId, date: d });
    });
  }

  /**
   * ステータスを変える
   * ★変えた記録を必ず操作ログに残す
   */
  /**
   * ステータスを変える
   *
   * ★誰が変えたのかを確かめる。
   *   緊急連絡先を開くときは職員かどうかを見ているのに、
   *   ここだけ見ていなかった。（2026-08-20 の試験で判明）
   *
   * ★その演習林にある状態かどうかも見る。
   *   打ち間違いでどんな文字列でも入ってしまうと、
   *   一覧の絞り込みにも年報にも出てこない申込ができる。
   */
  function updateStatus(appId, newStatus, staffId, note) {
    var a = db.findByKey('T_APPLICATION', appId);
    if (!a) return { ok: false, error: '申込が見つかりません' };

    // ---- 誰が変えたのか
    var staff = staffId ? db.findByKey('M_STAFF', staffId) : null;
    if (!staff || staff.active === false) {
      return { ok: false,
               error: 'この操作には職員としてのログインが必要です' };
    }

    // ---- その演習林にある状態か
    var known = db.readAll('M_STATUS').some(function (x) {
      return x.forest_id === a.forest_id && x.code === newStatus;
    });
    if (!known) {
      return { ok: false,
               error: 'この演習林にない状態です　' + newStatus };
    }

    var old = a.status;
    db.update('T_APPLICATION', appId, { status: newStatus, updated_at: now() });

    if (newStatus === '許可済' && !a.approved_at) {
      db.update('T_APPLICATION', appId, { approved_at: today() });
    }

    writeAudit(staffId, 'ステータス変更', appId,
               old + ' → ' + newStatus + (note ? '　' + note : ''));

    if (note) {
      addMessage(appId, {
        kind: '所内メモ', from: staffId, body: note
      });
    }
    return { ok: true, from: old, to: newStatus };
  }

  // ------------------------------------------------ カレンダー

  /**
   * 日付ごとの利用状況を返す
   * ★北海道演習林のように件数が多い施設の入口になる
   * @return {Array} [{ date, applications:[], n_apps, n_lodging }]
   */
  function getCalendar(q) {
    var days = db.readAll('T_USAGE_DAY');
    var apps = byId(db.readAll('T_APPLICATION'), 'app_id');
    var users = byId(db.readAll('M_USER'), 'user_id');
    var statuses = db.readAll('M_STATUS');
    var lodgings = db.readAll('T_LODGING');

    var map = {};
    days.forEach(function (d) {
      var a = apps[d.app_id];
      if (!a) return;
      if (q.forest_id && a.forest_id !== q.forest_id) return;
      if (q.from && d.date < q.from) return;
      if (q.to && d.date > q.to) return;

      if (!map[d.date]) map[d.date] = { date: d.date, applications: [], n_lodging: 0 };
      var copy = {};
      for (var k in a) copy[k] = a[k];
      map[d.date].applications.push(decorate(copy, users, statuses));
    });

    lodgings.forEach(function (l) {
      if (map[l.date]) map[l.date].n_lodging += (l.count || 0);
    });

    return Object.keys(map).sort().map(function (k) {
      map[k].n_apps = map[k].applications.length;
      return map[k];
    });
  }

  /**
   * 施設の空き状況を調べる
   * ★「その日に使いたいと言われても使えない」という問題への答え
   */
  function getFacilityAvailability(facilityId, from, to) {
    var f = db.findByKey('M_FACILITY', facilityId);
    if (!f) return null;

    var used = {};
    db.readAll('T_LODGING')
      .filter(function (l) {
        return l.facility_id === facilityId && l.date >= from && l.date <= to;
      })
      .forEach(function (l) {
        used[l.date] = (used[l.date] || 0) + (l.count || 0);
      });

    return eachDate(from, to).map(function (d) {
      var n = used[d] || 0;
      return {
        date: d,
        used: n,
        capacity: f.capacity || null,
        remaining: f.capacity ? (f.capacity - n) : null,
        is_full: f.capacity ? (n >= f.capacity) : false
      };
    });
  }

  // ------------------------------------------------ 利用者と招待

  /**
   * 参加者を招待する
   * ★代表者が入れるのは氏名とメールアドレスだけ
   *   個人情報は本人が直接入れる。代表者には見えない
   */
  /**
   * ご一緒に来られる方を招く
   *
   * ★メールアドレスがないまま利用者を作らない。
   *
   *   作ってしまうと、その方には招待が届かない。
   *   届かなければ、代表者が代わりに生年月日やアレルギーを
   *   聞いて書くことになる。
   *   それは、この設計がなくそうとしている運用そのものである。
   *   （2026-08-20 の試験で、実際に作れてしまうことが分かった）
   *
   * ★同じ方を二重に足さない。
   *   1つの申込に同じ人が2行できると、人数が合わなくなる。
   */
  function inviteParticipants(appId, list) {
    var app = db.findByKey('T_APPLICATION', appId);
    if (!app) {
      throw new Error('申込が見つかりません　' + appId);
    }

    var users = db.readAll('M_USER');
    var byEmail = {};
    users.forEach(function (u) {
      if (u.email) byEmail[String(u.email).toLowerCase()] = u;
    });

    // すでにこの申込に入っている方
    var already = {};
    db.readAll('T_PARTICIPANT').forEach(function (r) {
      if (r.app_id === appId && r.invite_email) {
        already[String(r.invite_email).toLowerCase()] = true;
      }
    });

    var result = { invited: 0, existing: 0, skipped: [] };

    list.forEach(function (p) {
      var email = String(p.email || '').trim().toLowerCase();

      if (!email) {
        result.skipped.push((p.name || '（お名前なし）') + '　メールアドレスがありません');
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        result.skipped.push((p.name || email) + '　メールアドレスの形が正しくありません');
        return;
      }
      if (already[email]) {
        result.skipped.push((p.name || email) + '　すでにこの申込に入っています');
        return;
      }
      already[email] = true;

      var u = byEmail[email];
      var userId;

      if (u) {
        userId = u.user_id;
        result.existing++;
      } else {
        userId = db.nextId('M_USER', 'U');
        db.insert('M_USER', {
          user_id: userId, email: email, name: p.name, updated_at: now()
        });
        byEmail[email] = { user_id: userId, email: email };
        result.invited++;
      }

      db.insert('T_PARTICIPANT', {
        app_id: appId,
        user_id: userId,
        invite_name: p.name,
        invite_email: p.email,
        role: p.role || '参加者',
        reg_status: u ? '登録済' : '招待済',
        invited_at: now(),
        registered_at: u ? u.updated_at : ''
      });
    });
    return result;
  }

  /**
   * 参加者本人が自分の情報を登録・更新する
   * ★代表者はこの内容を見られない
   */
  function saveMyProfile(userId, data) {
    // ★画面側だけの確認では、迂回できてしまう。
    //   ここでも同じことを確かめる。
    //   （2026-08-21　画面には確認があったが、ここには無かった）
    checkProfile(data);

    var allowed = ['name', 'name_kana', 'org', 'org_type', 'status_type',
                   'gender', 'birth_date', 'nationality', 'allergy', 'emergency'];
    var patch = { updated_at: now() };
    allowed.forEach(function (k) {
      if (data[k] !== undefined) patch[k] = data[k];
    });
    db.update('M_USER', userId, patch);

    db.readAll('T_PARTICIPANT')
      .filter(function (p) { return p.user_id === userId && p.reg_status === '招待済'; })
      .forEach(function (p) {
        db.update('T_PARTICIPANT', [p.app_id, p.user_id],
                  { reg_status: '登録済', registered_at: now() });
      });
    return true;
  }

  /**
   * ご本人が登録された内容を確かめる
   *
   * ★画面と同じことを、こちらでも確かめる。
   *   画面の確認は、開発者ツールから迂回できる。
   *   足りないまま入ると、当日になって
   *   「緊急連絡先が分からない」ということが起きる。
   */
  function checkProfile(data) {
    var ng = [];
    var NLC = String.fromCharCode(10);

    var need = [
      ['name',        '氏名'],
      ['name_kana',   'ふりがな'],
      ['org',         'ご所属'],
      ['org_type',    '所属の区分'],
      ['status_type', '身分'],
      ['gender',      '性別'],
      ['birth_date',  '生年月日'],
      ['nationality', '国籍・出身国'],
      ['emergency',   '緊急連絡先']
    ];

    need.forEach(function (r) {
      if (!String(data[r[0]] || '').trim()) {
        ng.push(r[1] + 'が空です');
      }
    });

    // 生年月日　実在する日か
    var b = String(data.birth_date || '');
    if (b && !isDate(b)) {
      ng.push('生年月日が正しくありません　' + b);
    } else if (b) {
      var y = Number(b.slice(0, 4));
      var thisYear = new Date().getFullYear();
      if (y < thisYear - 120 || y > thisYear) {
        ng.push('生年月日の年をご確認ください　' + b);
      }
    }

    // 電話番号　数字の桁数だけを見る
    var tel = String(data.emergency || '').replace(/[^0-9]/g, '');
    if (tel && (tel.length < 9 || tel.length > 11)) {
      ng.push('緊急連絡先の桁数をご確認ください');
    }

    // ふりがな
    if (data.name_kana && !/^[ぁ-んー\s　]+$/.test(String(data.name_kana))) {
      ng.push('ふりがなは、ひらがなでご入力ください');
    }

    // 選択肢にある値か
    [['org_type', 'ORG_TYPE'], ['status_type', 'STATUS_TYPE'],
     ['gender', 'GENDER']].forEach(function (p) {
      var v = data[p[0]];
      if (!v) return;
      var list = OPTIONS[p[1]];
      if (list && list.indexOf(v) < 0) {
        ng.push(p[0] + ' に知らない値が入っています　' + v);
      }
    });

    if (ng.length) {
      throw new Error(
        'ご登録の内容に足りないところがあります' + NLC +
        ng.map(function (x) { return '　・' + x; }).join(NLC));
    }
    return true;
  }

  /**
   * 個人情報を見てよい役割
   *
   * ★必ず「見てよい側」を並べる。「見てはいけない側」を並べてはいけない。
   *   後者だと、綴りの誤り・空文字・新しく増えた役割が、
   *   すべて「見てよい」に落ちてしまう。
   *   （2026-08-20 のテストケースの指摘 P-10）
   */
  var CAN_SEE_PERSONAL = {
    '施設担当者': true,
    '施設管理者': true,
    'システム管理者': true
  };

  /**
   * 参加者の一覧を、権限に応じた見え方で返す
   * ★これがこのシステムの肝。誰が呼ぶかで返る内容が変わる
   */
  function getParticipants(appId, viewerRole) {
    var users = byId(db.readAll('M_USER'), 'user_id');
    var canSee = CAN_SEE_PERSONAL[viewerRole] === true;

    return db.readAll('T_PARTICIPANT')
      .filter(function (p) { return p.app_id === appId; })
      .map(function (p) {
        var u = users[p.user_id] || {};
        var out = {
          user_id: p.user_id,
          name: u.name || p.invite_name,
          role: p.role,
          reg_status: p.reg_status
        };

        // 見てよいと明示された役割でなければ、ここまでしか返さない
        if (!canSee) return out;

        // 職員には宿泊業務に必要な範囲を見せる
        out.org = u.org;
        out.org_type = u.org_type;
        out.status_type = u.status_type;
        out.gender = u.gender;
        out.age = u.birth_date ? ageAt(u.birth_date, new Date()) : null;
        out.allergy = u.allergy;
        out.nationality = u.nationality;

        // 緊急連絡先は伏せる。openEmergencyContact でのみ開く
        out.has_emergency = !!u.emergency;
        return out;
      });
  }

  function ageAt(birth, at) {
    var b = new Date(birth);
    var age = at.getFullYear() - b.getFullYear();
    var m = at.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && at.getDate() < b.getDate())) age--;
    return age;
  }

  /**
   * 緊急連絡先を開く
   * ★開いた記録が必ず残る。これがあるから通常は伏せておける
   */
  function openEmergencyContact(userId, staffId, reason) {
    // ① 誰が開こうとしているかを確かめる
    //    職員として登録されていない者には返さない
    var staff = staffId ? db.findByKey('M_STAFF', staffId) : null;
    if (!staff || staff.active === false || !CAN_SEE_PERSONAL[staff.role]) {
      return { ok: false, error: 'この操作を行う権限がありません' };
    }

    var u = db.findByKey('M_USER', userId);
    if (!u) return { ok: false, error: '該当する方が見つかりません' };

    // ② 記録を先に書く。書けなければ返さない
    //    ★通常は伏せておける根拠が「開いた記録が残ること」なので、
    //      記録が残せない状態で中身を渡してはいけない。
    try {
      writeAudit(staffId, '緊急連絡先を開いた', userId, reason || '');
    } catch (e) {
      return { ok: false, error: '記録を残せなかったため、表示を取りやめました' };
    }

    return { ok: true, user_id: userId, name: u.name, emergency: u.emergency };
  }

  // ------------------------------------------------ 資料とやり取り

  function attachFile(appId, doc) {
    doc.doc_id = db.nextId('T_DOCUMENT', 'D');
    doc.app_id = appId;
    doc.submitted_at = doc.submitted_at || today();
    db.insert('T_DOCUMENT', doc);
    return doc.doc_id;
  }

  function addMessage(appId, msg) {
    msg.msg_id = db.nextId('T_MESSAGE', 'M');
    msg.app_id = appId;
    msg.at = msg.at || now();
    db.insert('T_MESSAGE', msg);
    return msg.msg_id;
  }

  /**
   * 提出が必要な様式のうち、まだ出ていないものを返す
   * ★様式定義（M6）を見て判断するため、演習林ごとの違いを画面が知る必要がない
   */
  function getMissingForms(appId) {
    var a = db.findByKey('T_APPLICATION', appId);
    if (!a) return [];

    var submitted = {};
    db.readAll('T_DOCUMENT')
      .filter(function (d) { return d.app_id === appId; })
      .forEach(function (d) { submitted[d.form_code] = true; });

    return db.readAll('M_FORM')
      .filter(function (f) { return f.forest_id === a.forest_id; })
      .filter(function (f) { return !submitted[f.form_code]; });
  }

  // ------------------------------------------------ 出力

  /**
   * 本部へ渡す月次データを作る
   * ★現在のCSVと同じ「一日一行」の形で出す。受け取り側は何も変えなくてよい
   */
  /**
   * 本部へ出す月次のデータ
   *
   * @param {string} forestId  演習林
   * @param {string} yyyymm    '2026-05' でも '202605' でも受ける
   *
   * ★2026-08-20 の試験で見つかった不具合を直した。
   *
   *   もとは yyyymm + '-01' としていたため、
   *   '202605' を渡すと '202605-01' という文字列になり、
   *   利用日（'2026-05-28' の形）と比べても1件も一致しなかった。
   *
   *   怖いのは、例外ではなく空の配列が返ることだった。
   *   本部への月次が「今月は0件でした」に見えて、
   *   誰も気づけない形で間違いが伝わる。
   *
   *   月末の日も '-31' の決め打ちだったため、
   *   2月や4月では実在しない日を指していた。
   */
  function exportMonthly(forestId, yyyymm) {
    var ym = normalizeYm(yyyymm);
    if (!ym) {
      // ★黙って空を返さない。何が悪いのかを言う
      throw new Error(
        '年月の書き方が正しくありません　' + yyyymm +
        '（2026-05 または 202605 の形でお願いします）');
    }
    var from = ym + '-01';
    var to = ym + '-' + lastDayOf(ym);
    var apps = byId(db.readAll('T_APPLICATION'), 'app_id');
    var out = [];

    // ★同じ申込の同じ日を、二度数えない。
    //
    //   T_USAGE_DAY は［申込ID・日付］が鍵なので、本来は重ならない。
    //   しかし過去のデータには重なっている行があり、
    //   その日の人数が2回足されて、年報と月次の延べ人数が
    //   食い違っていた。（2026-08-20 に判明。AIC で624人の差）
    //
    //   年報のほうが正しい。ここで重なりを落とす。
    var seen = {};

    db.readAll('T_USAGE_DAY')
      .filter(function (d) { return d.date >= from && d.date <= to; })
      .forEach(function (d) {
        var a = apps[d.app_id];
        if (!a || a.forest_id !== forestId) return;

        var key = d.app_id + '/' + d.date;
        if (seen[key]) return;
        seen[key] = true;

        var heads = db.readAll('T_HEADCOUNT').filter(function (h) {
          return h.app_id === d.app_id && h.date === d.date;
        });
        var lodges = db.readAll('T_LODGING').filter(function (l) {
          return l.app_id === d.app_id && l.date === d.date;
        });

        out.push({
          forest: a.forest_id,
          legacy_no: a.legacy_no || a.app_id,
          date: d.date,
          date_from: a.date_from,
          date_to: a.date_to,
          rep_name: (db.findByKey('M_USER', a.rep_user_id) || {}).name || '',
          rep_org: a.rep_org,
          org_type: a.org_type,
          purpose: a.purpose,
          category: a.category,
          place: a.place,
          headcounts: heads,
          lodgings: lodges
        });
      });

    return out.sort(function (x, y) { return x.date < y.date ? -1 : 1; });
  }

  /**
   * 年報の表を作る
   * ★現在エクセルの数式で行っている集計を、この1つの関数で置き換える
   * @return {Array} [{ no, month, days, rep_org, staff, student, grad, other,
   *                    total, foreign, purpose, lodging }]
   */
  function exportNenpo(forestId, fiscalYearNum) {
    var from = fiscalYearNum + '-04-01';
    var to = (fiscalYearNum + 1) + '-03-31';

    var apps = db.readAll('T_APPLICATION').filter(function (a) {
      return a.forest_id === forestId && a.date_from <= to && a.date_to >= from;
    });

    var facilities = byId(db.readAll('M_FACILITY'), 'facility_id');

    var rows = apps.map(function (a) {
      var days = db.readAll('T_USAGE_DAY').filter(function (d) {
        return d.app_id === a.app_id && d.date >= from && d.date <= to;
      });
      // ★その年度に入る日の分だけを数える。
      //
      //   年度をまたぐ申込がある（2025年度の実績で9件）。
      //   日付で絞らないと、同じ人数が2つの年度の年報に
      //   まるごと出てしまう。
      //   例　2025-TNS-0053（2025-07-28 〜 2027-03-31）の73人が、
      //   　　2025年度にも2026年度にも73人として出ていた。
      //   （2026-08-21 に判明）
      var heads = db.readAll('T_HEADCOUNT').filter(function (h) {
        return h.app_id === a.app_id && h.date >= from && h.date <= to;
      });
      var lodges = db.readAll('T_LODGING').filter(function (l) {
        return l.app_id === a.app_id && l.date >= from && l.date <= to;
      });

      var g = { '教職員': 0, '学生': 0, '院生': 0, 'その他': 0 };
      heads.forEach(function (h) {
        var key = NENPO_GROUP[h.status_type] || 'その他';
        g[key] += (h.count || 0);
      });

      var names = {};
      lodges.forEach(function (l) {
        var f = facilities[l.facility_id];
        if (f) names[f.name] = true;
      });
      var lodgingNames = Object.keys(names);

      var first = days.map(function (d) { return d.date; }).sort()[0] || a.date_from;

      return {
        month: parseInt(first.slice(5, 7), 10),
        first_date: first,
        days: days.length,
        rep_org: a.rep_org,
        staff: g['教職員'],
        student: g['学生'],
        grad: g['院生'],
        other: g['その他'],
        total: g['教職員'] + g['学生'] + g['院生'] + g['その他'],
        purpose: a.purpose,
        lodging: lodgingNames.length ? lodgingNames.join('・') : '日帰り'
      };
    });

    // 年度の月順（4月から3月）に並べる
    rows.sort(function (x, y) {
      var fx = x.month >= 4 ? x.month - 4 : x.month + 8;
      var fy = y.month >= 4 ? y.month - 4 : y.month + 8;
      if (fx !== fy) return fx - fy;
      return x.first_date < y.first_date ? -1 : 1;
    });
    rows.forEach(function (r, i) { r.no = i + 1; });
    return rows;
  }

  // ------------------------------------------------ マスタと記録

  function getMasters(forestId) {
    return {
      forests: db.readAll('M_FOREST'),
      facilities: db.readAll('M_FACILITY').filter(function (f) {
        return !forestId || f.forest_id === forestId;
      }),
      statuses: db.readAll('M_STATUS').filter(function (s) {
        return !forestId || s.forest_id === forestId;
      }).sort(function (x, y) { return x.seq - y.seq; }),
      forms: db.readAll('M_FORM').filter(function (f) {
        return !forestId || f.forest_id === forestId;
      }),
      options: OPTIONS
    };
  }

  function writeAudit(staffId, action, target, detail) {
    db.insert('T_AUDIT', {
      at: now(), staff_id: staffId, action: action,
      target: target, detail: detail || '', ip: ''
    });
  }

  function getAudit(q) {
    q = q || {};
    return db.readAll('T_AUDIT').filter(function (r) {
      if (q.staff_id && r.staff_id !== q.staff_id) return false;
      if (q.target && r.target !== q.target) return false;
      if (q.action && r.action.indexOf(q.action) < 0) return false;
      return true;
    }).sort(function (x, y) { return x.at < y.at ? 1 : -1; });
  }

  /** 使うアダプタを差し替える。本番へ移すときはここに渡すものを変える */
  function useAdapter(adapter) { db = adapter; }

  /**
   * いま使っているアダプタを返す
   * ★画面から呼ぶためのものではない。
   *   auth.js のように、API層と同じ立場で動くものだけが使う。
   */
  function adapter() { return db; }

  // ------------------------------------------------ 公開する窓口

  return {
    useAdapter: useAdapter,
    adapter: adapter,

    // 申込
    getApplications: getApplications,
    getApplication: getApplication,
    saveApplication: saveApplication,
    updateStatus: updateStatus,
    markSeen: markSeen,
    markUnseen: markUnseen,
    addMemo: addMemo,
    getMemos: getMemos,
    removeMemo: removeMemo,
    countUnseen: countUnseen,
    setStar: setStar,
    getTags: getTags,
    createTag: createTag,
    updateTag: updateTag,
    toggleTag: toggleTag,
    getAppTags: getAppTags,
    getTagsByApp: getTagsByApp,
    bulk: bulk,

    // 日付と施設
    getCalendar: getCalendar,
    getFacilityAvailability: getFacilityAvailability,

    // 利用者
    inviteParticipants: inviteParticipants,
    saveMyProfile: saveMyProfile,
    getParticipants: getParticipants,
    openEmergencyContact: openEmergencyContact,

    // 資料とやり取り
    attachFile: attachFile,
    addMessage: addMessage,
    getMissingForms: getMissingForms,

    // 出力
    exportMonthly: exportMonthly,
    exportNenpo: exportNenpo,

    // マスタと記録
    getMasters: getMasters,
    getAudit: getAudit
  };
})();
