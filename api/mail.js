/**
 * mail.js  メールの送信（Google Apps Script 用）
 *
 * このファイルは GAS の上でだけ動く。ブラウザでは動かない。
 *
 * ------------------------------------------------------------------
 * なぜ MailApp を使うか
 *   ・追加の費用がかからない
 *   ・外部のサービスに利用者のメールアドレスを渡さずに済む
 *   ・送信元が大学のアカウントになる
 *
 * 1日あたりの上限
 *   無料のGoogleアカウント　　　　100通
 *   Google Workspace（大学）　　　1500通
 *
 *   年間の利用が約1000件、1件あたり参加者への案内が数通として、
 *   多い日でも数十通に収まる見込み。上限には届かない。
 *   ただし送信数は記録し、上限に近づいたら気づけるようにしておく。
 * ------------------------------------------------------------------
 */

/** 改行。文字列の中に直接書くと、生成の過程で壊れることがある */
var NL = String.fromCharCode(10);

var Mailer = (function () {

  /** 送信元の表示名 */
  var SENDER_NAME = '東京大学演習林 利用申込';

  /** 本番に切り替えるまでは、実際に送らずログに残すだけにする */
  var DRY_RUN = true;

  function baseUrl() {
    var u = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL');
    return u || '（未設定）';
  }

  /**
   * 送る
   *
   * ★上限に達したときに「送れませんでした」で終わらせない。
   *   終わらせると、その案内は永久に届かず、誰も気づけない。
   *   控えておいて、翌日に送り直す。
   *
   * @param {string} to      宛先
   * @param {string} subject 件名
   * @param {string} body    本文
   * @param {Object} meta    { kind, app_id }　控えるときに使う
   */
  function send(to, subject, body, meta) {
    if (DRY_RUN) {
      Logger.log('［送信せず］宛先 ' + to + NL + '件名 ' + subject + NL + body);
      return { ok: true, dry: true };
    }

    // ---- 残りがなければ、送らずに控える
    var left = MailApp.getRemainingDailyQuota();
    if (left <= 0) {
      queue(to, subject, body, meta, '本日の送信可能数がありません');
      return { ok: true, queued: true, reason: '上限' };
    }

    try {
      MailApp.sendEmail({
        to: to, subject: subject, body: body,
        name: SENDER_NAME, noReply: false
      });
    } catch (e) {
      // ★失敗しても捨てない。控えて翌日に回す
      queue(to, subject, body, meta, e.message);
      return { ok: true, queued: true, reason: e.message };
    }

    if (left - 1 < 50) {
      Logger.log('★本日の送信可能数が残り ' + (left - 1) + ' 通です');
    }
    return { ok: true, dry: false, queued: false };
  }

  /** 送れなかったものを控える */
  function queue(to, subject, body, meta, why) {
    meta = meta || {};
    try {
      SheetsAdapter.insert('T_MAIL_QUEUE', {
        queued_at: nowStr(),
        to: to, subject: subject, body: body,
        kind: meta.kind || '',
        app_id: meta.app_id || '',
        tries: 1,
        sent_at: '',
        error: why || ''
      });
      Logger.log('送信を控えました　' + to + '　' + (why || ''));
    } catch (e) {
      // ★控えることすらできないときは、記録だけは残す
      Logger.log('★送信も記録もできませんでした　' + to + '　' + e.message);
    }
  }

  function nowStr() {
    return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  }

  function remaining() {
    var n = MailApp.getRemainingDailyQuota();
    if (n < 50) {
      Logger.log('★本日の送信可能数が残り ' + n + ' 通です');
    }
    return n;
  }

  // ------------------------------------------------ 文面

  /**
   * 参加者への案内
   * ★代表者ではなく、本人に直接届く。
   *   これにより、代表者が年齢やアレルギーを尋ねる必要がなくなる。
   */
  function inviteParticipant(p, app, forest) {
    var url = baseUrl() + '?p=profile&t=' + p.token;
    var subject = '［東京大学' + forest.name + '］利用にあたるご登録のお願い';
    var body =
      p.invite_name + ' 様\n\n' +
      'このたび、' + app.rep_name + ' 様より、\n' +
      '東京大学' + forest.name + 'のご利用にご一緒される方として\n' +
      'お名前をご登録いただきました。\n\n' +
      '　利用の目的　' + app.purpose + '\n' +
      '　利用の期間　' + app.date_from + ' 〜 ' + app.date_to + '\n\n' +
      'ご利用にあたり、下記より必要な事項のご登録をお願いいたします。\n\n' +
      url + '\n\n' +
      'ご登録いただく内容は、演習林の担当者のみが確認いたします。\n' +
      '利用代表者の方には表示されません。\n\n' +
      '緊急連絡先は、事故などの緊急時にのみ担当者が確認いたします。\n' +
      'その際は、いつ誰が確認したかの記録が残ります。\n\n' +
      '一度ご登録いただきますと、7つの演習林すべてで共通してお使いいただけます。\n' +
      '次回以降は、内容のご確認だけで済みます。\n\n' +
      '――――――――――――――――――\n' +
      '東京大学大学院農学生命科学研究科附属演習林\n' +
      forest.name + '\n';
    return { to: p.invite_email, subject: subject, body: body };
  }

  /** 申込を受け付けたときの連絡（代表者あて） */
  function received(app, forest) {
    var subject = '［東京大学' + forest.name + '］お申し込みを受け付けました';
    var body =
      app.rep_name + ' 様\n\n' +
      'お申し込みを受け付けました。\n\n' +
      '　受付番号　　' + app.app_id + '\n' +
      '　利用の目的　' + app.purpose + '\n' +
      '　利用の期間　' + app.date_from + ' 〜 ' + app.date_to + '\n\n' +
      (app.n_unregistered ?
        'ご一緒に来られる方のうち ' + app.n_unregistered + ' 名は、\n' +
        'まだご登録が済んでおりません。\n' +
        'ご本人あてに、ご登録のご案内をお送りしております。\n' +
        '全員のご登録が済みますと、お申し込みが確定いたします。\n\n' : '') +
      '内容を確認のうえ、あらためてご連絡いたします。\n\n' +
      '――――――――――――――――――\n' +
      '東京大学大学院農学生命科学研究科附属演習林\n' +
      forest.name + '\n';
    return { to: app.rep_email, subject: subject, body: body };
  }

  /** 許可が出たときの連絡 */
  function approved(app, forest) {
    var subject = '［東京大学' + forest.name + '］ご利用を許可いたしました';
    var body =
      app.rep_name + ' 様\n\n' +
      '下記のご利用を許可いたしました。\n\n' +
      '　受付番号　　' + app.app_id + '\n' +
      '　利用の期間　' + app.date_from + ' 〜 ' + app.date_to + '\n\n' +
      (forest.issues_permit ?
        '利用許可証を添付いたします。当日はご携帯ください。\n\n' :
        '') +
      'ご不明な点がございましたら、ご連絡ください。\n\n' +
      '――――――――――――――――――\n' +
      '東京大学大学院農学生命科学研究科附属演習林\n' +
      forest.name + '\n';
    return { to: app.rep_email, subject: subject, body: body };
  }

  /** 未提出の書類のお知らせ */
  function reminder(app, forest, missing) {
    var subject = '［東京大学' + forest.name + '］ご提出をお願いする書類のご連絡';
    var body =
      app.rep_name + ' 様\n\n' +
      'ご利用の日が近づいてまいりました。\n' +
      '下記の書類が、まだご提出いただけていないようです。\n\n' +
      '　受付番号　　' + app.app_id + '\n' +
      '　利用の期間　' + app.date_from + ' 〜 ' + app.date_to + '\n\n' +
      missing.map(function (m) {
        return '　・' + m.name + '　' +
               (m.deadline ? '（' + m.deadline + ' まで）' : '');
      }).join('\n') + '\n\n' +
      'すでにご提出済みの場合は、行き違いですのでご容赦ください。\n\n' +
      '――――――――――――――――――\n' +
      '東京大学大学院農学生命科学研究科附属演習林\n' +
      forest.name + '\n';
    return { to: app.rep_email, subject: subject, body: body };
  }

  // ------------------------------------------------ 送信の入口

  function sendInvites(appId) {
    var app = API.getApplication(appId);
    var forest = SheetsAdapter.findByKey('M_FOREST', app.forest_id);
    var sent = 0;

    app.participants.forEach(function (p) {
      if (p.reg_status !== '招待済') return;
      p.token = Utilities.getUuid();
      SheetsAdapter.update('T_PARTICIPANT', [appId, p.user_id], { token: p.token });
      var m = inviteParticipant(p, app, forest);
      send(m.to, m.subject, m.body);
      sent++;
    });
    return sent;
  }

  function sendReceived(appId) {
    var app = API.getApplication(appId);
    var forest = SheetsAdapter.findByKey('M_FOREST', app.forest_id);
    var rep = SheetsAdapter.findByKey('M_USER', app.rep_user_id);
    app.rep_email = rep ? rep.email : '';
    if (!app.rep_email) return 0;
    var m = received(app, forest);
    send(m.to, m.subject, m.body);
    return 1;
  }

  /**
   * 締切が近い申込に、未提出の書類をお知らせする
   * ★時間で自動実行するトリガーに設定して、毎朝動かす
   */
  function sendReminders() {
    var today = new Date();
    var limit = new Date();
    limit.setDate(limit.getDate() + 7);
    var iso = function (d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); };

    var apps = API.getApplications({ from: iso(today), to: iso(limit) });
    var n = 0;

    apps.forEach(function (a) {
      var missing = API.getMissingForms(a.app_id);
      if (!missing.length) return;
      var forest = SheetsAdapter.findByKey('M_FOREST', a.forest_id);
      var rep = SheetsAdapter.findByKey('M_USER', a.rep_user_id);
      if (!rep || !rep.email) return;
      a.rep_email = rep.email;
      a.rep_name = rep.name;

      var sched = missing.map(function (f) {
        var r = Deadline.calc(f, { use_date: a.date_from, end_date: a.date_to });
        return { name: f.name, deadline: r.date };
      });
      var m = reminder(a, forest, sched);
      send(m.to, m.subject, m.body);
      n++;
    });
    Logger.log('お知らせを ' + n + ' 件送りました');
    return n;
  }

  return {
    send: send,
    remaining: remaining,
    sendInvites: sendInvites,
    sendReceived: sendReceived,
    sendReminders: sendReminders,
    // 文面だけを取り出す。画面での確認や、テストに使う
    draft: {
      inviteParticipant: inviteParticipant,
      received: received,
      approved: approved,
      reminder: reminder
    },
    setDryRun: function (v) { DRY_RUN = v; },
    isDryRun: function () { return DRY_RUN; },
    queue: queue
  };
})();


