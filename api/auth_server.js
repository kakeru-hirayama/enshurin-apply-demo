/**
 * auth_server.js  ログインの実体（Google Apps Script 上でだけ動く）
 *
 * ■ なぜ auth.js と分けるか
 *   auth.js は画面側でも動く。だから「合言葉を作って照合する」処理を
 *   auth.js に置くと、合言葉が画面に渡ってしまう。
 *   開発者ツールで読めるので、鍵をドアに挿したまま出かけるのと同じになる。
 *
 *   ★2026-08-20 まで、実際にその作りだった。
 *     requestCode が code を戻り値に含め、画面側の verify が照合していた。
 *     手元で動かす間は問題にならなかったが、サーバーにつないだ時点で
 *     誰でも職員として入れる状態になるため、ここに移した。
 *
 * ■ 流れ
 *   1  画面　　　メールアドレスを送る
 *   2  サーバー　合言葉を作る → T9 に控える → メールで送る
 *   　　　　　　 ★画面に返すのは「送りました」だけ
 *   3  画面　　　届いた合言葉を送る
 *   4  サーバー　T9 と照合 → 通れば TA に印を作り、その印を画面に返す
 *   5  画面　　　以後の呼び出しに、その印を添える
 *
 * ■ 合言葉の扱い
 *   有効時間　15分
 *   試行回数　5回まで（それを超えたら、その合言葉は無効）
 *   使い回し　一度通った合言葉は、期限内でも二度は通さない
 */

