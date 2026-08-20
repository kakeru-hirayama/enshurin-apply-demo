/**
 * conditions.js  申込時にうかがう条件
 *
 * ■ なぜこれが要るか
 *   「ドローンを飛ばしますか」と聞く必要があるのは、
 *   その演習林にドローンの様式がある場合だけである。
 *   千葉演習林にはドローンの様式がないため、聞いても意味がない。
 *
 *   演習林ごとに聞くべきことが違う。
 *   これを画面に if 文で書くと、演習林が増えるたびに画面を直すことになる。
 *
 * ■ どうするか
 *   様式定義（M6）を見て、聞くべき条件を組み立てる。
 *   様式が増えれば聞く項目も自然に増える。画面は変えなくてよい。
 */

var Conditions = (function () {

  /**
   * 書類の種類と、それを必要とする条件の対応
   *   key    S.draft に持つ名前
   *   label  画面に出す文言
   *   types  この種類の書類があるときだけ聞く
   */
  var RULES = [
    { key: 'has_lodging', label: '宿泊します',
      types: ['宿泊申込'], always_if: 'lodging_style' },
    { key: 'data_use', label: '演習林が持つデータを使います',
      types: ['データ利用'] },
    { key: 'specimen', label: '標本や試料の提供を受けます',
      types: ['標本・試料'] },
    { key: 'uav', label: 'ドローン（無人航空機）を飛ばします',
      types: ['無人航空機'] },
    { key: 'animals', label: '脊椎動物を対象とした調査を行います',
      types: ['野生動物'] },
    { key: 'chemicals', label: '化学物質や生物を持ち込みます',
      types: ['化学物質'] },
    { key: 'insurance', label: '保険に加入しています',
      types: ['保険'] },
    { key: 'visit_only', label: '見学のみの利用です',
      types: ['名簿'], only_if_condition: /見学|一般利用/ }
  ];

  /**
   * その演習林で聞くべき条件を返す
   * @param {Object} forest  M3 の1行
   * @param {Array}  forms   M6 のその演習林の行
   * @return {Array} [{ key, label, why }]
   */
  function forForest(forest, forms) {
    var out = [];

    // 年度計画の承認がある演習林でだけ、年度の何回目かを聞く
    if (forest && forest.has_annual_plan !== false) {
      out.push({ key: 'is_first_of_year', label: '今年度はじめての利用です',
                 why: '年度ごとに計画書の提出が必要なため' });
      out.push({ key: 'is_continuing', label: '昨年度から続いている課題です',
                 why: '継続の課題は締切が異なる場合があるため' });
    }

    // 職員の対応の有無で締切が変わる演習林でだけ聞く
    var hasStaffRule = forms.some(function (f) {
      return /教職員|職員の対応|案内|送迎/.test(f.dl_note || '');
    });
    if (hasStaffRule) {
      out.push({ key: 'has_staff_support',
                 label: '演習林の職員に案内や送迎をお願いします',
                 why: '締切が変わるため' });
    }

    // 様式の種類から、聞くべきことを決める
    RULES.forEach(function (r) {
      var hit = forms.filter(function (f) {
        if (r.types.indexOf(f.doc_type) < 0) return false;
        if (r.only_if_condition && !r.only_if_condition.test(f.condition || '')) return false;
        return true;
      });

      // 宿泊は、様式がなくても宿泊施設がある演習林では聞く
      if (!hit.length && r.key === 'has_lodging' && forest &&
          forest.lodging_style && forest.lodging_style !== '記載なし' &&
          forest.lodging_style !== '様式なし') {
        out.push({ key: r.key, label: r.label,
                   why: '宿泊の可否を事前に確認する必要があるため' });
        return;
      }
      if (!hit.length) return;

      out.push({ key: r.key, label: r.label,
                 why: hit.map(function (f) { return f.name; }).join('・') + ' が必要になります' });
    });

    return out;
  }

  /**
   * 選ばれた条件から、提出が必要な書類を絞り込む
   *
   * ★条件の文言そのものではなく、書類の種類で判定する。
   *   文言は演習林ごとに違うため、文言で判定すると取りこぼす。
   */
  function neededForms(forms, draft) {
    var need = {
      '宿泊申込': 'has_lodging',
      'データ利用': 'data_use',
      '標本・試料': 'specimen',
      '無人航空機': 'uav',
      '野生動物': 'animals',
      '化学物質': 'chemicals',
      '保険': 'insurance'
    };

    return forms.filter(function (f) {
      // 参考資料は提出物ではない
      if (f.doc_type === '参考資料') return false;

      // 見学のみの利用のとき／でないときで、名簿の要否が変わる
      if (f.doc_type === '名簿' && /見学|一般利用/.test(f.condition || '')) {
        return !!draft.visit_only;
      }
      if (f.doc_type === '名簿' && draft.visit_only) {
        return /見学|一般利用/.test(f.condition || '');
      }

      // 計画書は、見学のみのときは不要
      if (f.doc_type === '計画書' && draft.visit_only) return false;

      var k = need[f.doc_type];
      if (k) return !!draft[k];

      // 計画書・申込書・緊急連絡先・届出は常に必要
      return true;
    });
  }

  return { forForest: forForest, neededForms: neededForms, RULES: RULES };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Conditions;
}