/**
 * 控えてあるメールを送り直す
 *
 * ★時間で自動実行するトリガーに設定して、毎朝動かす。
 *   前の日に送れなかったものが、翌朝に届く。
 */
function retryMailQueue() {
  var NLC = String.fromCharCode(10);
  var rows = SheetsAdapter.readAll('T_MAIL_QUEUE');
  var waiting = [];
  rows.forEach(function (r, i) {
    if (!r.sent_at) waiting.push({ row: r, at: i });
  });

  if (!waiting.length) {
    Logger.log('送信を待っているものはありません');
    return { sent: 0, left: 0 };
  }

  var quota = MailApp.getRemainingDailyQuota();
  var sent = 0, failed = 0;

  for (var i = 0; i < waiting.length; i++) {
    if (quota <= 5) break;              // 少し残しておく
    var w = waiting[i];
    try {
      MailApp.sendEmail({
        to: w.row.to, subject: w.row.subject, body: w.row.body,
        name: '東京大学演習林 利用申込', noReply: false
      });
      SheetsAdapter.updateAt('T_MAIL_QUEUE', w.at, {
        sent_at: Utilities.formatDate(new Date(), 'Asia/Tokyo',
                                      'yyyy-MM-dd HH:mm:ss'),
        error: ''
      });
      sent++;
      quota--;
    } catch (e) {
      SheetsAdapter.updateAt('T_MAIL_QUEUE', w.at, {
        tries: Number(w.row.tries || 0) + 1,
        error: e.message
      });
      failed++;
    }
  }

  var left = waiting.length - sent;
  var log = ['控えてあったメールを送りました', '',
             '　送れた　　' + sent + ' 通',
             '　残り　　　' + left + ' 通',
             '　失敗　　　' + failed + ' 通',
             '　本日の残り送信可能数　' + MailApp.getRemainingDailyQuota() + ' 通'];
  if (left > 0) {
    log.push('');
    log.push('★まだ ' + left + ' 通が残っています。明日また送ります。');
  }
  Logger.log(log.join(NLC));
  return { sent: sent, left: left, failed: failed };
}


