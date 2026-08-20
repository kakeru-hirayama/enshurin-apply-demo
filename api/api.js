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

  // どのアダプタを使うか。ここ1行だけで保存先が切り替わる。
  var db = MemoryAdapter;

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

    return apps.filter(function (a) {
      if (q.forest_id && a.forest_id !== q.forest_id) return false;
      if (q.status && a.status !== q.status) return false;
      if (q.rep_user_id && a.rep_user_id !== q.rep_user_id) return false;
      if (q.from && a.date_to < q.from) return false;
      if (q.to && a.date_from > q.to) return false;
      if (q.keyword) {
        var hay = [a.purpose, a.rep_org, a.place].join(' ');
        var u = users[a.rep_user_id];
        if (u) hay += ' ' + u.name;
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
  function saveApplication(data) {
    var isNew = !data.app_id;

    if (isNew) {
      var prefix = fiscalYear(data.date_from || today()) + '-' + data.forest_id + '-';
      data.app_id = db.nextId('T_APPLICATION', prefix);
      data.created_at = now();
      data.applied_at = data.applied_at || today();
      data.status = data.status || firstStatusOf(data.forest_id);
    }
    data.updated_at = now();

    if (isNew) {
      db.insert('T_APPLICATION', data);
    } else {
      db.update('T_APPLICATION', data.app_id, data);
    }

    if (data.date_from && data.date_to) {
      syncUsageDays(data.app_id, data.date_from, data.date_to);
    }
    return data.app_id;
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
  function updateStatus(appId, newStatus, staffId, note) {
    var a = db.findByKey('T_APPLICATION', appId);
    if (!a) return { ok: false, error: '申込が見つかりません' };

    var old = a.status;
    db.update('T_APPLICATION', appId, { status: newStatus, updated_at: now() });

    if (newStatus === '許可済' && !a.approved_at) {
      db.update('T_APPLICATION', appId, { approved_at: today() });
    }

    writeAudit(staffId, 'ステータス変更', appId, old + ' → ' + newStatus);

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
  function inviteParticipants(appId, list) {
    var users = db.readAll('M_USER');
    var byEmail = {};
    users.forEach(function (u) { byEmail[u.email] = u; });

    var result = { invited: 0, existing: 0 };

    list.forEach(function (p) {
      var u = byEmail[p.email];
      var userId;

      if (u) {
        userId = u.user_id;
        result.existing++;
      } else {
        userId = db.nextId('M_USER', 'U');
        db.insert('M_USER', {
          user_id: userId, email: p.email, name: p.name, updated_at: now()
        });
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
  function exportMonthly(forestId, yyyymm) {
    var from = yyyymm + '-01';
    var to = yyyymm + '-31';
    var apps = byId(db.readAll('T_APPLICATION'), 'app_id');
    var out = [];

    db.readAll('T_USAGE_DAY')
      .filter(function (d) { return d.date >= from && d.date <= to; })
      .forEach(function (d) {
        var a = apps[d.app_id];
        if (!a || a.forest_id !== forestId) return;

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
      var heads = db.readAll('T_HEADCOUNT').filter(function (h) {
        return h.app_id === a.app_id;
      });
      var lodges = db.readAll('T_LODGING').filter(function (l) {
        return l.app_id === a.app_id;
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
