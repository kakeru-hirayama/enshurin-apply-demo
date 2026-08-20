/**
 * schema.js  データの定義
 *
 * この1ファイルが、システムが扱うデータの全体である。
 * 表を足す、項目を足すときは、必ずここを直す。
 *
 * なぜ日本語と英語の両方を持つか
 *   スプレッドシートのヘッダーは日本語にする。開いた人がそのまま読めるため。
 *   コードの中では英語のキーを使う。表記ゆれで壊れないため。
 *   その対応をここで一度だけ定義し、他の場所には書かない。
 *
 * この定義は、GAS（Google Apps Script）でもブラウザでもそのまま動く。
 * import / export を使っていないのはそのため。
 */

var SCHEMA = {

  // ================================================ マスタ

  M_USER: {
    sheet: 'M1_利用者',
    key: 'user_id',
    note: '★個人情報を含む。アクセス権を他と分ける',
    columns: [
      { key: 'user_id',      label: '利用者ID',        type: 'id' },
      { key: 'email',        label: 'メールアドレス',   type: 'email', required: true },
      { key: 'name',         label: '氏名',            type: 'text',  required: true },
      { key: 'name_kana',    label: 'ふりがな',        type: 'text' },
      { key: 'org',          label: '所属',            type: 'text',  required: true },
      { key: 'org_type',     label: '所属属性',        type: 'enum',  options: 'ORG_TYPE' },
      { key: 'status_type',  label: '身分',            type: 'enum',  options: 'STATUS_TYPE' },
      { key: 'gender',       label: '性別',            type: 'enum',  options: 'GENDER' },
      { key: 'birth_date',   label: '生年月日',        type: 'date',  sensitive: 'staff' },
      { key: 'nationality',  label: '国籍・出身国',    type: 'text',  sensitive: 'staff' },
      { key: 'allergy',      label: 'アレルギー',      type: 'text',  sensitive: 'lodging' },
      { key: 'emergency',    label: '緊急連絡先',      type: 'text',  sensitive: 'emergency' },
      { key: 'updated_at',   label: '最終更新日',      type: 'datetime' }
    ]
  },

  M_STAFF: {
    sheet: 'M2_職員',
    key: 'staff_id',
    columns: [
      { key: 'staff_id',    label: '職員ID',          type: 'id' },
      { key: 'login_id',    label: 'ログイン用アカウント', type: 'email',
        note: '★全学の共通アカウントか、独自ドメインか要確認' },
      { key: 'email',       label: '連絡用アドレス',   type: 'email' },
      { key: 'name',        label: '氏名',            type: 'text' },
      { key: 'forest_id',   label: '所属演習林',      type: 'ref', ref: 'M_FOREST' },
      { key: 'role',        label: '権限',            type: 'enum', options: 'ROLE' },
      { key: 'active',      label: '在職',            type: 'bool' }
    ]
  },

  M_FOREST: {
    sheet: 'M3_演習林',
    key: 'forest_id',
    note: '★施設ごとの手続きの違いを、ここに集める。画面にif文を書かない',
    columns: [
      { key: 'forest_id',      label: '演習林ID',       type: 'id' },
      { key: 'name',           label: '名称',           type: 'text' },
      { key: 'short_name',     label: '略称',           type: 'text',
        note: '本部への報告で使われている表記に合わせる' },
      { key: 'default_view',   label: '既定の画面',     type: 'enum', options: 'VIEW_TYPE',
        note: '人物軸か日付軸か。演習林ごとに選べる' },

      // ↓ 2026-08-19の調査で、施設ごとに割れることが分かった項目
      { key: 'has_annual_plan', label: '年度計画の承認があるか', type: 'bool',
        note: '★true  計画書を出して承認を受け、その後に都度申込（千葉・北海道・生態水文・富士・樹芸）\n' +
              '　 false 申込書1本で完結（田無）、または計画書と申込書が同一（秩父）' },
      { key: 'issues_permit',   label: '許可証を発行するか', type: 'bool',
        note: '★発行する　千葉（計画承認書＋利用許可証）・田無・生態水文・富士\n' +
              '　 記載なし　北海道・秩父・樹芸\n' +
              '　「発行しない」を異常系にしないこと' },
      { key: 'lodging_style',   label: '宿泊の申込方法', type: 'enum', options: 'LODGING_STYLE' },
      { key: 'post_use_report', label: '利用後の報告',   type: 'enum', options: 'POST_USE' },
      { key: 'active',          label: '運用中',         type: 'bool' }
    ]
  },

  M_FACILITY: {
    sheet: 'M4_施設',
    key: 'facility_id',
    note: '★これが表になっていることで、施設が増えても集計の式を足す必要がなくなる',
    columns: [
      { key: 'facility_id', label: '施設ID',     type: 'id' },
      { key: 'forest_id',   label: '演習林',     type: 'ref', ref: 'M_FOREST' },
      { key: 'kind',        label: '種別',       type: 'enum', options: 'FACILITY_KIND' },
      { key: 'name',        label: '名称',       type: 'text' },
      { key: 'capacity',    label: '定員',       type: 'number' },
      { key: 'has_meal',    label: '食事の有無', type: 'bool' },
      { key: 'active',      label: '運用中',     type: 'bool' }
    ]
  },

  M_STATUS: {
    sheet: 'M5_ステータス定義',
    key: ['forest_id', 'code'],
    note: '★演習林ごとにワークフローが違うため、状態の定義そのものを持たせる',
    columns: [
      { key: 'forest_id',  label: '演習林',       type: 'ref', ref: 'M_FOREST' },
      { key: 'seq',        label: '順序',         type: 'number' },
      { key: 'code',       label: 'コード',       type: 'text' },
      { key: 'label',      label: 'ステータス名', type: 'text' },
      { key: 'next_codes', label: '次に進める先', type: 'list' },
      { key: 'is_open',    label: '対応中扱い',   type: 'bool',
        note: '一覧で「未処理」として拾うかどうか' },
      { key: 'color',      label: '表示色',       type: 'text' }
    ]
  },

  M_FORM: {
    sheet: 'M6_様式定義',
    key: ['forest_id', 'form_code'],
    note: '★1行＝1つの「書類」。ファイルではない。\n' +
          '　 2026-08-19の調査で、1つのファイルに複数の書類が入っている施設があると判明した。\n' +
          '　 千葉　利用申込書・利用時届出書・緊急連絡先名簿　が1ファイル\n' +
          '　 秩父　研究教育計画書・利用申込書・利用者名簿・宿泊利用申込書　が1ファイル\n' +
          '　 ファイル単位で持つと、施設をまたげなくなる。',
    columns: [
      { key: 'forest_id',  label: '演習林',       type: 'ref', ref: 'M_FOREST' },
      { key: 'form_code',  label: '書類の記号',   type: 'text',
        note: '記号のない施設では、こちらで通し番号を振る' },
      { key: 'name',       label: '書類の名称',   type: 'text' },
      { key: 'doc_type',   label: '書類の種類',   type: 'enum', options: 'DOC_TYPE',
        note: '★施設をまたいで比べられるようにするための分類' },
      { key: 'stage',      label: '提出の段階',   type: 'enum', options: 'FORM_STAGE' },
      { key: 'condition',  label: '必要になる条件', type: 'text' },
      { key: 'each_time',  label: '利用の都度',   type: 'bool' },

      // 締切　★7施設で7通り、起算の仕方が3種類ある
      { key: 'dl_base',    label: '締切の起算点', type: 'enum', options: 'DEADLINE_BASE' },
      { key: 'dl_type',    label: '締切の方式',   type: 'enum', options: 'DEADLINE_TYPE' },
      { key: 'dl_value',   label: '締切の値',     type: 'number',
        note: '前月◯日なら日、◯日前なら日数' },
      { key: 'dl_min_days', label: '受付開始の下限', type: 'number',
        note: '生態水文と樹芸は3か月前より早い申込を受け付けない' },
      { key: 'dl_note',    label: '締切の但し書き', type: 'text',
        note: '秩父は 回数×教職員対応の有無×宿泊の有無 で5日／10日／20日に分岐する' },

      // ファイルとの対応
      { key: 'file_key',   label: 'ファイルの識別', type: 'text',
        note: '★同じ値を持つ書類は、同じファイルに入っている' },
      { key: 'file_type',  label: 'ファイル形式', type: 'text' },
      { key: 'url',        label: '様式のリンク', type: 'url' },
      { key: 'source_url', label: '出典のページ', type: 'url' }
    ]
  },

  // ================================================ 記録

  T_PLAN: {
    sheet: 'T0_年度計画',
    key: 'plan_id',
    note: '★年度ごとの研究課題・教育計画。承認を受けると、その年度の申込が出せるようになる。\n' +
          '　 2026-08-19の調査で、施設によってこの段階の有無が割れることが分かった。\n' +
          '　 あり　千葉・北海道・生態水文・富士・樹芸（条件付き）\n' +
          '　 なし　田無（申込書1本）、秩父（計画書と申込書が同一ファイル）\n' +
          '　 ★承認済み計画への紐付けを必須にすると、田無と秩父が通らなくなる。\n' +
          '　 T1.plan_id は空でよい設計とすること。',
    columns: [
      { key: 'plan_id',     label: '計画ID',       type: 'id' },
      { key: 'forest_id',   label: '演習林',       type: 'ref', ref: 'M_FOREST' },
      { key: 'fiscal_year', label: '年度',         type: 'number' },
      { key: 'rep_user_id', label: '代表者',       type: 'ref', ref: 'M_USER' },
      { key: 'title',       label: '課題名',       type: 'text' },
      { key: 'category',    label: '区分',         type: 'enum', options: 'USE_CATEGORY' },
      { key: 'status',      label: 'ステータス',   type: 'text' },
      { key: 'approved_at', label: '承認日',       type: 'date' },
      { key: 'permit_no',   label: '承認書番号',   type: 'text',
        note: '千葉は「計画承認書」を発行する。発行しない施設では空' },
      { key: 'report_until', label: '報告義務の期限', type: 'date',
        note: '★北海道は利用後2年間、毎年1〜2月に利用報告が必要。\n' +
              '　 これは利用単位ではなく課題単位のため、ここに持つ' }
    ]
  },

  T_APPLICATION: {
    sheet: 'T1_申込',
    key: 'app_id',
    note: '★すべての中心。他の表はここを参照する',
    columns: [
      { key: 'app_id',      label: '申込ID',        type: 'id',
        note: '2026-HKD-0001 の形。年度＋演習林＋連番' },
      { key: 'forest_id',   label: '演習林',        type: 'ref', ref: 'M_FOREST' },
      { key: 'plan_id',     label: '年度計画',      type: 'ref', ref: 'T_PLAN',
        note: '★空でよい。年度計画の段階を持たない施設（田無・秩父）があるため' },
      { key: 'rep_user_id', label: '利用代表者',    type: 'ref', ref: 'M_USER' },
      { key: 'rep_org',     label: '代表者所属',    type: 'text',
        note: '申込時点の所属を残す。人マスタの現在値とは別に持つ' },
      { key: 'org_type',    label: '所属属性',      type: 'enum', options: 'ORG_TYPE' },
      { key: 'purpose',     label: '利用目的',      type: 'text' },
      { key: 'category',    label: '区分',          type: 'enum', options: 'USE_CATEGORY' },
      { key: 'place',       label: '利用場所',      type: 'text' },
      { key: 'date_from',   label: '開始日',        type: 'date' },
      { key: 'date_to',     label: '終了日',        type: 'date' },
      { key: 'status',      label: 'ステータス',    type: 'ref', ref: 'M_STATUS' },
      { key: 'applied_at',  label: '申請日',        type: 'date' },
      { key: 'approved_at', label: '許可日',        type: 'date' },
      { key: 'legacy_no',   label: '旧システム番号', type: 'text',
        note: '移行用。北海道演習林などで使われている番号' },
      { key: 'created_at',  label: '作成日時',      type: 'datetime' },
      { key: 'updated_at',  label: '更新日時',      type: 'datetime' },

      // ★新しい項目は、必ず末尾に足すこと。
      //   途中に入れると、すでに入っているデータが1列ずれる。
      { key: 'staff_memo',  label: '職員メモ',      type: 'text',
        note: '★申込者には見せない。電話で伺ったことなどを書き留める場所。'
            + 'この欄がないと、職員は別のノートや口頭で引き継ぐことになる' }
    ]
  },

  T_USAGE_DAY: {
    sheet: 'T2_利用日',
    key: ['app_id', 'date'],
    note: '★現在のデータが一日一行で保持されているのは、この形',
    columns: [
      { key: 'app_id', label: '申込ID', type: 'ref', ref: 'T_APPLICATION' },
      { key: 'date',   label: '日付',   type: 'date' }
    ]
  },

  T_PARTICIPANT: {
    sheet: 'T3_参加者',
    key: ['app_id', 'user_id'],
    note: '★未登録の人がいる間は申込を確定できない、という制御に使う',
    columns: [
      { key: 'app_id',      label: '申込ID',     type: 'ref', ref: 'T_APPLICATION' },
      { key: 'user_id',     label: '利用者ID',   type: 'ref', ref: 'M_USER' },
      { key: 'invite_name', label: '招待時の氏名', type: 'text',
        note: '代表者が入力する。本人が登録すると人マスタの氏名が正となる' },
      { key: 'invite_email', label: '招待先アドレス', type: 'email' },
      { key: 'role',        label: '参加区分',   type: 'enum', options: 'PARTICIPANT_ROLE' },
      { key: 'reg_status',  label: '登録状況',   type: 'enum', options: 'REG_STATUS' },
      { key: 'invited_at',  label: '招待日時',   type: 'datetime' },
      { key: 'registered_at', label: '登録日時', type: 'datetime' }
    ]
  },

  T_HEADCOUNT: {
    sheet: 'T4_人数内訳',
    key: null,
    note: '★54列の横持ちを縦に持ち替えたもの。区分が増えても表の形は変わらない',
    columns: [
      { key: 'app_id',     label: '申込ID',   type: 'ref', ref: 'T_APPLICATION' },
      { key: 'date',       label: '日付',     type: 'date' },
      { key: 'org_type',   label: '所属属性', type: 'enum', options: 'ORG_TYPE' },
      { key: 'status_type', label: '身分',    type: 'enum', options: 'STATUS_TYPE' },
      { key: 'gender',     label: '性別',     type: 'enum', options: 'GENDER' },
      { key: 'count',      label: '人数',     type: 'number' },
      { key: 'is_planned', label: '予定か実績か', type: 'enum', options: 'PLAN_ACTUAL' }
    ]
  },

  T_LODGING: {
    sheet: 'T5_宿泊',
    key: null,
    note: '★日付と施設で重複を調べられる。紙では最も扱いにくかった部分',
    columns: [
      { key: 'app_id',      label: '申込ID', type: 'ref', ref: 'T_APPLICATION' },
      { key: 'date',        label: '日付',   type: 'date' },
      { key: 'facility_id', label: '施設',   type: 'ref', ref: 'M_FACILITY' },
      { key: 'room',        label: '寝室',   type: 'text',
        note: '北海道演習林は寝室の指定まで行う' },
      { key: 'count',       label: '人数',   type: 'number' },
      { key: 'is_planned',  label: '予定か実績か', type: 'enum', options: 'PLAN_ACTUAL' }
    ]
  },

  T_DOCUMENT: {
    sheet: 'T6_資料',
    key: 'doc_id',
    note: '★富士のキャビネットに相当する。ファイルの実体はドライブに置く',
    columns: [
      { key: 'doc_id',      label: '資料ID',     type: 'id' },
      { key: 'app_id',      label: '申込ID',     type: 'ref', ref: 'T_APPLICATION' },
      { key: 'phase',       label: '時期',       type: 'enum', options: 'DOC_PHASE' },
      { key: 'kind',        label: '種別',       type: 'text' },
      { key: 'form_code',   label: '様式の記号', type: 'text' },
      { key: 'file_name',   label: 'ファイル名', type: 'text' },
      { key: 'file_id',     label: 'ファイルID', type: 'text',
        note: 'Google ドライブのID。実体はスプレッドシートに入れない' },
      { key: 'submitted_at', label: '提出日',    type: 'date' },
      { key: 'submitted_by', label: '提出者',    type: 'text' }
    ]
  },

  T_MESSAGE: {
    sheet: 'T7_やり取り',
    key: 'msg_id',
    note: '★誰がいつどの確認を行ったかが残る。現在はメールに散らばっている',
    columns: [
      { key: 'msg_id',   label: 'ID',       type: 'id' },
      { key: 'app_id',   label: '申込ID',   type: 'ref', ref: 'T_APPLICATION' },
      { key: 'at',       label: '日時',     type: 'datetime' },
      { key: 'kind',     label: '種別',     type: 'enum', options: 'MSG_KIND' },
      { key: 'from',     label: '発言者',   type: 'text' },
      { key: 'to',       label: '宛先',     type: 'text' },
      { key: 'body',     label: '内容',     type: 'text' }
    ]
  },

  T_AUDIT: {
    sheet: 'T8_操作ログ',
    key: null,
    note: '★緊急連絡先を開いた記録もここに残る',
    columns: [
      { key: 'at',       label: '日時',   type: 'datetime' },
      { key: 'staff_id', label: '操作者', type: 'ref', ref: 'M_STAFF' },
      { key: 'action',   label: '操作',   type: 'text' },
      { key: 'target',   label: '対象',   type: 'text' },
      { key: 'detail',   label: '内容',   type: 'text' },
      { key: 'ip',       label: '接続元', type: 'text' }
    ]
  },

  /**
   * T9  ログイン用の合言葉
   *
   * ★合言葉そのものは、ここにしか置かない。画面には渡さない。
   *   画面に渡して画面側で照合すると、
   *   開発者ツールで合言葉が読めてしまい、意味がなくなる。
   *   （2026-08-20 その作りになっていたので改めた）
   *
   *   使い終わった行は used に日時を入れる。
   *   一度使った合言葉は、期限内でも二度は通さない。
   */
  T_LOGIN_CODE: {
    sheet: 'T9_ログイン合言葉',
    key: null,
    columns: [
      { key: 'email',   label: 'メールアドレス', type: 'text' },
      { key: 'kind',    label: '種別',       type: 'select', options: ['staff', 'user'] },
      { key: 'code',    label: '合言葉',     type: 'text' },
      { key: 'until',   label: '有効期限',   type: 'datetime' },
      { key: 'used',    label: '使用日時',   type: 'datetime' },
      { key: 'tries',   label: '試行回数',   type: 'number' },
      { key: 'issued',  label: '発行日時',   type: 'datetime' }
    ]
  },

  /**
   * TB  画面のどこを押したか
   *
   * ■ 何のために取るか
   *   申込の途中で、どこで手が止まっているかを知るため。
   *   「使いにくい」という声は上がりにくいが、
   *   途中でやめた場所は数に出る。
   *
   * ■ 取らないもの
   *   ★入力された中身は取らない。押した場所と時刻だけを残す。
   *   ★誰かは、ログインしている場合を除いて分からないままにする。
   *     visit は「同じ人が続けて操作したひとまとまり」を表すだけの、
   *     その場かぎりの番号。氏名にもメールアドレスにも結びつかない。
   */
  T_CLICK: {
    sheet: 'TB_画面の操作',
    key: null,
    columns: [
      { key: 'at',      label: '日時',   type: 'datetime' },
      { key: 'visit',   label: '来訪',   type: 'text',
        note: '★その場かぎりの番号。個人には結びつかない' },
      { key: 'page',    label: '画面',   type: 'text' },
      { key: 'what',    label: '操作',   type: 'text' },
      { key: 'detail',  label: '対象',   type: 'text' },
      { key: 'who_id',  label: '本人',   type: 'text',
        note: 'ログインしている場合のみ入る' }
    ]
  },

  /**
   * TA  ログインしている状態
   *
   * 画面は token だけを手元に持ち、呼び出しのたびに添える。
   * サーバーはこの表と照合して、誰かを決める。
   *
   * ★token は推測できない長さにする（Utilities.getUuid）。
   *   有効期限を過ぎたものは通さない。
   */
  T_SESSION: {
    sheet: 'TA_ログイン状態',
    key: 'token',
    columns: [
      { key: 'token',    label: '合言葉',   type: 'text' },
      { key: 'kind',     label: '種別',     type: 'select', options: ['staff', 'user'] },
      { key: 'who_id',   label: '本人',     type: 'text' },
      { key: 'email',    label: 'メールアドレス', type: 'text' },
      { key: 'until',    label: '有効期限', type: 'datetime' },
      { key: 'last_at',  label: '最終利用', type: 'datetime' }
    ]
  }
};


