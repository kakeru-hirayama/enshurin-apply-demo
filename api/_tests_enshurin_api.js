/**
 * 演習林 利用申込システム — APIテスト
 *
 * 対象: src/docs/API仕様.md v0.1
 * 依存ライブラリなし。node tests_enshurin_api.js で実行できます。
 *
 * ── 使い方 ─────────────────────────────────────────────
 *   1) このファイルを src/api/ の隣に置く
 *   2) 下の loadApi() が、あなたの api.js の読み込み方に合っているか確認する
 *   3) node tests_enshurin_api.js
 *
 *   GAS（グローバル関数）でもCommonJSでも動くよう、loadApi() で吸収しています。
 *   Google Apps Script 上で走らせる場合は、末尾の main() を
 *   そのままエディタから実行してください（console.log がログに出ます）。
 *
 * ── 方針 ───────────────────────────────────────────────
 *   ・仕様書に書かれた入出力だけを見る（ブラックボックス）
 *   ・落ちてほしいテストは、落ちること自体が成果です。
 *     とくに P-01〜P-04（代表者に個人情報が漏れない）と
 *     P-14〜P-15（緊急連絡先の監査ログ）は、仕様どおりでも
 *     実装によっては素通りしてしまう箇所です。
 *   ・仕様が定まっていない箇所は t.pending() で「要確認」として記録し、
 *     失敗にはしません。
 */

'use strict';

// ═══════════════════════════════════════════════════════════
// 0. APIの読み込み
// ═══════════════════════════════════════════════════════════

function loadApi() {
  // (a) CommonJS
  if (typeof require === 'function') {
    try { return require('./api.js'); } catch (e) { /* fallthrough */ }
    try { return require('./api/api.js'); } catch (e) { /* fallthrough */ }
  }
  // (b) GAS / ブラウザのグローバル
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (typeof g.getApplications === 'function') return g;
  throw new Error(
    'api.js を読み込めませんでした。loadApi() のパスを直してください。'
  );
}

function loadMemoryAdapter() {
  if (typeof require === 'function') {
    try { return require('./adapter_memory.js'); } catch (e) {}
    try { return require('./api/adapter_memory.js'); } catch (e) {}
  }
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (g.MemoryAdapter) return g.MemoryAdapter;
  return null;
}

var API = null;          // main() で入る
var MemoryAdapter = null;

// ═══════════════════════════════════════════════════════════
// 1. ごく小さいテストハーネス
// ═══════════════════════════════════════════════════════════

var results = [];   // { id, kbn, title, state, message }

function suite(kbn) {
  return function (id, title, fn) {
    var rec = { id: id, kbn: kbn, title: title, state: 'PASS', message: '' };
    try {
      fn(makeT(rec));
    } catch (e) {
      if (e && e.__pending) {
        rec.state = 'PENDING';
        rec.message = e.message;
      } else if (e && e.__skip) {
        rec.state = 'SKIP';
        rec.message = e.message;
      } else {
        rec.state = 'FAIL';
        rec.message = (e && e.message) ? e.message : String(e);
      }
    }
    results.push(rec);
  };
}

function makeT(rec) {
  return {
    eq: function (actual, expected, msg) {
      var a = JSON.stringify(actual), b = JSON.stringify(expected);
      if (a !== b) throw new Error((msg || '') + ' 期待=' + b + ' 実際=' + a);
    },
    ok: function (cond, msg) {
      if (!cond) throw new Error(msg || '条件を満たしませんでした');
    },
    notOk: function (cond, msg) {
      if (cond) throw new Error(msg || '条件を満たしてしまいました');
    },
    /** 呼ぶと必ず例外/エラー返却になることを確かめる */
    rejects: function (fn, msg) {
      var threw = false, ret;
      try { ret = fn(); } catch (e) { threw = true; }
      var errShaped = ret && typeof ret === 'object' && ret.ok === false;
      if (!threw && !errShaped) {
        throw new Error((msg || '') + ' 例外もエラー返却も起きませんでした。返り値=' + JSON.stringify(ret));
      }
    },
    /** 仕様が未確定な箇所 */
    pending: function (msg) { var e = new Error(msg); e.__pending = true; throw e; },
    skip: function (msg) { var e = new Error(msg); e.__skip = true; throw e; },
    note: function (msg) { rec.message = (rec.message ? rec.message + ' / ' : '') + msg; }
  };
}

// ═══════════════════════════════════════════════════════════
// 2. テスト用の下ごしらえ
// ═══════════════════════════════════════════════════════════

/** 各テストの前にデータを初期化する。実装に合わせてここだけ直してください。 */
function reset() {
  if (MemoryAdapter && typeof MemoryAdapter.reset === 'function') {
    MemoryAdapter.reset();
  } else if (API.useAdapter && MemoryAdapter) {
    API.useAdapter(MemoryAdapter);
  }
  // マスタは各テストの前提なので、消したあとに入れ直す
  if (typeof __seedMasters === 'function') __seedMasters();
}

/** 最小構成の申込を1件作る */
function seedApplication(over) {
  over = over || {};
  var d = {
    app_id: '',
    forest_id: over.forest_id || 'HKD',
    rep_user_id: over.rep_user_id || 'U0001',
    rep_org: over.rep_org || '東京大学大学院農学生命科学研究科',
    purpose: over.purpose || '土壌断面の調査',
    category: over.category || '研究',
    date_from: over.date_from || '2026-09-01',
    date_to: over.date_to || '2026-09-05'
  };
  return API.saveApplication(d);
}

/** 日付文字列の配列を作る（テスト側の期待値生成用。実装とは独立に計算する） */
function dateRange(from, to) {
  var out = [], cur = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z');
  var guard = 0;
  while (cur <= end && guard++ < 4000) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}

/** 参加者オブジェクトから、個人情報にあたるキーが1つでもあるか */
var SENSITIVE_KEYS = [
  'org', 'org_type', 'status_type', 'gender', 'age', 'birth_date',
  'allergy', 'nationality', 'emergency', 'has_emergency',
  'name_kana', 'address', 'phone'
];
function sensitiveKeysIn(obj) {
  return Object.keys(obj || {}).filter(function (k) {
    return SENSITIVE_KEYS.indexOf(k) >= 0;
  });
}

// ═══════════════════════════════════════════════════════════
// 3. 正常系
// ═══════════════════════════════════════════════════════════