var AuthServer = (function () {

  var CODE_MINUTES = 15;    // 合言葉の有効時間
  var MAX_TRIES = 5;        // 間違えてよい回数
  var SESSION_HOURS = 12;   // ログインし続けられる時間

  function now() {
    return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  }

  function after(ms) {
    return Utilities.formatDate(new Date(Date.now() + ms), 'Asia/Tokyo',
                                'yyyy-MM-dd HH:mm:ss');
  }

  /**
   * 6桁の合言葉
   * ★Utilities.getUuid から数字を取り出す。
   *   Math.random より読みにくく、15分・5回の制限と合わせれば
   *   当てられる見込みは十分に低い。
   */
  function makeCode() {
    var u = Utilities.getUuid().replace(/[^0-9]/g, '');
    while (u.length < 6) u += String(Math.floor(Math.random() * 10));
    return u.slice(0, 6);
  }

  function lower(v) {
    return String(v || '').trim().toLowerCase();
  }

  /** メールアドレスから職員を探す */
  function findStaff(email) {
    var found = null;
    SheetsAdapter.readAll('M_STAFF').forEach(function (s) {
      if (s.active === false) return;
      if (lower(s.login_id) === email || lower(s.email) === email) found = s;
    });
    return found;
  }

  /** メールアドレスから利用者を探す */
  function findUser(email) {
    var found = null;
    SheetsAdapter.readAll('M_USER').forEach(function (u) {
      if (lower(u.email) === email) found = u;
    });
    return found;
  }

  // ---------------------------------------------- 合言葉を送る

  function requestLoginCode(email, kind) {
    email = lower(email);
    kind = (kind === 'staff') ? 'staff' : 'user';

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, error: 'メールアドレスの形が正しくないようです' };
    }

    var who = null;

    if (kind === 'staff') {
      who = findStaff(email);
      if (!who) {
        // ★職員は自分では登録できない。
        //   「登録がありません」と正直に返す。
        //   ここを曖昧にすると、招待を待っている方が
        //   自分の状況を確かめられなくなる。
        return { ok: false,
                 error: 'このメールアドレスは職員として登録されていません。'
                      + 'システム管理者に招待をご依頼ください。' };
      }
    } else {
      who = findUser(email);
      if (!who) {
        // 利用者は、はじめての方でも入れる。
        // ここで作っておくと、次回から同じ方だと分かる。
        var id = SheetsAdapter.nextId('M_USER', 'U');
        who = { user_id: id, email: email, name: '', updated_at: now() };
        SheetsAdapter.insert('M_USER', who);
      }
    }

    var code = makeCode();
    var until = after(CODE_MINUTES * 60000);

    SheetsAdapter.insert('T_LOGIN_CODE', {
      email: email, kind: kind, code: code,
      until: until, used: '', tries: 0, issued: now()
    });

    // ★ログインの合言葉だけは、下書きの状態でも実際に送る。
    //   届かないと誰も入れないため。
    //   宛先は本人が入力したアドレスなので、
    //   架空のアドレスに飛ぶことはない。
    var subject = '［東京大学演習林］ログイン用の番号';
    var body =
      'ログイン用の番号をお送りします。' + NL + NL +
      '　　' + code + NL + NL +
      'この番号は ' + CODE_MINUTES + ' 分間ご利用いただけます。' + NL +
      '画面に入力してお進みください。' + NL + NL +
      'お心当たりのない場合は、このメールは破棄してください。' + NL +
      'この番号だけでは、どなたもログインできません。' + NL + NL +
      '――――――――――――――――――' + NL +
      '東京大学大学院農学生命科学研究科附属演習林' + NL;

    try {
      Mailer.setDryRun(false);
      Mailer.send(email, subject, body);
    } catch (e) {
      Mailer.setDryRun(true);
      return { ok: false, error: 'メールを送れませんでした。' + e.message };
    }
    Mailer.setDryRun(true);

    return { ok: true, until: until, minutes: CODE_MINUTES, email: email };
  }

  // ---------------------------------------------- 照合して入る

  function verifyLoginCode(email, code) {
    email = lower(email);
    code = String(code || '').trim();

    var rows = SheetsAdapter.readAll('T_LOGIN_CODE');
    var t = now();

    // 同じアドレスに出した中で、いちばん新しいものだけを見る。
    // ★古いものも通してしまうと、何度も出させて当てる余地ができる。
    var latest = null;
    var latestAt = -1;
    rows.forEach(function (r, i) {
      if (lower(r.email) !== email) return;
      if (!latest || String(r.issued) >= String(latest.issued)) {
        latest = r;
        latestAt = i;
      }
    });

    if (!latest) {
      return { ok: false, error: '番号をお求めになってから入力してください' };
    }
    if (latest.used) {
      return { ok: false, error: 'この番号はすでに使われています。もう一度お求めください' };
    }
    if (t > String(latest.until)) {
      return { ok: false, error: '番号の有効期限が切れています。もう一度お求めください' };
    }
    if (Number(latest.tries || 0) >= MAX_TRIES) {
      return { ok: false, error: '入力の回数が上限に達しました。もう一度お求めください' };
    }

    if (String(latest.code) !== code) {
      updateRowAt('T_LOGIN_CODE', latestAt, { tries: Number(latest.tries || 0) + 1 });
      var left = MAX_TRIES - Number(latest.tries || 0) - 1;
      return { ok: false,
               error: '番号が違います。'
                    + (left > 0 ? 'あと ' + left + ' 回お試しいただけます' : '') };
    }

    updateRowAt('T_LOGIN_CODE', latestAt, { used: now() });

    // 誰なのかを引き直す
    var who = (latest.kind === 'staff') ? findStaff(email) : findUser(email);
    if (!who) {
      return { ok: false, error: '登録が見つかりませんでした' };
    }

    var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
    SheetsAdapter.insert('T_SESSION', {
      token: token, kind: latest.kind,
      who_id: latest.kind === 'staff' ? who.staff_id : who.user_id,
      email: email,
      until: after(SESSION_HOURS * 3600000),
      last_at: now()
    });

    if (latest.kind === 'staff') {
      writeAuditRow(who.staff_id, 'ログイン', email, '');
    }

    return { ok: true, token: token, me: describe(latest.kind, who) };
  }

  function describe(kind, who) {
    if (kind === 'staff') {
      return { kind: 'staff', id: who.staff_id, name: who.name,
               role: who.role, forest_id: who.forest_id,
               email: who.email || who.login_id };
    }
    return { kind: 'user', id: who.user_id,
             name: who.name || '', role: '利用者',
             forest_id: '', email: who.email };
  }

  // ---------------------------------------------- 印を確かめる

  /**
   * 印から「誰か」を返す。通らなければ null
   * ★呼び出しのたびにここを通る。重くしないこと。
   */
  function sessionOf(token) {
    if (!token) return null;
    var s = SheetsAdapter.findByKey('T_SESSION', token);
    if (!s) return null;
    if (now() > String(s.until)) return null;

    var who = null;
    if (s.kind === 'staff') {
      who = SheetsAdapter.findByKey('M_STAFF', s.who_id);
      if (!who || who.active === false) return null;
    } else {
      who = SheetsAdapter.findByKey('M_USER', s.who_id);
      if (!who) return null;
    }
    return describe(s.kind, who);
  }

  function signOutServer(token) {
    if (!token) return { ok: true };
    try { SheetsAdapter.remove('T_SESSION', token); } catch (e) {}
    return { ok: true };
  }

  // ---------------------------------------------- 内部

  /**
   * 鍵のない表の、n 行目だけを書き換える
   * ★シートを直接触らず、データ層に任せる。
   *   ここでシートを触ると、保存先を差し替えられなくなる。
   */
  function updateRowAt(table, index, patch) {
    SheetsAdapter.updateAt(table, index, patch);
  }

  function writeAuditRow(staffId, action, target, detail) {
    try {
      SheetsAdapter.insert('T_AUDIT', {
        at: now(), staff_id: staffId || '', action: action,
        target: target || '', detail: detail || '', ip: ''
      });
    } catch (e) {}
  }

  return {
    requestLoginCode: requestLoginCode,
    verifyLoginCode: verifyLoginCode,
    sessionOf: sessionOf,
    signOutServer: signOutServer,
    CODE_MINUTES: CODE_MINUTES
  };
})();


/**
 * 古い合言葉とログイン状態を片づける
 * ★1日1回の実行トリガーに設定しておく。
 *   放っておくと、使い終わった行だけが増え続ける。
 */
function cleanupLogins() {
  var t = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  var n = { code: 0, session: 0 };

  // ★後ろから消す。前から消すと、残りの位置がずれる
  var codes = SheetsAdapter.readAll('T_LOGIN_CODE');
  for (var i = codes.length - 1; i >= 0; i--) {
    if (t > String(codes[i].until)) {
      SheetsAdapter.removeAt('T_LOGIN_CODE', i);
      n.code++;
    }
  }

  var ses = SheetsAdapter.readAll('T_SESSION');
  for (var k = ses.length - 1; k >= 0; k--) {
    if (t > String(ses[k].until)) {
      SheetsAdapter.removeAt('T_SESSION', k);
      n.session++;
    }
  }

  Logger.log('期限切れを片づけました　合言葉 ' + n.code + '／ログイン状態 ' + n.session);
  return n;
}