/**
 * 送り終えた控えを片づける
 * ★宛先と本文が残っている。個人情報を含むため、長く置かない。
 */
function cleanupMailQueue() {
  var limit = Utilities.formatDate(
    new Date(Date.now() - 30 * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  var rows = SheetsAdapter.readAll('T_MAIL_QUEUE');
  var n = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i].sent_at && String(rows[i].sent_at) < limit) {
      SheetsAdapter.removeAt('T_MAIL_QUEUE', i);
      n++;
    }
  }
  Logger.log('送り終えた控えを ' + n + ' 件片づけました（30日より前のもの）');
  return n;
}


/** いま何通が送信を待っているか */
function countMailQueue() {
  var rows = SheetsAdapter.readAll('T_MAIL_QUEUE');
  var waiting = rows.filter(function (r) { return !r.sent_at; });
  Logger.log('送信を待っているメール　' + waiting.length + ' 通');
  return waiting.length;
}


/**
 * 動作の確認　自分あてに1通だけ送る
 *
 * ★この関数の中だけ、実際に送る設定に切り替える。
 *   全体を送信可にすると、まだ架空のアドレス（example.ac.jp など）が
 *   入っている状態で招待メールが飛びかねない。
 */
function testMail() {
  var me = Session.getActiveUser().getEmail();
  var quota = MailApp.getRemainingDailyQuota();
  Logger.log('送信可能数　残り ' + quota + ' 通');

  if (quota < 1) {
    throw new Error('本日の送信可能数が残っていません');
  }

  Mailer.setDryRun(false);
  try {
    Mailer.send(me, '［テスト］演習林 利用申込システム',
      'このメールは送信の確認のために送られました。' + NL + NL +
      '送信元　' + me + NL +
      '日時　　' + new Date().toLocaleString('ja-JP') + NL + NL +
      'このメールが届いていれば、招待のご案内や受付のご連絡も' + NL +
      '同じ仕組みで送れます。' + NL);
  } finally {
    Mailer.setDryRun(true);   // 必ず元に戻す
  }

  Logger.log('送信しました　' + me);
  Logger.log('残り ' + MailApp.getRemainingDailyQuota() + ' 通');
  return me;
}


/**
 * 実際にメールを送る状態にする
 *
 * ★これを呼ぶまで、招待や受付のご連絡は送られない。
 *   本番のデータが入り、宛先が実在することを確かめてから呼ぶこと。
 */
function enableMailForReal() {
  var users = SheetsAdapter.readAll('M_USER');
  var fake = users.filter(function (u) {
    return /example\.(com|ac\.jp|org)$/.test(u.email || '');
  });

  if (fake.length) {
    throw new Error(
      '架空のメールアドレスが ' + fake.length + ' 件あります。' +
      'これらを消してから実行してください。' +
      '（例　' + fake[0].email + '）');
  }

  Mailer.setDryRun(false);
  Logger.log('実際に送る状態にしました。利用者 ' + users.length + ' 件');
  return true;
}