function testsNormal() {
  var test = suite('正常系');

  test('N-11', 'saveApplication: 新規のとき YYYY-FID-NNNN で採番される', function (t) {
    reset();
    var id = seedApplication({ forest_id: 'HKD', date_from: '2026-09-01', date_to: '2026-09-05' });
    t.ok(typeof id === 'string' && id.length > 0, 'app_id が文字列で返ること');
    t.ok(/^\d{4}-[A-Z]{2,4}-\d{4}$/.test(id), '採番形式が YYYY-FID-NNNN であること 実際=' + id);
  });

  test('N-12', 'saveApplication: 2件目は連番が進む', function (t) {
    reset();
    var a = seedApplication();
    var b = seedApplication();
    t.notOk(a === b, '2件目に同じIDが振られないこと');
    var na = parseInt(a.split('-').pop(), 10);
    var nb = parseInt(b.split('-').pop(), 10);
    t.eq(nb, na + 1, '連番が1つ進むこと');
  });

  test('N-13', 'saveApplication: 新規のとき初期ステータスが入る', function (t) {
    reset();
    var id = seedApplication();
    var app = API.getApplication(id);
    t.ok(app, '保存した申込が取得できること');
    t.ok(app.status && String(app.status).length > 0, 'status が空でないこと 実際=' + app.status);
  });

  test('N-14', 'saveApplication: 期間から利用日が1日ずつ作られる', function (t) {
    reset();
    var id = seedApplication({ date_from: '2026-09-01', date_to: '2026-09-05' });
    var app = API.getApplication(id);
    t.eq(app.days, dateRange('2026-09-01', '2026-09-05'), '利用日が5件、日付昇順で生成されること');
    t.eq(app.n_days, 5, 'n_days が5であること');
  });

  test('N-15', 'saveApplication: app_id つきは更新であり件数が増えない', function (t) {
    reset();
    var id = seedApplication();
    var before = API.getApplications({}).length;
    var id2 = API.saveApplication({ app_id: id, forest_id: 'HKD', rep_user_id: 'U0001',
      date_from: '2026-09-01', date_to: '2026-09-05', purpose: '変更後' });
    var after = API.getApplications({}).length;
    t.eq(id2, id, '同じ app_id が返ること');
    t.eq(after, before, '申込の件数が増えないこと');
    t.eq(API.getApplication(id).purpose, '変更後', 'purpose が更新されていること');
  });

  test('N-16', 'updateStatus: from と to を返す', function (t) {
    reset();
    var id = seedApplication();
    var before = API.getApplication(id).status;
    var r = API.updateStatus(id, '許可済', 'S001', '書類を確認した');
    t.ok(r && r.ok === true, 'ok:true が返ること 実際=' + JSON.stringify(r));
    t.eq(r.from, before, 'from が変更前のステータスであること');
    t.eq(r.to, '許可済', 'to が変更後のステータスであること');
  });

  test('N-17', 'updateStatus: 操作ログが残る', function (t) {
    reset();
    var id = seedApplication();
    var before = API.getAudit({ target: id }).length;
    API.updateStatus(id, '許可済', 'S001', 'メモ');
    var log = API.getAudit({ target: id });
    t.ok(log.length > before, '操作ログが増えること');
    t.ok(log.some(function (x) { return x.staff_id === 'S001'; }), 'staff_id が記録されること');
  });

  test('N-18', 'updateStatus: 許可済にすると許可日が入る', function (t) {
    reset();
    var id = seedApplication();
    API.updateStatus(id, '許可済', 'S001');
    var app = API.getApplication(id);
    t.ok(app.approved_at && String(app.approved_at).length > 0, 'approved_at に日付が入ること');
  });

  test('N-19', 'updateStatus: 既にある許可日は上書きされない', function (t) {
    reset();
    var id = seedApplication();
    API.updateStatus(id, '許可済', 'S001');
    var first = API.getApplication(id).approved_at;
    API.updateStatus(id, '審査中', 'S001');
    API.updateStatus(id, '許可済', 'S001');
    t.eq(API.getApplication(id).approved_at, first, '許可日が2回目の許可で書き換わらないこと');
  });

  test('N-20', 'updateStatus: note があると所内メモが1件増える', function (t) {
    reset();
    var id = seedApplication();
    var before = API.getApplication(id).messages.length;
    API.updateStatus(id, '許可済', 'S001', '林道の安全を確認した');
    var after = API.getApplication(id).messages;
    t.eq(after.length, before + 1, 'やり取りが1件増えること');
    t.ok(after.some(function (m) { return String(m.body).indexOf('林道の安全') >= 0; }),
      'note の本文が残ること');
  });

  test('N-21', 'updateStatus: note がなければ所内メモは増えない', function (t) {
    reset();
    var id = seedApplication();
    var before = API.getApplication(id).messages.length;
    API.updateStatus(id, '許可済', 'S001');
    t.eq(API.getApplication(id).messages.length, before, 'やり取りが増えないこと');
  });

  test('N-25', 'inviteParticipants: 新規と既存を数え分ける', function (t) {
    reset();
    var id = seedApplication();
    var r1 = API.inviteParticipants(id, [{ name: '山田 太郎', email: 'yamada@example.ac.jp' }]);
    t.eq(r1.invited, 1, '1人目は新規');
    t.eq(r1.existing, 0, '1人目は既存0');
    var r2 = API.inviteParticipants(id, [
      { name: '山田 太郎', email: 'yamada@example.ac.jp' },
      { name: '佐藤 花子', email: 'sato@example.ac.jp' }
    ]);
    t.eq(r2.existing, 1, '2回目は山田が既存として数えられること');
    t.eq(r2.invited, 1, '佐藤だけが新規として数えられること');
  });

  test('N-26', 'inviteParticipants: 招待直後は招待済', function (t) {
    reset();
    var id = seedApplication();
    API.inviteParticipants(id, [{ name: '山田 太郎', email: 'yamada@example.ac.jp' }]);
    var ps = API.getParticipants(id, '施設担当者');
    var y = (ps || []).filter(function (p) { return p.name === '山田 太郎'; })[0];
    t.ok(y, '招待した人が参加者一覧に出ること');
    t.eq(y.reg_status, '招待済', '登録状況が招待済であること');
  });

  test('N-27', 'saveMyProfile: 招待済がすべて登録済になる', function (t) {
    reset();
    var a = seedApplication();
    var b = seedApplication();
    API.inviteParticipants(a, [{ name: '山田 太郎', email: 'yamada@example.ac.jp' }]);
    API.inviteParticipants(b, [{ name: '山田 太郎', email: 'yamada@example.ac.jp' }]);
    var f = (API.getParticipants(a, '施設担当者') || [])
      .filter(function (p) { return p.name === '山田 太郎'; })[0];
    if (!f) t.skip('参加者が取得できないため未実施');
    var uid = f.user_id;
    API.saveMyProfile(uid, { name: '山田 太郎', org: 'A大学', gender: '男' });
    [a, b].forEach(function (appId) {
      var p = API.getParticipants(appId, '施設担当者')
        .filter(function (x) { return x.user_id === uid; })[0];
      t.eq(p.reg_status, '登録済', appId + ' の登録状況が登録済になること');
    });
  });

  test('N-28', 'saveMyProfile: 渡した項目だけが更新される', function (t) {
    reset();
    var a = seedApplication();
    API.inviteParticipants(a, [{ name: '山田 太郎', email: 'yamada@example.ac.jp' }]);
    var p0 = (API.getParticipants(a, '施設担当者') || [])[0];
    if (!p0) t.skip('参加者が取得できないため未実施');
    var uid = p0.user_id;
    API.saveMyProfile(uid, { org: 'A大学', gender: '男' });
    API.saveMyProfile(uid, { gender: '女' });
    var p = API.getParticipants(a, '施設担当者')
      .filter(function (x) { return x.user_id === uid; })[0];
    t.eq(p.org, 'A大学', '渡さなかった org が保持されること');
    t.eq(p.gender, '女', '渡した gender が更新されること');
  });

  test('N-31', 'getMissingForms: 提出済みの様式は返らない', function (t) {
    reset();
    var id = seedApplication();
    var before = API.getMissingForms(id);
    if (!before.length) t.skip('様式マスタ(M6)にHKDの様式が入っていないため未実施');
    var code = before[0].form_code;
    API.attachFile(id, { phase: '事前', kind: '計画書', form_code: code,
      file_name: 'x.pdf', file_id: 'drive:x', submitted_at: '2026-08-01' });
    var after = API.getMissingForms(id);
    t.notOk(after.some(function (f) { return f.form_code === code; }),
      '提出した様式が未提出一覧から消えること');
  });

  test('N-35', 'getAudit: 新しい順に返る', function (t) {
    reset();
    var id = seedApplication();
    API.updateStatus(id, '審査中', 'S001');
    API.updateStatus(id, '許可済', 'S002');
    var log = API.getAudit({ target: id });
    t.ok(log.length >= 2, 'ログが2件以上あること');
    for (var i = 1; i < log.length; i++) {
      t.ok(String(log[i - 1].at) >= String(log[i].at), 'at の降順で並ぶこと');
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 4. 境界
// ═══════════════════════════════════════════════════════════

function testsBoundary() {
  var test = suite('境界');

  test('B-01', 'getApplications: 0件でも空配列を返す', function (t) {
    reset();
    var r = API.getApplications({});
    t.ok(Array.isArray(r), '配列が返ること');
    t.eq(r.length, 0, '空であること');
  });

  test('B-02', 'getApplications: 1件のとき長さ1', function (t) {
    reset();
    seedApplication();
    t.eq(API.getApplications({}).length, 1, '1件返ること');
  });

  test('B-03', 'getApplications: 大量件数でも件数が切られない', function (t) {
    reset();
    var N = 200;   // 1000件は時間がかかるので既定は200。必要なら上げてください
    for (var i = 0; i < N; i++) seedApplication({ date_from: '2026-09-01', date_to: '2026-09-01' });
    t.eq(API.getApplications({}).length, N, N + '件すべてが返ること');
  });

  test('B-04', 'getApplications: from が利用終了日と同日なら含まれる', function (t) {
    reset();
    seedApplication({ date_from: '2026-09-10', date_to: '2026-09-20' });
    t.eq(API.getApplications({ from: '2026-09-20' }).length, 1, '境界日を含むこと');
  });

  test('B-05', 'getApplications: from が利用終了日の翌日なら含まれない', function (t) {
    reset();
    seedApplication({ date_from: '2026-09-10', date_to: '2026-09-20' });
    t.eq(API.getApplications({ from: '2026-09-21' }).length, 0, '1日ずれたら外れること');
  });

  test('B-06', 'getApplications: to が利用開始日と同日なら含まれる', function (t) {
    reset();
    seedApplication({ date_from: '2026-09-10', date_to: '2026-09-20' });
    t.eq(API.getApplications({ to: '2026-09-10' }).length, 1, '境界日を含むこと');
  });

  test('B-07', 'saveApplication: 期間が1日なら利用日は1件', function (t) {
    reset();
    var id = seedApplication({ date_from: '2026-09-01', date_to: '2026-09-01' });
    t.eq(API.getApplication(id).days.length, 1, '1件だけ生成されること');
  });

  test('B-08', 'saveApplication: 1年分の期間で365件', function (t) {
    reset();
    var id = seedApplication({ date_from: '2025-04-01', date_to: '2026-03-31' });
    t.eq(API.getApplication(id).days.length, 365, '365件生成されること');
  });

  test('B-09', 'saveApplication: うるう日が含まれる', function (t) {
    reset();
    var id = seedApplication({ date_from: '2024-02-01', date_to: '2024-03-01' });
    var days = API.getApplication(id).days;
    t.ok(days.indexOf('2024-02-29') >= 0, 'うるう日 2024-02-29 が含まれること');
    t.eq(days.length, 30, '2/1〜3/1 で30件であること');
  });

  test('B-10', 'saveApplication: 年をまたぐ期間', function (t) {
    reset();
    var id = seedApplication({ date_from: '2026-12-30', date_to: '2027-01-02' });
    t.eq(API.getApplication(id).days,
      ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'], '年をまたいで4件');
  });

  test('B-11', 'getFacilityAvailability: 定員ちょうどは満室', function (t) {
    if (!API.getFacilityAvailability) return; // 未実装なら黙って飛ばす
    reset();
    var r;
    try { r = API.getFacilityAvailability('F001', '2026-09-02', '2026-09-02'); }
    catch (e) { t.skip('施設マスタが未投入のため未実施: ' + e.message); }
    if (!r || !r.length) t.skip('施設マスタが未投入のため未実施');
    var d = r[0];
    if (d.capacity == null) t.skip('capacity 未設定の施設のため未実施');
    if (d.used === d.capacity) {
      t.eq(d.remaining, 0, '残0であること');
      t.eq(d.is_full, true, '満室と判定されること');
    } else {
      t.skip('used が capacity と一致するデータが用意されていないため未実施');
    }
  });

  test('B-13', 'getFacilityAvailability: capacity 未設定なら null と false', function (t) {
    if (!API.getFacilityAvailability) return;
    reset();
    var r;
    try { r = API.getFacilityAvailability('F999', '2026-09-01', '2026-09-03'); }
    catch (e) { t.skip('未実施: ' + e.message); }
    if (!r || !r.length) t.skip('対象施設がないため未実施');
    r.forEach(function (d) {
      t.eq(d.capacity, null, 'capacity が null');
      t.eq(d.remaining, null, 'remaining が null');
      t.eq(d.is_full, false, 'is_full が常に false');
    });
  });

  test('B-14', 'getFacilityAvailability: 利用のない日も返る', function (t) {
    if (!API.getFacilityAvailability) return;
    reset();
    var r;
    try { r = API.getFacilityAvailability('F001', '2027-01-01', '2027-01-03'); }
    catch (e) { t.skip('未実施: ' + e.message); }
    if (!r) t.skip('未実施');
    t.eq(r.length, 3, '期間内の全日付が返ること');
  });

  test('B-15', 'getCalendar: 利用のない期間は空配列', function (t) {
    reset();
    var r = API.getCalendar({ forest_id: 'HKD', from: '2027-01-01', to: '2027-01-31' });
    t.ok(Array.isArray(r), '配列が返ること');
    t.eq(r.length, 0, '利用のない日は含まれないこと');
  });

  test('B-17', 'inviteParticipants: 空配列でも落ちない', function (t) {
    reset();
    var id = seedApplication();
    var r = API.inviteParticipants(id, []);
    t.eq(r, { invited: 0, existing: 0 }, '0件として返ること');
  });

  test('B-18', 'inviteParticipants: 同一メールが重複しても1名', function (t) {
    reset();
    var id = seedApplication();
    API.inviteParticipants(id, [
      { name: '山田 太郎', email: 'dup@example.ac.jp' },
      { name: '山田 太郎', email: 'dup@example.ac.jp' }
    ]);
    var n = API.getParticipants(id, '施設担当者')
      .filter(function (p) { return p.name === '山田 太郎'; }).length;
    t.eq(n, 1, '参加者が2行に増えないこと');
  });

  test('B-20', 'getParticipants: 参加者0名なら空配列', function (t) {
    reset();
    var id = seedApplication();
    var r = API.getParticipants(id, '施設担当者');
    t.ok(Array.isArray(r), '配列が返ること');
  });

  test('B-21', 'exportNenpo: 該当0件なら空配列', function (t) {
    reset();
    var r = API.exportNenpo('HKD', 2099);
    t.ok(Array.isArray(r), '配列が返ること');
    t.eq(r.length, 0, '空であること');
  });

  test('B-22', 'exportNenpo: 年度の下端（4/1）が含まれ、3/31は含まれない', function (t) {
    reset();
    seedApplication({ date_from: '2025-03-31', date_to: '2025-03-31' });
    seedApplication({ date_from: '2025-04-01', date_to: '2025-04-01' });
    var r = API.exportNenpo('HKD', 2025);
    t.eq(r.length, 1, '2025年度は4/1の1件だけであること 実際=' + r.length);
  });

  test('B-23', 'exportNenpo: 年度の上端（翌3/31）が含まれ、4/1は含まれない', function (t) {
    reset();
    seedApplication({ date_from: '2026-03-31', date_to: '2026-03-31' });
    seedApplication({ date_from: '2026-04-01', date_to: '2026-04-01' });
    var r = API.exportNenpo('HKD', 2025);
    t.eq(r.length, 1, '2025年度は2026-03-31の1件だけであること 実際=' + r.length);
  });

  test('B-26', 'exportMonthly: 月をまたぐ申込は当月分だけ出る', function (t) {
    reset();
    seedApplication({ date_from: '2026-05-28', date_to: '2026-06-03' });
    var r = API.exportMonthly('HKD', '202605');
    t.eq(r.length, 4, '5/28〜5/31 の4行であること 実際=' + r.length);
    r.forEach(function (row) {
      t.ok(String(row.date).indexOf('2026-05') === 0, '全行が5月の日付であること 実際=' + row.date);
    });
  });
}

// ═══════════════════════════════════════════════════════════
// 5. 異常系
// ═══════════════════════════════════════════════════════════

function testsError() {
  var test = suite('異常系');

  test('E-01', 'getApplication: 存在しないIDは null', function (t) {
    reset();
    t.eq(API.getApplication('9999-XXX-9999'), null, 'null が返ること');
  });

  test('E-02', 'getApplication: 空文字は null', function (t) {
    reset();
    t.eq(API.getApplication(''), null, 'null が返ること');
  });

  test('E-03', 'getApplication: null / undefined でも落ちない', function (t) {
    reset();
    t.eq(API.getApplication(null), null, 'null 入力で null');
    t.eq(API.getApplication(undefined), null, 'undefined 入力で null');
  });

  test('E-04', 'saveApplication: forest_id 欠落はエラー', function (t) {
    reset();
    t.rejects(function () {
      return API.saveApplication({ rep_user_id: 'U1', date_from: '2026-09-01', date_to: '2026-09-05' });
    }, 'forest_id なしで保存できてしまいました');
    t.eq(API.getApplications({}).length, 0, '申込が作られていないこと');
  });

  test('E-05', 'saveApplication: rep_user_id 欠落はエラー', function (t) {
    reset();
    t.rejects(function () {
      return API.saveApplication({ forest_id: 'HKD', date_from: '2026-09-01', date_to: '2026-09-05' });
    }, 'rep_user_id なしで保存できてしまいました');
  });

  test('E-06', 'saveApplication: date_from 欠落はエラー', function (t) {
    reset();
    t.rejects(function () {
      return API.saveApplication({ forest_id: 'HKD', rep_user_id: 'U1', date_to: '2026-09-05' });
    }, 'date_from なしで保存できてしまいました');
  });

  test('E-07', 'saveApplication: date_to 欠落はエラー', function (t) {
    reset();
    t.rejects(function () {
      return API.saveApplication({ forest_id: 'HKD', rep_user_id: 'U1', date_from: '2026-09-01' });
    }, 'date_to なしで保存できてしまいました');
  });

  test('E-08', '★saveApplication: 終了 < 開始 はエラー（利用日が壊れない）', function (t) {
    reset();
    var id = null, threw = false;
    try {
      id = API.saveApplication({ forest_id: 'HKD', rep_user_id: 'U1',
        date_from: '2026-09-05', date_to: '2026-09-01' });
    } catch (e) { threw = true; }
    if (threw) return;                    // エラーになれば合格
    if (id && typeof id === 'string') {
      var app = API.getApplication(id);
      var n = (app && app.days) ? app.days.length : -1;
      throw new Error('日付の逆転が受理されました。app_id=' + id + ' 利用日=' + n + '件');
    }
    // ok:false の形で返っていれば合格
    t.ok(id && id.ok === false, '逆転した期間が拒否されること 実際=' + JSON.stringify(id));
  });

  test('E-09', 'saveApplication: 存在しない日付はエラー', function (t) {
    reset();
    var id = null, threw = false;
    try {
      id = API.saveApplication({ forest_id: 'HKD', rep_user_id: 'U1',
        date_from: '2026-13-45', date_to: '2026-13-46' });
    } catch (e) { threw = true; }
    if (threw) return;
    if (id && typeof id === 'string') {
      var days = (API.getApplication(id) || {}).days || [];
      var bad = days.filter(function (d) { return !/^\d{4}-\d{2}-\d{2}$/.test(String(d)); });
      t.eq(bad, [], '不正な日付が利用日として保存されないこと 実際=' + JSON.stringify(bad.slice(0, 5)));
      throw new Error('存在しない日付が受理されました。app_id=' + id);
    }
  });

  test('E-11', 'saveApplication: 未定義の forest_id はエラー', function (t) {
    reset();
    t.rejects(function () {
      return API.saveApplication({ forest_id: 'ZZZ', rep_user_id: 'U1',
        date_from: '2026-09-01', date_to: '2026-09-05' });
    }, '未定義の演習林で保存できてしまいました');
  });

  test('E-13', 'updateStatus: 存在しない申込は ok:false', function (t) {
    reset();
    var r = API.updateStatus('9999-XXX-9999', '許可済', 'S001');
    t.eq(r.ok, false, 'ok:false が返ること');
    t.ok(r.error && String(r.error).length > 0, 'error にメッセージが入ること');
  });

  test('E-14', 'updateStatus: 未定義のステータスは拒否される', function (t) {
    reset();
    var id = seedApplication();
    var before = API.getApplication(id).status;
    var r = API.updateStatus(id, 'この値はM5にない', 'S001');
    if (r && r.ok === true) {
      throw new Error('M5に定義のないステータスが保存されました 実際=' + API.getApplication(id).status);
    }
    t.eq(API.getApplication(id).status, before, 'ステータスが変わっていないこと');
  });

  test('E-15', 'updateStatus: staffId なしは拒否される', function (t) {
    reset();
    var id = seedApplication();
    var r;
    try { r = API.updateStatus(id, '許可済'); } catch (e) { return; }
    if (r && r.ok === true) {
      throw new Error('誰が変えたか不明のままステータス変更が通りました');
    }
  });

  test('E-17', 'inviteParticipants: 存在しない申込はエラー', function (t) {
    reset();
    t.rejects(function () {
      return API.inviteParticipants('9999-XXX-9999', [{ name: 'a', email: 'a@example.ac.jp' }]);
    }, '存在しない申込に参加者を足せてしまいました');
  });

  test('E-18', 'inviteParticipants: email が空なら利用者を作らない', function (t) {
    reset();
    var id = seedApplication();
    var r;
    try { r = API.inviteParticipants(id, [{ name: '山田 太郎', email: '' }]); }
    catch (e) { return; }                 // エラーなら合格
    var ps = API.getParticipants(id, '施設担当者');
    t.eq(ps.length, 0, 'email 空の参加者が作られないこと 実際=' + JSON.stringify(ps));
  });

  test('E-19', 'inviteParticipants: email の形式が不正なら拒否', function (t) {
    reset();
    var id = seedApplication();
    var r;
    try { r = API.inviteParticipants(id, [{ name: 'a', email: 'yamada' }]); }
    catch (e) { return; }
    var ps = API.getParticipants(id, '施設担当者');
    if (ps.length > 0) {
      t.pending('メールアドレスの形式チェックが未実装。招待メールが送れない行が作られます');
    }
  });

  test('E-20', 'saveMyProfile: 存在しない利用者は作られない', function (t) {
    reset();
    var r;
    try { r = API.saveMyProfile('U9999-not-exist', { name: 'x' }); } catch (e) { return; }
    t.pending('存在しない user_id への saveMyProfile が黙って通っていないか要確認（返り値=' + JSON.stringify(r) + '）');
  });

  test('E-21', '★saveMyProfile: user_id は書き換えられない', function (t) {
    reset();
    var id = seedApplication();
    API.inviteParticipants(id, [
      { name: '本人', email: 'me@example.ac.jp' },
      { name: '他人', email: 'other@example.ac.jp' }
    ]);
    var ps = API.getParticipants(id, '施設担当者') || [];
    var me = ps.filter(function (p) { return p.name === '本人'; })[0];
    var other = ps.filter(function (p) { return p.name === '他人'; })[0];
    if (!me || !other) t.skip('参加者が取得できないため未実施');
    API.saveMyProfile(me.user_id, { user_id: other.user_id, name: '書き換え後' });
    var after = API.getParticipants(id, '施設担当者');
    var otherAfter = after.filter(function (p) { return p.user_id === other.user_id; })[0];
    t.eq(otherAfter.name, '他人', '他人のレコードが書き換わらないこと');
  });

  test('E-22', '★saveMyProfile: 登録状況は本人に書き換えさせない', function (t) {
    reset();
    var id = seedApplication();
    API.inviteParticipants(id, [{ name: '山田 太郎', email: 'y@example.ac.jp' }]);
    var p1 = (API.getParticipants(id, '施設担当者') || [])[0];
    if (!p1) t.skip('参加者が取得できないため未実施');
    var uid = p1.user_id;
    API.saveMyProfile(uid, { reg_status: '承認済', role: '職員' });
    var p = API.getParticipants(id, '施設担当者')[0];
    t.notOk(p.reg_status === '承認済', 'reg_status に任意の値を入れられないこと 実際=' + p.reg_status);
    t.notOk(p.role === '職員', 'role を本人に書き換えさせないこと 実際=' + p.role);
  });

  test('E-23', 'openEmergencyContact: 存在しない利用者はエラー', function (t) {
    reset();
    t.rejects(function () {
      return API.openEmergencyContact('U9999-not-exist', 'S001', '救急対応');
    }, '存在しない利用者の緊急連絡先を開けてしまいました');
  });

  test('E-27', 'getMissingForms: 存在しない申込でも落ちない', function (t) {
    reset();
    var r;
    try { r = API.getMissingForms('9999-XXX-9999'); } catch (e) {
      throw new Error('例外で落ちました: ' + e.message);
    }
    t.ok(Array.isArray(r) || r === null, '配列か null が返ること');
  });

  test('E-28', 'exportNenpo: 存在しない演習林でも落ちない', function (t) {
    reset();
    var r = API.exportNenpo('ZZZ', 2025);
    t.ok(Array.isArray(r), '配列が返ること');
    t.eq(r.length, 0, '空であること');
  });

  test('E-30', 'exportMonthly: yyyymm の形式が不正なら黙って空を返さない', function (t) {
    reset();
    seedApplication({ date_from: '2026-05-01', date_to: '2026-05-03' });
    var r;
    try { r = API.exportMonthly('HKD', '2026-05'); } catch (e) { return; }
    if (Array.isArray(r) && r.length === 0) {
      t.pending("'2026-05' が黙って空配列になります。エラーにするか正規化するかを決めてください");
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 6. 権限（最重要）
// ═══════════════════════════════════════════════════════════

function skipError(msg) { var e = new Error(msg); e.__skip = true; return e; }

/** 個人情報つきの参加者を1名用意して、appId と user_id を返す */
function seedParticipantWithPII() {
  var id = seedApplication();
  API.inviteParticipants(id, [{ name: '三宅 大和', email: 'miyake@example.ac.jp' }]);
  var found = (API.getParticipants(id, '施設担当者') || [])
    .filter(function (p) { return p && p.name === '三宅 大和'; })[0];
  if (!found) {
    throw skipError('前提を用意できませんでした。inviteParticipants の直後に '
      + 'getParticipants で参加者が返っていません（未実装か、参加者テーブル未接続）。'
      + 'このテストは権限の検証が本体なので、参加者が取得できるようになってから再実行してください');
  }
  var uid = found.user_id;
  API.saveMyProfile(uid, {
    name: '三宅 大和',
    name_kana: 'ミヤケ ヤマト',
    org: '東京大学大学院農学生命科学研究科',
    org_type: '東大・農',
    status_type: '教職員',
    gender: '男',
    birth_date: '1985-03-01',
    nationality: '日本',
    allergy: 'ハチアレルギー',
    emergency: '090-0000-1024'
  });
  return { appId: id, userId: uid };
}

function testsPermission() {
  var test = suite('権限');

  test('P-01', '★代表者には個人情報を返さない（キーの検査）', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var ps = API.getParticipants(s.appId, '代表者');
    t.ok(ps.length > 0, '参加者が返ること');
    ps.forEach(function (p) {
      var leaked = sensitiveKeysIn(p);
      t.eq(leaked, [], '代表者の返り値に個人情報のキーが含まれないこと。漏れたキー=' + JSON.stringify(leaked));
      t.eq(Object.keys(p).sort(), ['name', 'reg_status', 'role', 'user_id'],
        'user_id / name / role / reg_status の4キーのみであること 実際=' + JSON.stringify(Object.keys(p)));
    });
  });

  test('P-02', '★代表者への返り値に個人情報の値が混じらない（文字列の検査）', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var json = JSON.stringify(API.getParticipants(s.appId, '代表者'));
    ['ハチアレルギー', '090-0000-1024', '1985-03-01', 'ミヤケ ヤマト', '東大・農', '教職員']
      .forEach(function (v) {
        t.notOk(json.indexOf(v) >= 0, '「' + v + '」が返り値に混入しないこと');
      });
  });

  test('P-03', '★参加者にも個人情報を返さない', function (t) {
    reset();
    var s = seedParticipantWithPII();
    API.getParticipants(s.appId, '参加者').forEach(function (p) {
      t.eq(sensitiveKeysIn(p), [], '参加者の返り値に個人情報が含まれないこと');
    });
  });

  test('P-04', '★代表者自身の行も例外にしない', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var ps = API.getParticipants(s.appId, '代表者');
    var self = ps.filter(function (p) { return p.role === '代表者'; });
    if (!self.length) t.skip('代表者ロールの参加者が用意されていないため未実施');
    self.forEach(function (p) {
      t.eq(sensitiveKeysIn(p), [], '代表者自身の行にも個人情報が付かないこと');
    });
  });

  test('P-05', '職員には個人情報が返る', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var p = API.getParticipants(s.appId, '施設担当者')
      .filter(function (x) { return x.user_id === s.userId; })[0];
    ['org', 'org_type', 'status_type', 'gender', 'age', 'allergy', 'nationality', 'has_emergency']
      .forEach(function (k) {
        t.ok(k in p, k + ' が返ること');
      });
  });

  test('P-06', '★職員にも生年月日そのものは返さない（年齢に変換する）', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var p = API.getParticipants(s.appId, '施設担当者')
      .filter(function (x) { return x.user_id === s.userId; })[0];
    t.notOk('birth_date' in p, 'birth_date が返らないこと');
    t.ok(typeof p.age === 'number', 'age が数値で返ること 実際=' + JSON.stringify(p.age));
  });

  test('P-07', '年齢が誕生日前かどうかで正しく計算される', function (t) {
    reset();
    var s = seedApplication();
    API.inviteParticipants(s, [{ name: '誕生日前', email: 'bd@example.ac.jp' }]);
    var pb = (API.getParticipants(s, '施設担当者') || [])[0];
    if (!pb) t.skip('参加者が取得できないため未実施');
    var uid = pb.user_id;
    var now = new Date();
    var tomorrow = new Date(now.getTime() + 86400000);
    var bd = (now.getFullYear() - 30) + '-'
      + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-'
      + String(tomorrow.getDate()).padStart(2, '0');
    API.saveMyProfile(uid, { birth_date: bd });
    var p = API.getParticipants(s, '施設担当者')
      .filter(function (x) { return x.user_id === uid; })[0];
    t.eq(p.age, 29, '誕生日前なので29歳であること（年の引き算だけになっていないこと）実際=' + p.age);
  });

  test('P-08', '★職員にも緊急連絡先の実値は返さない', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var arr = API.getParticipants(s.appId, '施設担当者');
    var p = arr.filter(function (x) { return x.user_id === s.userId; })[0];
    t.notOk('emergency' in p, 'emergency のキーが返らないこと');
    t.eq(p.has_emergency, true, 'has_emergency が true であること');
    t.notOk(JSON.stringify(arr).indexOf('090-0000-1024') >= 0, '電話番号が混入しないこと');
  });

  test('P-09', '緊急連絡先が未登録なら has_emergency は false', function (t) {
    reset();
    var id = seedApplication();
    API.inviteParticipants(id, [{ name: '未登録', email: 'nc@example.ac.jp' }]);
    var p = (API.getParticipants(id, '施設担当者') || [])[0];
    if (!p) t.skip('参加者が取得できないため未実施');
    t.eq(p.has_emergency, false, 'false であること');
  });

  test('P-10', '★未定義の viewerRole は制限側に倒れる（fail-closed）', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var ps = API.getParticipants(s.appId, 'ゲスト');
    var leaked = sensitiveKeysIn(ps[0] || {});
    if (leaked.length) {
      throw new Error(
        '未定義のロール「ゲスト」に個人情報が返りました（fail-open）。漏れたキー=' + JSON.stringify(leaked)
        + ' — 仕様の「\'施設担当者\' 他」を素直に実装すると、知らないロールが全権になります');
    }
  });

  test('P-11', '★viewerRole 省略・null・空文字も制限側に倒れる', function (t) {
    reset();
    var s = seedParticipantWithPII();
    [undefined, null, ''].forEach(function (role) {
      var ps = API.getParticipants(s.appId, role);
      var leaked = sensitiveKeysIn((ps && ps[0]) || {});
      t.eq(leaked, [], 'viewerRole=' + JSON.stringify(role) + ' で個人情報が返らないこと');
    });
  });

  test('P-12', '★前後空白つきのロール名で権限が緩まない', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var ps = API.getParticipants(s.appId, '代表者 ');
    var leaked = sensitiveKeysIn((ps && ps[0]) || {});
    t.eq(leaked, [], '「代表者 」（末尾に空白）で個人情報が返らないこと');
  });

  test('P-13', '存在しない申込で他の参加者が漏れない', function (t) {
    reset();
    try { seedParticipantWithPII(); } catch (e) { if (!e.__skip) throw e; }
    var ps = API.getParticipants('9999-XXX-9999', '施設担当者');
    t.eq((ps || []).length, 0, '空であること');
  });

  test('P-14', '★openEmergencyContact は必ず監査ログを残す', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var before = API.getAudit({}).length;
    var r = API.openEmergencyContact(s.userId, 'S001', '救急対応のため');
    t.eq(r.emergency, '090-0000-1024', '緊急連絡先が返ること');
    var log = API.getAudit({});
    t.ok(log.length === before + 1, '監査ログがちょうど1件増えること 実際=' + (log.length - before));
    var rec = log[0];
    t.eq(rec.staff_id, 'S001', 'staff_id が記録されること');
    t.eq(String(rec.target), String(s.userId), 'target が対象の利用者であること');
    t.ok(String(rec.detail || '').indexOf('救急対応') >= 0,
      'reason が detail に残ること 実際=' + rec.detail);
  });

  test('P-15', '★ログを残せないときは緊急連絡先を返さない（fail-closed）', function (t) {
    reset();
    var s = seedParticipantWithPII();
    if (!MemoryAdapter || typeof MemoryAdapter.insert !== 'function') {
      t.skip('MemoryAdapter.insert を差し替えられないため未実施');
    }
    var orig = MemoryAdapter.insert;
    MemoryAdapter.insert = function (table) {
      if (String(table).indexOf('AUDIT') >= 0 || String(table).indexOf('T8') >= 0) {
        throw new Error('監査ログの書き込みに失敗（テストによる意図的な失敗）');
      }
      return orig.apply(this, arguments);
    };
    var leaked = null, threw = false;
    try { leaked = API.openEmergencyContact(s.userId, 'S001', '救急対応'); }
    catch (e) { threw = true; }
    finally { MemoryAdapter.insert = orig; }
    if (!threw && leaked && leaked.emergency) {
      throw new Error('監査ログを残せない状態でも緊急連絡先が返りました（fail-open）');
    }
  });

  test('P-16', '同じ職員が3回開けばログも3件', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var before = API.getAudit({}).length;
    for (var i = 0; i < 3; i++) API.openEmergencyContact(s.userId, 'S001', '救急対応');
    t.eq(API.getAudit({}).length - before, 3, 'ログがまとめられないこと');
  });

  test('P-17', '★openEmergencyContact の返り値は3キーのみ', function (t) {
    reset();
    var s = seedParticipantWithPII();
    var r = API.openEmergencyContact(s.userId, 'S001', '救急対応');
    t.eq(Object.keys(r).sort(), ['emergency', 'name', 'user_id'],
      'user_id / name / emergency の3キーのみであること 実際=' + JSON.stringify(Object.keys(r)));
    var json = JSON.stringify(r);
    ['ハチアレルギー', '1985-03-01', '日本'].forEach(function (v) {
      t.notOk(json.indexOf(v) >= 0, '「' + v + '」がついでに返らないこと');
    });
  });

  test('P-18', 'getApplications に演習林スコープの制限があるか', function (t) {
    reset();
    seedApplication({ forest_id: 'HKD' });
    var r = API.getApplications({});
    t.pending('API層に呼び出し元の演習林スコープがありません（forest_id を省くと全件返ります）。'
      + '施設職員が他演習林の申込を見てよいかを決め、必要なら forest_id の強制付与を実装してください。現在の件数=' + r.length);
  });
}

