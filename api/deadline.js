/**
 * deadline.js  締切の計算
 *
 * 2026年8月19日に7施設の公開ページを調べたところ、
 * 締切の決め方が施設ごとに違い、しかも起算の仕方が3種類あった。
 *
 *   前月◯日まで   北海道20・千葉20・生態水文20・樹芸20・田無15
 *   ◯日前まで     秩父20/10/5・富士14/7・北海道10・生態水文10・樹芸10
 *   ◯日以内       生態水文　利用後7日以内
 *
 * さらに、条件によって値が変わる施設がある。
 *
 *   秩父　利用申込書
 *     1回目          利用希望日の20日前まで（継続課題は10日前）
 *     2回目以降      教職員の対応あり、または宿泊あり  10日前まで
 *                    どちらもなし                      5日前まで
 *
 *   生態水文・樹芸
 *     3か月前より早い申込は受け付けない（下限がある）
 *
 * ★これを単一の数値の列で持つと破綻する。
 *   締切を「基準・方式・値・条件」に分けて持ち、計算はこの1ファイルに集める。
 *   画面にも、他のAPIにも、締切の分岐を書かないこと。
 */

var Deadline = (function () {

  function toDate(s) {
    return (s instanceof Date) ? new Date(s) : new Date(String(s).replace(/-/g, '/'));
  }

  function iso(d) {
    return d.getFullYear() + '-' +
           ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
           ('0' + d.getDate()).slice(-2);
  }

  function addDays(d, n) {
    var x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  /** その日付の前月の◯日 */
  function prevMonthDay(d, day) {
    var x = new Date(d.getFullYear(), d.getMonth() - 1, day);
    // 前月に存在しない日（2月30日など）は、その月の末日に寄せる
    var lastOfPrev = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
    if (day > lastOfPrev) x = new Date(d.getFullYear(), d.getMonth() - 1, lastOfPrev);
    return x;
  }

  /**
   * 施設ごとの、条件による分岐
   *
   * ここだけが「施設名を知っている」場所。
   * 公開ページに書かれていない分岐は、9月のヒアリングで確定する。
   */
  var SPECIAL = {

    // 秩父演習林　利用申込書
    'CHC:利用申込書': function (ctx) {
      if (ctx.is_first_of_year) {
        return { days: ctx.is_continuing ? 10 : 20,
                 why: ctx.is_continuing ? '年度の1回目・継続課題' : '年度の1回目・新規課題' };
      }
      if (ctx.has_staff_support || ctx.has_lodging) {
        return { days: 10, why: '2回目以降・教職員の対応または宿泊あり' };
      }
      return { days: 5, why: '2回目以降・教職員の対応も宿泊もなし' };
    },

    // 秩父演習林　研究教育計画書
    'CHC:研究教育計画書': function (ctx) {
      return { days: ctx.is_continuing ? 10 : 20,
               why: ctx.is_continuing ? '継続課題' : '新規課題' };
    }
  };

  /**
   * 締切の日を計算する
   *
   * @param {Object} form  M6 様式定義の1行
   * @param {Object} ctx   {
   *     use_date          利用日（または年度の初回利用日）
   *     is_first_of_year  その年度の1回目か
   *     is_continuing     継続課題か
   *     has_lodging       宿泊があるか
   *     has_staff_support 教職員の対応があるか
   *     end_date          利用終了日（利用後の提出物で使う）
   *     publish_date      成果の公表日
   *   }
   * @return {Object} {
   *     date       締切の日（'2026-08-10'）。決められないときは null
   *     label      画面に出す文言
   *     why        なぜその日になるか
   *     earliest   受付開始日。下限のない様式では null
   *     unknown    公開情報に記載がないとき true
   *   }
   */
  function calc(form, ctx) {
    ctx = ctx || {};

    var key = form.forest_id + ':' + form.name;
    var sp = SPECIAL[key];
    var days = form.dl_value;
    var why = '';

    if (sp) {
      var r = sp(ctx);
      days = r.days;
      why = r.why;
    }

    var base = null;
    if (form.dl_base === '利用終了日' && ctx.end_date) base = toDate(ctx.end_date);
    else if (form.dl_base === '成果の公表日' && ctx.publish_date) base = toDate(ctx.publish_date);
    else if (ctx.use_date) base = toDate(ctx.use_date);

    if (form.dl_type === '記載なし' || !base) {
      return { date: null, label: form.dl_note || '記載なし',
               why: why, earliest: null, unknown: true };
    }

    var d = null;
    var label = '';

    if (form.dl_type === '前月◯日まで') {
      d = prevMonthDay(base, days);
      label = '前月' + days + '日まで';

    } else if (form.dl_type === '◯日前まで' || form.dl_type === '期間内') {
      d = addDays(base, -days);
      label = days + '日前まで';

    } else if (form.dl_type === '◯日以内') {
      d = addDays(base, days);
      label = '利用後' + days + '日以内';
    }

    var earliest = null;
    if (form.dl_min_days) {
      earliest = addDays(base, -form.dl_min_days);
    }

    return {
      date: d ? iso(d) : null,
      label: label,
      why: why,
      earliest: earliest ? iso(earliest) : null,
      unknown: false
    };
  }

  /**
   * いま出せる状態かを判定する
   * @return 'まだ早い' / '受付中' / '締切を過ぎている' / '判定できない'
   */
  function judge(form, ctx, todayStr) {
    var r = calc(form, ctx);
    if (r.unknown || !r.date) return { state: '判定できない', deadline: r };

    var today = toDate(todayStr || iso(new Date()));
    if (r.earliest && today < toDate(r.earliest)) {
      return { state: 'まだ早い', deadline: r };
    }
    if (form.dl_type === '◯日以内') {
      return { state: today <= toDate(r.date) ? '受付中' : '締切を過ぎている', deadline: r };
    }
    return { state: today <= toDate(r.date) ? '受付中' : '締切を過ぎている', deadline: r };
  }

  /**
   * その申込で必要な様式を、締切つきで並べる
   * 画面はこれを表示するだけでよい
   */
  function scheduleFor(forms, ctx, todayStr) {
    return forms.map(function (f) {
      var j = judge(f, ctx, todayStr);
      return {
        form_code: f.form_code,
        name: f.name,
        doc_type: f.doc_type,
        stage: f.stage,
        condition: f.condition,
        deadline: j.deadline.date,
        deadline_label: j.deadline.label,
        why: j.deadline.why,
        earliest: j.deadline.earliest,
        state: j.state,
        url: f.url,
        file_key: f.file_key,
        note: f.dl_note
      };
    }).sort(function (a, b) {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });
  }

  return { calc: calc, judge: judge, scheduleFor: scheduleFor, iso: iso };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Deadline;
}
