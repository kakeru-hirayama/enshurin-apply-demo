/**
 * auth.js  誰が使っているかを扱う
 *
 * ■ 打ち合わせで確認したこと
 *   ・利用者には学外の方が1割いる → 大学アカウントだけでは足りない
 *   ・年に1回しか使わない人にパスワードは覚えられない
 *   ・職員は東大の教職員だが、演習林の独自ドメインを使っている方もいる
 *
 * ■ 決めたこと
 *   利用者側　メールアドレス ＋ ワンタイムコード（パスワードを持たせない）
 *   職員側　　大学アカウントとの連携を第一候補とする
 *   　　　　　ただし全職員が使えるかは未確認のため、
 *   　　　　　ワンタイムコードでも入れる道を残す
 *
 * ■ 新しい職員の登録
 *   ★自分では登録できない。管理者が招待する形にする。
 *     誰でも職員として入れてしまうと、権限の意味がなくなるため。
 *
 * ■ 見える範囲
 *   施設担当者・施設管理者　自分の所属する演習林のみ
 *   本部担当者　　　　　　　全演習林（ただし集計のみ）
 *   システム管理者　　　　　全演習林
 */

var Auth = (function () {

  var me = null;          // いま入っている人
  var CODE_MINUTES = 15;  // ワンタイムコードの有効時間

  /** 6桁のコードを作る */
  function makeCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function now() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  /**
   * ワンタイムコードを送る
   * ★実際の送信は GAS の Mailer が行う。
   *   ここでは発行と記録だけを担当する。
   */
  function requestCode(email, kind) {
    var db = API.adapter ? API.adapter() : MemoryAdapter;

    var target = null;
    if (kind === 'staff') {
      db.readAll('M_STAFF').forEach(function (s) {
        if (s.active !== false && (s.login_id === email || s.email === email)) target = s;
      });
      if (!target) {
        // ★職員は自分では登録できない。管理者からの招待が必要。
        return { ok: false,
                 error: '職員として登録されていません。'
                      + 'システム管理者に招待を依頼してください。' };
      }
    } else {
      db.readAll('M_USER').forEach(function (u) {
        if (u.email === email) target = u;
      });
      if (!target) {
        // 利用者は、はじめての方でも入れる
        var id = db.nextId('M_USER', 'U');
        target = { user_id: id, email: email, name: '', updated_at: now() };
        db.insert('M_USER', target);
      }
    }

    var code = makeCode();
    var until = new Date(Date.now() + CODE_MINUTES * 60000)
                  .toISOString().slice(0, 19).replace('T', ' ');

    // 発行した記録を残す。★コードそのものは記録に残さない
    if (typeof API !== 'undefined' && API.getAudit) {
      try {
        db.insert('T_AUDIT', {
          at: now(), staff_id: kind === 'staff' ? target.staff_id : '',
          action: 'ログイン用コードを発行', target: email,
          detail: kind, ip: ''
        });
      } catch (e) {}
    }

    return { ok: true, code: code, until: until, kind: kind,
             id: kind === 'staff' ? target.staff_id : target.user_id };
  }

  /** コードを照合して入る */
  function verify(email, code, issued) {
    if (!issued || issued.code !== String(code)) {
      return { ok: false, error: 'コードが違います' };
    }
    if (now() > issued.until) {
      return { ok: false, error: 'コードの有効期限が切れています。もう一度お求めください' };
    }
    return signIn(issued.kind, issued.id);
  }

  /** 入った状態にする */
  function signIn(kind, id) {
    var db = API.adapter ? API.adapter() : MemoryAdapter;

    if (kind === 'staff') {
      var s = db.findByKey('M_STAFF', id);
      if (!s) return { ok: false, error: '職員が見つかりません' };
      me = {
        kind: 'staff', id: s.staff_id, name: s.name, role: s.role,
        forest_id: s.forest_id, email: s.email || s.login_id
      };
    } else {
      var u = db.findByKey('M_USER', id);
      if (!u) return { ok: false, error: '利用者が見つかりません' };
      me = {
        kind: 'user', id: u.user_id, name: u.name || '（未登録）',
        role: '利用者', forest_id: '', email: u.email
      };
    }
    return { ok: true, me: me };
  }

  function signOut() { me = null; }
  function current() { return me; }

  /**
   * その人が見てよい演習林を返す
   * ★空の配列なら「どれも見られない」。全部という意味ではない。
   */
  function visibleForests() {
    var db = API.adapter ? API.adapter() : MemoryAdapter;
    var all = db.readAll('M_FOREST').filter(function (f) { return f.active !== false; });
    if (!me) return [];

    if (me.role === 'システム管理者' || me.role === '本部担当者') return all;

    if (me.role === '施設担当者' || me.role === '施設管理者') {
      return all.filter(function (f) { return f.forest_id === me.forest_id; });
    }
    return [];   // 利用者は職員画面を見られない
  }

  /** その操作をしてよいか */
  var CAN = {
    'システム管理者': ['見る', '変える', '設定', '個人情報', '出力'],
    '施設管理者':     ['見る', '変える', '設定', '個人情報', '出力'],
    '施設担当者':     ['見る', '変える', '個人情報', '出力'],
    '本部担当者':     ['見る', '出力'],
    '利用者':         []
  };

  function can(action) {
    if (!me) return false;
    var list = CAN[me.role] || [];
    return list.indexOf(action) >= 0;
  }

  /** 職員を招待する。★管理者しか呼べない */
  function inviteStaff(email, name, forestId, role) {
    if (!can('設定')) {
      return { ok: false, error: '職員を招待する権限がありません' };
    }
    var db = API.adapter ? API.adapter() : MemoryAdapter;

    var dup = db.readAll('M_STAFF').some(function (s) {
      return s.login_id === email || s.email === email;
    });
    if (dup) return { ok: false, error: 'すでに登録されています' };

    var id = db.nextId('M_STAFF', 'S');
    db.insert('M_STAFF', {
      staff_id: id, login_id: email, email: email, name: name,
      forest_id: forestId, role: role, active: true
    });
    db.insert('T_AUDIT', {
      at: now(), staff_id: me.id, action: '職員を招待',
      target: id, detail: name + ' / ' + role + ' / ' + forestId, ip: ''
    });
    return { ok: true, staff_id: id };
  }

  /** 職員を無効にする。消さずに残すのは、記録との対応を保つため */
  function deactivateStaff(staffId) {
    if (!can('設定')) return { ok: false, error: '権限がありません' };
    var db = API.adapter ? API.adapter() : MemoryAdapter;
    db.update('M_STAFF', staffId, { active: false });
    db.insert('T_AUDIT', {
      at: now(), staff_id: me.id, action: '職員を無効化',
      target: staffId, detail: '', ip: ''
    });
    return { ok: true };
  }

  return {
    requestCode: requestCode,
    verify: verify,
    signIn: signIn,
    signOut: signOut,
    current: current,
    visibleForests: visibleForests,
    can: can,
    inviteStaff: inviteStaff,
    deactivateStaff: deactivateStaff,
    CODE_MINUTES: CODE_MINUTES
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Auth;
}