// ═══════════════════════════════════════════════════════════
// 7. 施設差
// ═══════════════════════════════════════════════════════════

function testsFacility() {
  var test = suite('施設差');

  var FORESTS = ['HKD', 'CHB', 'CCB', 'TNS', 'ERI', 'FJI', 'JUG'];

  test('F-01', '全演習林で新規保存が通り、初期ステータスが入る', function (t) {
    var failed = [];
    FORESTS.forEach(function (f) {
      reset();
      try {
        var id = API.saveApplication({ forest_id: f, rep_user_id: 'U0001',
          date_from: '2026-09-01', date_to: '2026-09-02' });
        var app = API.getApplication(id);
        if (!app || !app.status) failed.push(f + '(status空)');
      } catch (e) {
        failed.push(f + '(' + e.message + ')');
      }
    });
    if (failed.length === FORESTS.length) {
      t.skip('マスタが未投入のため未実施: ' + failed.join(', '));
    }
    t.eq(failed, [], '全演習林で保存できること。失敗=' + JSON.stringify(failed));
  });

  test('F-03', '★getMissingForms は他演習林の様式を混ぜない', function (t) {
    reset();
    var byForest = {};
    FORESTS.forEach(function (f) {
      try {
        var id = API.saveApplication({ forest_id: f, rep_user_id: 'U0001',
          date_from: '2026-09-01', date_to: '2026-09-02' });
        byForest[f] = API.getMissingForms(id) || [];
      } catch (e) { byForest[f] = null; }
    });
    var checked = 0, bad = [];
    Object.keys(byForest).forEach(function (f) {
      var forms = byForest[f];
      if (!forms || !forms.length) return;
      checked++;
      forms.forEach(function (x) {
        if (x.forest_id && x.forest_id !== f) bad.push(f + ' に ' + x.forest_id + ' の様式 ' + x.form_code);
      });
    });
    if (!checked) t.skip('様式マスタ(M6)が未投入のため未実施');
    t.eq(bad, [], '様式が演習林をまたいで混ざらないこと。混入=' + JSON.stringify(bad));
  });

  test('F-06', '都度提出の様式は2回目の利用でも未提出として返る', function (t) {
    reset();
    var id = seedApplication();
    var forms = API.getMissingForms(id) || [];
    var eachTime = forms.filter(function (f) { return f.each_time === true; });
    if (!eachTime.length) t.skip('each_time=true の様式が定義されていないため未実施');
    var code = eachTime[0].form_code;
    API.attachFile(id, { phase: '利用の都度', kind: '申込書', form_code: code,
      file_name: 'b.pdf', file_id: 'drive:b', submitted_at: '2026-08-25' });
    // 期間を変えて2回目の利用にする
    API.saveApplication({ app_id: id, forest_id: 'HKD', rep_user_id: 'U0001',
      date_from: '2026-10-01', date_to: '2026-10-02' });
    var after = API.getMissingForms(id) || [];
    t.pending('都度提出様式の「回」の単位が仕様に定義されていません。'
      + '期間変更後に ' + code + ' が再び未提出になるべきかを決めてください。現在='
      + (after.some(function (f) { return f.form_code === code; }) ? '未提出に戻る' : '提出済のまま'));
  });

  test('F-11', '様式に定員が明記された施設は capacity が入る', function (t) {
    if (!API.getFacilityAvailability) return;
    reset();
    var r;
    try { r = API.getFacilityAvailability('CCB-KAWAMATA', '2026-09-01', '2026-09-01'); }
    catch (e) { t.skip('施設マスタ未投入のため未実施'); }
    if (!r || !r.length) t.skip('対象施設がないため未実施');
    t.eq(r[0].capacity, 28, '秩父・川俣（賄い）の定員28が入ること 実際=' + r[0].capacity);
  });

  test('F-14', 'exportNenpo の身分区分が4列に畳み込まれる', function (t) {
    reset();
    var id = seedApplication({ date_from: '2025-06-01', date_to: '2025-06-02' });
    var r = API.exportNenpo('HKD', 2025);
    if (!r.length) t.skip('人数データが未投入のため未実施');
    var row = r[0];
    ['staff', 'student', 'grad', 'other', 'total'].forEach(function (k) {
      t.ok(k in row, k + ' 列があること');
    });
    t.eq(row.staff + row.student + row.grad + row.other, row.total,
      '4列の合計が total と一致すること');
  });
}

