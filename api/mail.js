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

var Mailer = (function () {

  /** 送信元の表示名 */
  var SENDER_NAME = '東京大学演習林 利用申込';

  /** 本番に切り替えるまでは、実際に送らずログに残すだけにする */
  var DRY_RUN = true;

  function baseUrl() {
    var u = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL');
    return u || '（未設定）';
  }

  function send(to, subject, body) {
    if (DRY_RUN) {
      Logger.log('［送信せず］宛先 ' + to + '\n件名 ' + subject + '\n' + body);
      return { ok: true, dry: true };
    }
    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: body,
      name: SENDER_NAME,
      noReply: false
    });
    remaining();
    return { ok: true, dry: false };
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
    setDryRun: function (v) { DRY_RUN = v; }
  };
})();


/**
 * 動作の確認　まず自分あてに1通送る
 * ★DRY_RUN を false にしてから実行すること
 */
function testMail() {
  var me = Session.getActiveUser().getEmail();
  Logger.log('送信可能数　残り ' + MailApp.getRemainingDailyQuota() + ' 通');
  Mailer.send(me, '［テスト］演習林 利用申込システム',
    'このメールは送信の確認のために送られました。\n\n' +
    '送信元　' + me + '\n' +
    '日時　　' + new Date().toLocaleString('ja-JP') + '\n');
  return me;
}