/**
 * 選択肢の定義
 *
 * 本部への報告で使われている区分に合わせてある。
 * ここを変えると集計の意味が変わるため、変更は慎重に行う。
 */
var OPTIONS = {

  // 本部集約データの区分に一致させる
  ORG_TYPE: ['東大・農', '東大・他', '国立大', '他教育機関', '研究機関', '公的機関', 'その他'],

  // 身分
  //   本部の集計では「学生」という区分だが、これだと院生・高校生と重なって見える。
  //   画面では「大学生」と表示し、本部へ出すときに「学生」へ戻す。
  //   ★区分そのものは変えない。年報の集計の意味が変わるため。
  STATUS_TYPE: ['教職員', '院生', '大学生', '高校生', '中学生', '小学生', '就学前', 'その他'],

  // 画面の表示 → 本部へ出すときの表記
  STATUS_TYPE_EXPORT: {
    '教職員': '教職員', '院生': '院生', '大学生': '学生',
    '高校生': '高校生', '中学生': '中学生', '小学生': '小学生',
    '就学前': '就学前', 'その他': 'その他'
  },

  GENDER: ['男', '女', '回答しない'],

  USE_CATEGORY: ['研究', '教育', '社会貢献', '管理運営', 'その他'],

  ROLE: ['施設担当者', '施設管理者', '本部担当者', 'システム管理者'],

  FACILITY_KIND: ['宿泊', '食事', '実験室', '車両', '集会所', 'その他'],

  VIEW_TYPE: ['日付軸', '人物軸'],

  FORM_STAGE: ['事前', '利用の都度', '利用後'],

  PARTICIPANT_ROLE: ['代表者', '参加者', '引率者'],

  REG_STATUS: ['未招待', '招待済', '登録済', '辞退'],

  PLAN_ACTUAL: ['予定', '実績'],

  DOC_PHASE: ['利用前', '利用中', '利用後'],

  MSG_KIND: ['利用者とのやり取り', '所内メモ', '確認事項', 'システム通知'],

  // ---------------- 以下は2026-08-19の7施設調査を受けて追加したもの

  // 書類の種類　施設ごとに名称が違うため、比べられるように分類しておく
  DOC_TYPE: [
    '計画書',        // 研究計画書・教育計画書・研究教育計画書
    '申込書',        // 利用申込書
    '名簿',          // 利用者名簿・見学者名簿
    '宿泊申込',      // 宿泊申込書・宿泊利用申込書
    '緊急連絡先',    // 緊急連絡先名簿
    'データ利用',    // データ利用申請書・データ等使用願
    '標本・試料',
    '無人航空機',
    '野生動物',
    '化学物質',
    '保険',          // 生態水文のみ　保険加入を証明する資料
    '届出',          // 千葉の利用時届出書
    '報告',          // 利用後の報告・チェックシート
    '成果',          // 別刷・要旨・投稿の通知
    '参考資料',
    'その他'
  ],

  // 締切の起算点　3種類が混在する
  DEADLINE_BASE: [
    '利用開始日',        // ◯日前
    '年度の初回利用日',  // 年度計画の締切
    '成果の公表日',      // 別刷の提出
    '利用終了日',        // 利用後の報告
    '当日',
    '記載なし'
  ],

  // 締切の方式
  DEADLINE_TYPE: [
    '前月◯日まで',   // 北海道20・千葉20・生態水文20・樹芸20・田無15
    '◯日前まで',     // 秩父20/10/5・富士14/7・北海道10・生態水文10・樹芸10
    '◯日以内',       // 生態水文　利用後7日以内
    '期間内',         // 3か月前から10日前まで
    '記載なし'
  ],

  // 宿泊の申込方法
  LODGING_STYLE: [
    '別の様式',       // 富士（宿泊申込書）
    '名簿と一体',     // 北海道（様式C）
    '申込書一式に内包', // 秩父
    '事前に問い合わせ', // 生態水文・樹芸
    '様式なし',       // 千葉・田無
    '記載なし'
  ],

  // 利用後の報告　★施設によって性質がまったく違う
  POST_USE: [
    '利用ごとに提出',   // 生態水文　利用後7日以内のチェックシート
    '課題ごとに継続',   // 北海道　利用後2年間、毎年1〜2月
    '成果の公表時のみ', // 別刷・要旨
    '記載なし'
  ]
};