// ═══════════════════════════════════════════════════════════
// 8. 重点：整合性
// ═══════════════════════════════════════════════════════════

function testsIntegrity() {
  var test = suite('重点・整合性');

  test('X-01', '★期間を変えると利用日が作り直される（合算されない）', function (t) {
    reset();
    var id = seedApplication({ date_from: '2026-09-01', date_to: '2026-09-05' });
    t.eq(API.getApplication(id).days.length, 5, '最初は5件');
    API.saveApplication({ app_id: id, forest_id: 'HKD', rep_user_id: 'U0001',
      date_from: '2026-09-10', date_to: '2026-09-12' });
    var days = API.getApplication(id).days;
    t.eq(days.length, 3, '変更後は3件であること（8件に増えていないこと）実際=' + days.length);
  });

  test('X-02', '★変更前の利用日が1件も残らない', function (t) {
    reset();
    var id = seedApplication({ date_from: '2026-09-01', date_to: '2026-09-05' });
    API.saveApplication({ app_id: id, forest_id: 'HKD', rep_user_id: 'U0001',
      date_from: '2026-09-10', date_to: '2026-09-12' });
    var days = API.getApplication(id).days;
    t.eq(days, ['2026-09-10', '2026-09-11', '2026-09-12'], '新しい期間の3件だけであること');
    dateRange('2026-09-01', '2026-09-05').forEach(function (d) {
      t.notOk(days.indexOf(d) >= 0, d + ' が残っていないこと');
    });
  });

  test('X-04', '期間を変えなければ利用日は作り直されない', function (t) {
    reset();
    var id = seedApplication({ date_from: '2026-09-01', date_to: '2026-09-05' });
    var before = API.getApplication(id).days.slice();
    API.saveApplication({ app_id: id, forest_id: 'HKD', rep_user_id: 'U0001',
      date_from: '2026-09-01', date_to: '2026-09-05', purpose: '目的だけ変更' });
    t.eq(API.getApplication(id).days, before, '利用日が変わらないこと');
  });

  test('X-05', '期間の短縮で末尾の利用日が消える', function (t) {
    reset();
    var id = seedApplication({ date_from: '2026-09-01', date_to: '2026-09-05' });
    API.saveApplication({ app_id: id, forest_id: 'HKD', rep_user_id: 'U0001',
      date_from: '2026-09-01', date_to: '2026-09-03' });
    t.eq(API.getApplication(id).days, ['2026-09-01', '2026-09-02', '2026-09-03'], '3件になること');
  });

  test('X-06', '期間の延長で利用日が増える', function (t) {
    reset();
    var id = seedApplication({ date_from: '2026-09-01', date_to: '2026-09-05' });
    API.saveApplication({ app_id: id, forest_id: 'HKD', rep_user_id: 'U0001',
      date_from: '2026-09-01', date_to: '2026-09-10' });
    t.eq(API.getApplication(id).days.length, 10, '10件になること');
  });

  test('X-03', '★期間変更で孤児になる人数・宿泊レコードの扱い', function (t) {
    reset();
    var id = seedApplication({ date_from: '2026-09-01', date_to: '2026-09-05' });
    var app0 = API.getApplication(id);
    if (!app0.headcounts || !app0.headcounts.length) {
      t.pending('人数データを投入する経路がAPIにないため自動検証できません。'
        + '期間変更時に、旧利用日にぶら下がる人数(T4)・宿泊(T5)をどう扱うか'
        + '（削除／警告／移動）を仕様に明記してください');
    }
    API.saveApplication({ app_id: id, forest_id: 'HKD', rep_user_id: 'U0001',
      date_from: '2026-10-01', date_to: '2026-10-03' });
    var app1 = API.getApplication(id);
    var orphan = (app1.headcounts || []).filter(function (h) {
      return app1.days.indexOf(h.date) < 0;
    });
    t.eq(orphan, [], '利用日に存在しない日付の人数が残らないこと 実際=' + JSON.stringify(orphan.slice(0, 3)));
  });

  test('X-07', '★exportNenpo: 各行の4列の合計が total と一致', function (t) {
    reset();
    seedApplication({ date_from: '2025-06-01', date_to: '2025-06-02' });
    var r = API.exportNenpo('HKD', 2025);
    if (!r.length) t.skip('該当データがないため未実施');
    r.forEach(function (row, i) {
      t.eq(row.staff + row.student + row.grad + row.other, row.total,
        (i + 1) + '行目: staff+student+grad+other = total');
    });
  });

  test('X-08', '★exportNenpo の総計が元データの合計と一致', function (t) {
    reset();
    var ids = [
      seedApplication({ date_from: '2025-04-01', date_to: '2025-04-02' }),
      seedApplication({ date_from: '2025-06-01', date_to: '2025-06-02' }),
      seedApplication({ date_from: '2025-08-01', date_to: '2025-08-02' })
    ];
    var src = 0;
    ids.forEach(function (id) {
      var app = API.getApplication(id);
      src += (app.headcounts || []).reduce(function (s, h) { return s + (h.count || 0); }, 0);
    });
    var r = API.exportNenpo('HKD', 2025);
    var out = r.reduce(function (s, row) { return s + (row.total || 0); }, 0);
    if (src === 0 && out === 0) {
      t.pending('人数データを投入する経路がAPIにないため、実データでの突合が必要です。'
        + '本番相当のシートを読み込んだ状態でこのテストを再実行してください');
    }
    t.eq(out, src, '年報の総計が元データ(T4)の合計と一致すること');
  });

  test('X-10', 'exportNenpo の days が n_days と一致', function (t) {
    reset();
    var id = seedApplication({ date_from: '2025-06-01', date_to: '2025-06-08' });
    var app = API.getApplication(id);
    var r = API.exportNenpo('HKD', 2025);
    if (!r.length) t.skip('該当データがないため未実施');
    t.eq(r[0].days, app.n_days, '年報の日数と n_days が一致すること');
  });

  test('X-12', '★exportNenpo と exportMonthly の延べ人数が一致', function (t) {
    reset();
    seedApplication({ date_from: '2025-06-01', date_to: '2025-06-03' });
    var nenpo = API.exportNenpo('HKD', 2025)
      .reduce(function (s, row) { return s + (row.total || 0); }, 0);
    var monthly = 0;
    ['202504','202505','202506','202507','202508','202509',
     '202510','202511','202512','202601','202602','202603'].forEach(function (ym) {
      (API.exportMonthly('HKD', ym) || []).forEach(function (row) {
        monthly += (row.headcounts || []).reduce(function (s, h) { return s + (h.count || 0); }, 0);
      });
    });
    if (nenpo === 0 && monthly === 0) {
      t.pending('人数データ未投入のため未検証。本番相当データで再実行してください');
    }
    t.eq(monthly, nenpo, '2つの出力で延べ人数の定義がずれていないこと（月次=' + monthly + ' 年報=' + nenpo + '）');
  });

  test('X-13', 'getApplication.total_people と exportNenpo.total が一致', function (t) {
    reset();
    var id = seedApplication({ date_from: '2025-06-01', date_to: '2025-06-03' });
    var app = API.getApplication(id);
    var r = API.exportNenpo('HKD', 2025);
    if (!r.length) t.skip('該当データがないため未実施');
    t.eq(r[0].total, app.total_people, '同じ申込で延べ人数が一致すること');
  });
}

