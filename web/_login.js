/**
 * _login.js  ログイン画面
 *
 * ■ 方式
 *   メールアドレスを入れる → 6桁のコードが届く → コードを入れて入る
 *   パスワードは持たせない。年に1回しか使わない方が覚えられないため。
 *
 * ■ 職員と利用者で違うところ
 *   職員　　あらかじめ登録されている方だけが入れる。
 *   　　　　自分では登録できず、管理者からの招待が要る。
 *   利用者　はじめての方でも、メールアドレスがあれば入れる。
 *
 * ■ 試作での扱い
 *   実際にメールを送るのは Google Apps Script に載せてから。
 *   ここでは、発行されたコードを画面に出して先へ進めるようにしてある。
 *   ★本番ではこの表示を必ず消すこと。
 */

var LoginView = (function () {

  var issued = null;    // 発行したコードの控え
  var kind = 'staff';
  var msg = null;
  var onDone = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function el() { return document.getElementById('login-layer'); }

  /** 画面を開く */
  function open(k, done) {
    kind = k || 'staff';
    issued = null;
    msg = null;
    onDone = done;
    if (!el()) {
      var d = document.createElement('div');
      d.id = 'login-layer';
      document.body.appendChild(d);
      injectStyle();
    }
    render();
  }

  function close() {
    var d = el();
    if (d) d.parentNode.removeChild(d);
  }

  function injectStyle() {
    if (document.getElementById('login-style')) return;
    var st = document.createElement('style');
    st.id = 'login-style';
    st.textContent =
      '#login-layer{position:fixed;inset:0;background:rgba(20,30,45,.55);' +
        'display:flex;align-items:center;justify-content:center;z-index:9999;' +
        'font-family:"Segoe UI","Hiragino Kaku Gothic ProN","Meiryo",sans-serif}' +
      '#login-layer .box{background:#fff;border-radius:7px;width:400px;max-width:92vw;' +
        'padding:26px 28px;box-shadow:0 8px 32px rgba(0,0,0,.28)}' +
      '#login-layer h2{margin:0 0 4px;font-size:17px;color:#1F3864}' +
      '#login-layer .lead{margin:0 0 18px;font-size:12.5px;color:#666;line-height:1.7}' +
      '#login-layer label{display:block;font-size:12.5px;font-weight:600;' +
        'margin-bottom:4px;color:#333}' +
      '#login-layer input{width:100%;padding:9px 11px;border:1px solid #C8CFC8;' +
        'border-radius:4px;font-size:14px;font-family:inherit;margin-bottom:14px}' +
      '#login-layer input:focus{outline:none;border-color:#3D5A8A;' +
        'box-shadow:0 0 0 2px #E9EEF6}' +
      '#login-layer input.code{letter-spacing:.5em;text-align:center;font-size:20px}' +
      '#login-layer .btn{width:100%;padding:11px;border:none;border-radius:4px;' +
        'background:#1F3864;color:#fff;font-size:14px;font-weight:600;cursor:pointer;' +
        'font-family:inherit}' +
      '#login-layer .btn:hover{background:#16294a}' +
      '#login-layer .btn.sub{background:#fff;color:#1F3864;border:1px solid #3D5A8A;' +
        'margin-top:8px}' +
      '#login-layer .err{background:#FBEDEC;border:1px solid #B02418;color:#B02418;' +
        'padding:9px 12px;border-radius:4px;font-size:12.5px;margin-bottom:14px}' +
      '#login-layer .demo{background:#FFF8E6;border:1px dashed #C9A227;color:#6B5410;' +
        'padding:10px 12px;border-radius:4px;font-size:12.5px;margin-bottom:14px;' +
        'line-height:1.7}' +
      '#login-layer .demo b{font-size:18px;letter-spacing:.2em}' +
      '#login-layer .tabs{display:flex;gap:6px;margin-bottom:18px}' +
      '#login-layer .tabs button{flex:1;padding:8px;border:1px solid #D8DDE5;' +
        'background:#fff;color:#666;border-radius:4px;cursor:pointer;font-size:12.5px;' +
        'font-family:inherit}' +
      '#login-layer .tabs button.on{background:#1F3864;color:#fff;border-color:#1F3864}' +
      '#login-layer .note{font-size:11.5px;color:#888;margin-top:14px;line-height:1.7}';
    document.head.appendChild(st);
  }

  function render() {
    var d = el();
    if (!d) return;

    if (!issued) {
      d.innerHTML =
      '<div class="box">' +
        '<h2>ログイン</h2>' +
        '<p class="lead">ご登録のメールアドレスに、6桁の番号をお送りします。<br>' +
          'パスワードは必要ありません。</p>' +

        '<div class="tabs">' +
          '<button class="' + (kind === 'staff' ? 'on' : '') + '" ' +
            'onclick="LoginView.setKind(\'staff\')">職員の方</button>' +
          '<button class="' + (kind === 'user' ? 'on' : '') + '" ' +
            'onclick="LoginView.setKind(\'user\')">利用される方</button>' +
        '</div>' +

        (msg ? '<div class="err">' + esc(msg) + '</div>' : '') +

        '<label>メールアドレス</label>' +
        '<input type="email" id="login-email" placeholder="' +
          (kind === 'staff' ? 'example@uf.a.u-tokyo.ac.jp' : 'example@example.ac.jp') +
          '" onkeydown="if(event.key===\'Enter\')LoginView.send()">' +

        '<button class="btn" onclick="LoginView.send()">番号を受け取る</button>' +

        (kind === 'staff' ?
          '<div class="note">★職員としてのご登録がない場合は入れません。<br>' +
          '　システム管理者に招待をご依頼ください。</div>' :
          '<div class="note">はじめての方も、メールアドレスがあればお入りいただけます。</div>') +
      '</div>';

      var i = document.getElementById('login-email');
      if (i) i.focus();

    } else {
      d.innerHTML =
      '<div class="box">' +
        '<h2>番号をご入力ください</h2>' +
        '<p class="lead">' + esc(issued.email) + ' にお送りしました。<br>' +
          '有効期限は ' + Auth.CODE_MINUTES + ' 分です。</p>' +

        // ★試作のための表示。本番では消すこと
        '<div class="demo">試作のため、ここに番号を出しています。<br>' +
          '<b>' + issued.code + '</b><br>' +
          '本番ではメールでお届けします。</div>' +

        (msg ? '<div class="err">' + esc(msg) + '</div>' : '') +

        '<label>6桁の番号</label>' +
        '<input type="text" id="login-code" class="code" maxlength="6" ' +
          'inputmode="numeric" onkeydown="if(event.key===\'Enter\')LoginView.enter()">' +

        '<button class="btn" onclick="LoginView.enter()">入る</button>' +
        '<button class="btn sub" onclick="LoginView.back()">戻る</button>' +
      '</div>';

      var c = document.getElementById('login-code');
      if (c) c.focus();
    }
  }

  function setKind(k) { kind = k; msg = null; render(); }

  function send() {
    var email = (document.getElementById('login-email') || {}).value || '';
    if (!email || email.indexOf('@') < 0) {
      msg = 'メールアドレスをご確認ください';
      render();
      return;
    }
    var r = Auth.requestCode(email.trim(), kind);
    if (!r.ok) { msg = r.error; render(); return; }
    issued = { code: r.code, until: r.until, kind: r.kind, id: r.id, email: email.trim() };
    msg = null;
    render();
  }

  function enter() {
    var code = (document.getElementById('login-code') || {}).value || '';
    var r = Auth.verify(issued.email, code.trim(), issued);
    if (!r.ok) { msg = r.error; render(); return; }
    close();
    if (onDone) onDone(r.me);
  }

  function back() { issued = null; msg = null; render(); }

  return { open: open, close: close, setKind: setKind,
           send: send, enter: enter, back: back };
})();