/**
 * 年報の集計で使う身分の束ね方
 *
 * 本部の年報は4区分（教職員・学生・院生・その他）である。
 * 8区分をこの4つに落とす対応をここに置く。
 */
var NENPO_GROUP = {
  '教職員': '教職員',
  '院生': '院生',
  '大学生': '学生',      // 画面では「大学生」、年報では「学生」
  '学生': '学生',        // 過去のデータに残っている表記
  '高校生': 'その他',
  '中学生': 'その他',
  '小学生': 'その他',
  '就学前': 'その他',
  'その他': 'その他'
};


/** 表の定義から、スプレッドシートのヘッダー行を作る */
function headerOf(tableName) {
  var t = SCHEMA[tableName];
  if (!t) throw new Error('未定義の表　' + tableName);
  return t.columns.map(function (c) { return c.label; });
}

/** 日本語のヘッダーから、英語のキーへの対応表を作る */
function keyMapOf(tableName) {
  var m = {};
  SCHEMA[tableName].columns.forEach(function (c) { m[c.label] = c.key; });
  return m;
}

/** 参照している表を返す。表を消すときの影響範囲を調べるのに使う */
function referencesTo(tableName) {
  var hits = [];
  Object.keys(SCHEMA).forEach(function (name) {
    SCHEMA[name].columns.forEach(function (c) {
      if (c.ref === tableName) hits.push(name + '.' + c.key);
    });
  });
  return hits;
}

// GAS ではグローバルに置かれる。Node では module.exports から読む。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SCHEMA: SCHEMA, OPTIONS: OPTIONS, NENPO_GROUP: NENPO_GROUP,
                     headerOf: headerOf, keyMapOf: keyMapOf, referencesTo: referencesTo };
}
