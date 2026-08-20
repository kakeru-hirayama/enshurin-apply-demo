/**
 * upload.js  書類の提出
 *
 * ■ 打ち合わせで確認したこと
 *   ・一つの利用に対して、時間の経過とともに資料が増えていく
 *   　　利用前　図面・スケジュール・宿舎の希望
 *   　　利用中　随時のやり取り
 *   　　利用後　報告書・成果として公表された論文
 *   ・現在は富士が紙のファイルで実現している
 *   ・「その利用に関連づけて保管・閲覧できる必要がある」（打ち合わせでのご要望）
 *
 * ■ 置き場所
 *   ファイルの実体は Google ドライブに置き、記録には場所だけを持つ。
 *   スプレッドシートにファイルそのものは入れない。
 *
 *   ドライブの中の並べ方
 *     2026年度 / 北海道演習林 / 2026-HKD-0001 / A1_研究計画書.pdf
 *
 *   ★申込IDのフォルダにまとめる。これが富士のキャビネットに当たる。
 *
 * ■ 受け付けるもの
 *   PDF・Word・Excel・画像。1件あたり20MBまで。
 *   実行できる形式は受け付けない。
 */

var Upload = (function () {

  var MAX_BYTES = 20 * 1024 * 1024;

  // 受け付ける拡張子と、その説明
  var ALLOWED = {
    'pdf':  'PDF',
    'doc':  'Word', 'docx': 'Word',
    'xls':  'Excel', 'xlsx': 'Excel',
    'ppt':  'PowerPoint', 'pptx': 'PowerPoint',
    'jpg':  '画像', 'jpeg': '画像', 'png': '画像', 'heic': '画像',
    'csv':  'CSV', 'txt': 'テキスト',
    'zip':  'ZIP'
  };

  // 受け付けないもの。名前を変えただけで通らないよう、明示して弾く
  var BLOCKED = ['exe', 'bat', 'cmd', 'com', 'scr', 'js', 'vbs', 'ps1',
                 'jar', 'msi', 'dll', 'sh', 'app'];

  function extOf(name) {
    var m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  /**
   * 受け付けてよいファイルかを調べる
   * @return {Object} { ok, error, kind }
   */
  function check(file) {
    var ext = extOf(file.name);

    if (BLOCKED.indexOf(ext) >= 0) {
      return { ok: false, error: 'この形式のファイルはお預かりできません（.' + ext + '）' };
    }
    if (!ALLOWED[ext]) {
      return { ok: false,
               error: 'お預かりできる形式は PDF・Word・Excel・画像などです（.' + ext + '）' };
    }
    if (file.size > MAX_BYTES) {
      return { ok: false,
               error: 'ファイルの大きさが上限を超えています（' +
                      mb(file.size) + '／上限 ' + mb(MAX_BYTES) + '）' };
    }
    if (file.size === 0) {
      return { ok: false, error: '中身が空のようです' };
    }
    return { ok: true, kind: ALLOWED[ext] };
  }

  function mb(n) {
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /** ファイルを base64 にする。サーバーへ渡すため */
  function toBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      r.onerror = function () { reject(new Error('ファイルを読めませんでした')); };
      r.readAsDataURL(file);
    });
  }

  /**
   * 1件を送る
   * @param {string} appId
   * @param {File} file
   * @param {Object} meta { phase, kind, form_code }
   */
  function send(appId, file, meta) {
    var c = check(file);
    if (!c.ok) return Promise.reject(new Error(c.error));

    return toBase64(file).then(function (b64) {
      // サーバーにつながっているときは、実体をドライブへ送る
      if (typeof RemoteAdapter !== 'undefined' &&
          (typeof google !== 'undefined' || RemoteAdapter.endpoint)) {
        return callServer(appId, file, b64, meta);
      }
      // つながっていないときは、記録だけを残す（試作の動きを見るため）
      var docId = API.attachFile(appId, {
        phase: (meta && meta.phase) || '利用前',
        kind: (meta && meta.kind) || '提出書類',
        form_code: (meta && meta.form_code) || '',
        file_name: file.name,
        file_id: 'local:' + Date.now(),
        submitted_at: new Date().toISOString().slice(0, 10),
        submitted_by: ''
      });
      return { doc_id: docId, file_name: file.name, local: true };
    });
  }

  function callServer(appId, file, b64, meta) {
    return new Promise(function (resolve, reject) {
      var args = [appId, file.name, file.type || 'application/octet-stream', b64];
      if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .rpc('uploadFile', JSON.stringify(args));
      } else {
        fetch(RemoteAdapter.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fn: 'uploadFile', args: args })
        }).then(function (r) { return r.json(); })
          .then(function (j) { j.ok ? resolve(j.result) : reject(new Error(j.error)); })
          .catch(reject);
      }
    });
  }

  /** 複数まとめて送る。1件ずつ順に処理し、途中で失敗しても続ける */
  function sendAll(appId, files, meta, onEach) {
    var list = [].slice.call(files);
    var results = [];

    return list.reduce(function (chain, f) {
      return chain.then(function () {
        return send(appId, f, meta)
          .then(function (r) {
            results.push({ ok: true, name: f.name, result: r });
            if (onEach) onEach({ ok: true, name: f.name, result: r });
          })
          .catch(function (e) {
            results.push({ ok: false, name: f.name, error: e.message });
            if (onEach) onEach({ ok: false, name: f.name, error: e.message });
          });
      });
    }, Promise.resolve()).then(function () { return results; });
  }

  return {
    check: check,
    send: send,
    sendAll: sendAll,
    mb: mb,
    MAX_BYTES: MAX_BYTES,
    ALLOWED: ALLOWED
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Upload;
}