// ═══════════════════════════════════════════════════════════
// 9. 実行
// ═══════════════════════════════════════════════════════════

function main() {
  API = loadApi();
  MemoryAdapter = loadMemoryAdapter();
  if (MemoryAdapter && API.useAdapter) API.useAdapter(MemoryAdapter);

  testsNormal();
  testsBoundary();
  testsError();
  testsPermission();
  testsFacility();
  testsIntegrity();

  report();
}

function report() {
  var pad = function (s, n) { s = String(s); while (s.length < n) s += ' '; return s; };
  var counts = { PASS: 0, FAIL: 0, PENDING: 0, SKIP: 0 };
  console.log('');
  console.log('番号     区分            結果     内容');
  console.log('──────────────────────────────────────────────────────────────────────');
  results.forEach(function (r) {
    counts[r.state]++;
    var mark = { PASS: ' 合格 ', FAIL: '★不合格', PENDING: ' 要確認', SKIP: ' 未実施' }[r.state];
    console.log(pad(r.id, 8) + pad(r.kbn, 15) + pad(mark, 9) + r.title);
    if (r.message) console.log('         └ ' + r.message);
  });
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log('合格 ' + counts.PASS + ' / 不合格 ' + counts.FAIL
    + ' / 要確認 ' + counts.PENDING + ' / 未実施 ' + counts.SKIP
    + '　（全 ' + results.length + ' 件）');
  console.log('');
  if (counts.FAIL > 0) {
    console.log('不合格の一覧:');
    results.filter(function (r) { return r.state === 'FAIL'; }).forEach(function (r) {
      console.log('  ' + r.id + '  ' + r.title);
      console.log('        ' + r.message);
    });
  }
  if (typeof process !== 'undefined' && process.exit) {
    process.exitCode = counts.FAIL > 0 ? 1 : 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { main: main, results: results };
}
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main();
}
