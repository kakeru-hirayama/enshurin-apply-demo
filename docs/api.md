# API仕様

演習林 利用申込システム
2026年8月19日　v0.1

---

## 0　この文書について

**この文書が、引き継ぎの本体です。**

次にこのシステムを触る方が知る必要があるのは、
ここに書かれた関数の名前と、その入力と出力の形だけです。

```
知る必要があること
　・この形で呼ぶと、この形で返る

知る必要がないこと
　・データがスプレッドシートにあるか、データベースにあるか
　・どの列が何番目に並んでいるか
　・どのファイルにどう保存されているか
```

新しい画面やアプリを作るときは、この一覧の関数を呼んでください。
データの保存先を変えるときは、この一覧の入出力さえ守れば、
既存の画面は1行も変えずに済みます。

---

## 1　全体の構造

```
　　利用者の画面        職員の画面        将来のアプリ
　　　　　│                │                 │
　　　　└────────┴────────┘
　　　　　　　　　　　　│
　　　　　　　　　【 API層 】  ← この文書が対象とする範囲
　　　　　　　　　　　　│
　　　　　　　　　【 アダプタ 】
　　　　　　　　　　　　│
　　　　　　　┌──────┴──────┐
　　　　スプレッドシート　　　Google ドライブ
```

**アダプタを差し替えると、保存先が変わります。**

| アダプタ | 使う場面 | データの置き場所 |
|---|---|---|
| MemoryAdapter | 開発・画面の確認 | ブラウザのメモリ |
| SheetsAdapter | 本番 | Google スプレッドシート |

切り替えは api.js の1行だけです。

```javascript
var db = MemoryAdapter;      // ← ここを SheetsAdapter に変える
```

---

## 2　関数の一覧

| 分類 | 関数 | 何をするか |
|---|---|---|
| 申込 | getApplications(q) | 申込を絞り込んで返す |
| | getApplication(appId) | 申込1件を、関連するもの全部つきで返す |
| | saveApplication(data) | 申込を保存する。新規なら採番する |
| | updateStatus(appId, to, staffId, note) | ステータスを変える。記録が残る |
| 日付と施設 | getCalendar(q) | 日付ごとの利用状況を返す |
| | getFacilityAvailability(facilityId, from, to) | 施設の空きを調べる |
| 利用者 | inviteParticipants(appId, list) | 参加者を招待する |
| | saveMyProfile(userId, data) | 本人が自分の情報を登録する |
| | getParticipants(appId, viewerRole) | 参加者を、権限に応じた見え方で返す |
| | openEmergencyContact(userId, staffId, reason) | 緊急連絡先を開く。記録が残る |
| 資料 | attachFile(appId, doc) | 資料を紐づける |
| | addMessage(appId, msg) | やり取りを記録する |
| | getMissingForms(appId) | 未提出の様式を返す |
| 出力 | exportMonthly(forestId, yyyymm) | 本部へ渡す月次データを作る |
| | exportNenpo(forestId, year) | 年報の表を作る |
| その他 | getMasters(forestId) | マスタをまとめて返す |
| | getAudit(q) | 操作の記録を返す |
| | useAdapter(adapter) | 保存先を差し替える |

---

## 3　各関数の詳細

### 3.1　getApplications(q)

申込を絞り込んで返します。一覧画面で使います。

**入力**

```javascript
{
  forest_id:   'HKD',        // 省略可　演習林で絞る
  status:      '審査中',      // 省略可　ステータスで絞る
  from:        '2025-04-01',  // 省略可　この日以降に利用があるもの
  to:          '2026-03-31',  // 省略可　この日以前に利用があるもの
  rep_user_id: 'U0001',       // 省略可　代表者で絞る
  keyword:     '土壌'          // 省略可　目的・所属・代表者名を対象に部分一致
}
```

**出力**　申込の配列。開始日の新しい順。

```javascript
[
  {
    app_id:       '2025-HKD-0001',
    forest_id:    'HKD',
    rep_user_id:  'U0042',
    rep_org:      '東京大学大学院農学生命科学研究科',
    org_type:     '東大・農',
    purpose:      '林分施業法による木材生産が…',
    category:     '研究',
    place:        '演習林内',
    date_from:    '2025-04-01',
    date_to:      '2025-11-30',
    status:       '完了',
    applied_at:   '2025-04-01',
    approved_at:  '2025-04-01',

    // ↓ ここから下は、参照先から補って付けたもの
    rep_name:     '青木 涼太',
    status_label: '完了',
    status_color: '#4A7A4A',
    status_open:  false
  },
  ...
]
```

★ `rep_name` `status_label` `status_color` は、画面が別途マスタを引かなくて済むよう
API側で付けています。データとしては持っていません。

---

### 3.2　getApplication(appId)

申込1件を、関連するものを全部つけて返します。
**詳細画面がこれ1回の呼び出しで描けます。**

**入力**　`'2025-HKD-0001'`

**出力**　3.1 の内容に加えて、

```javascript
{
  ...(3.1と同じ項目),

  days:          ['2025-04-01', '2025-04-02', ...],   // 利用日
  participants:  [ { user_id, name, org, role, reg_status }, ... ],
  headcounts:    [ { date, org_type, status_type, gender, count }, ... ],
  lodgings:      [ { date, facility_id, room, count }, ... ],
  documents:     [ { doc_id, phase, kind, file_name, submitted_at }, ... ],
  messages:      [ { msg_id, at, kind, from, to, body }, ... ],

  // 集計値
  total_people:   12,    // 延べ人数
  n_days:          8,    // 利用日数
  n_unregistered:  2     // 個人情報が未登録の参加者の数
}
```

見つからない場合は `null` を返します。

---

### 3.3　saveApplication(data)

申込を保存します。

**入力**　`app_id` があれば更新、なければ新規。

```javascript
{
  app_id:     '',              // 空なら新規
  forest_id:  'HKD',           // 必須
  rep_user_id:'U0001',         // 必須
  rep_org:    '東京大学…',
  purpose:    '土壌断面の調査',
  category:   '研究',
  date_from:  '2026-09-01',    // 必須
  date_to:    '2026-09-05'     // 必須
}
```

**出力**　`app_id`（文字列）

**このとき自動で行われること**

```
・新規のとき　申込IDを採番する　2026-HKD-0001 の形
・新規のとき　その演習林の最初のステータスを入れる
・期間から利用日（T2）を1日ずつ作る
　　→ 期間を変えて保存し直すと、利用日も作り直される
```

---

### 3.4　updateStatus(appId, newStatus, staffId, note)

ステータスを変えます。

**入力**

| 引数 | 例 | 説明 |
|---|---|---|
| appId | '2025-HKD-0001' | |
| newStatus | '許可済' | M5に定義されたコード |
| staffId | 'S001' | 誰が変えたか |
| note | '書類を確認した' | 省略可。所内メモとして残る |

**出力**

```javascript
{ ok: true, from: '審査中', to: '許可済' }
{ ok: false, error: '申込が見つかりません' }
```

**このとき自動で行われること**

```
・操作ログ（T8）に記録が残る
・「許可済」にしたとき、許可日が空なら今日の日付を入れる
・note があれば、やり取り（T7）に所内メモとして残る
```

---

### 3.5　getCalendar(q)

日付ごとの利用状況を返します。

**入力**

```javascript
{ forest_id: 'HKD', from: '2026-09-01', to: '2026-09-30' }
```

**出力**　日付の昇順

```javascript
[
  {
    date:         '2026-09-01',
    applications: [ (3.1と同じ形の申込), ... ],
    n_apps:       3,      // その日の利用件数
    n_lodging:    12      // その日の宿泊人数
  },
  ...
]
```

★利用のない日は含まれません。カレンダーの枠は画面側で作ってください。

---

### 3.6　getFacilityAvailability(facilityId, from, to)

施設の空き状況を調べます。

**出力**　期間内の全日付を含みます（利用のない日も）。

```javascript
[
  { date:'2026-09-01', used:12, capacity:40, remaining:28, is_full:false },
  { date:'2026-09-02', used:40, capacity:40, remaining:0,  is_full:true  },
  ...
]
```

★ `capacity` が未設定の施設では `capacity` `remaining` が `null`、
`is_full` は常に `false` になります。

---

### 3.7　inviteParticipants(appId, list)

参加者を招待します。

**★この関数がこのシステムの中核です。**
利用代表者が入力するのは氏名とメールアドレスだけで、
それ以外の個人情報は本人が直接入れます。

**入力**

```javascript
[
  { name:'山田 太郎', email:'yamada@example.ac.jp', role:'参加者' },
  { name:'佐藤 花子', email:'sato@example.ac.jp' }
]
```

**出力**

```javascript
{ invited: 1, existing: 1 }   // 新規に登録した数と、すでに登録済みだった数
```

**動き**

```
メールアドレスで利用者マスタを探す

　見つかった   　その人を参加者に追加する。登録状況は「登録済」
　　　　　　　　→ 2回目以降の利用では、本人は何もしなくてよい

　見つからない  利用者マスタに氏名とアドレスだけの行を作る
　　　　　　　　登録状況は「招待済」
　　　　　　　　→ 本人が saveMyProfile を呼ぶまで未登録のまま
```

---

### 3.8　saveMyProfile(userId, data)

参加者本人が、自分の情報を登録・更新します。

**入力**　更新したい項目だけを渡します。

```javascript
{
  name:'', name_kana:'', org:'', org_type:'', status_type:'',
  gender:'', birth_date:'', nationality:'', allergy:'', emergency:''
}
```

★上記以外のキーは無視されます。
`user_id` や登録状況を、本人が書き換えることはできません。

**このとき自動で行われること**

```
・その人の参加登録が「招待済」だったものを、すべて「登録済」にする
　　→ 1回登録すれば、招待されている全ての申込がまとめて満たされる
```

---

### 3.9　getParticipants(appId, viewerRole)

参加者の一覧を返します。
**★誰が呼ぶかによって、返る内容が変わります。**

**入力**

| viewerRole | 返る内容 |
|---|---|
| `'代表者'` `'参加者'` | 氏名・役割・登録状況のみ |
| `'施設担当者'` 他 | ＋所属・身分・性別・年齢・アレルギー・国籍 |

**出力**

```javascript
// 代表者から見た場合
{ user_id:'U0025', name:'三宅 大和', role:'代表者', reg_status:'登録済' }

// 職員から見た場合
{ user_id:'U0025', name:'三宅 大和', role:'代表者', reg_status:'登録済',
  org:'東京大学…', org_type:'東大・農', status_type:'教職員',
  gender:'男', age:41, allergy:'', nationality:'日本',
  has_emergency:true }
```

★年齢は生年月日から**その時点で計算**します。生年月日そのものは返しません。
★緊急連絡先は、職員に対しても `has_emergency`（有無）しか返しません。
　実際の値は 3.10 でのみ取得できます。

---

### 3.10　openEmergencyContact(userId, staffId, reason)

緊急連絡先を開きます。

**出力**

```javascript
{ user_id:'U0025', name:'三宅 大和', emergency:'090-0000-1024' }
```

**★呼ぶと必ず操作ログに残ります。**
記録が残る仕組みがあるからこそ、通常は伏せておくことができます。

---

### 3.11　attachFile(appId, doc) / addMessage(appId, msg)

資料とやり取りを、申込に紐づけます。

```javascript
attachFile('2025-HKD-0001', {
  phase:'利用後', kind:'報告書', form_code:'',
  file_name:'利用報告書.pdf', file_id:'drive:xxxxx',
  submitted_at:'2026-06-30', submitted_by:'青木 涼太'
});
// → 'D00123'（資料ID）

addMessage('2025-HKD-0001', {
  kind:'所内メモ', from:'S002', to:'所内',
  body:'林道の安全を確認した'
});
// → 'M00045'（ID）
```

★ファイルの実体は Google ドライブに置き、`file_id` だけを持ちます。
　スプレッドシートにファイルそのものは入れません。

---

### 3.12　getMissingForms(appId)

その申込で、まだ提出されていない様式を返します。

**出力**　M6（様式定義）の行の配列

```javascript
[
  { forest_id:'HKD', form_code:'C', name:'利用者名簿・宿泊申込',
    stage:'利用の都度', deadline:'利用希望日の10日前まで',
    condition:'来訪するとき', file_type:'Excel / PDF', each_time:true },
  ...
]
```

★演習林ごとに必要な様式が違いますが、
　画面側はその違いを知る必要がありません。M6を見て判断します。

---

### 3.13　exportMonthly(forestId, yyyymm)

本部へ渡す月次データを作ります。

**★現在のCSVと同じ「一日一行」の形で出します。**
受け取る側（本部）は、現在の処理を何も変えなくて済みます。

**出力**

```javascript
[
  { forest:'HKD', legacy_no:'2025-HKD-0001', date:'2026-05-01',
    date_from:'2026-04-01', date_to:'2026-05-18',
    rep_name:'…', rep_org:'…', org_type:'東大・農',
    purpose:'…', category:'研究', place:'各所',
    headcounts:[ {org_type, status_type, gender, count}, ... ],
    lodgings:[ {facility_id, room, count}, ... ] }
]
```

---

### 3.14　exportNenpo(forestId, year)

年報の表を作ります。

**★現在エクセルの数式で行われている集計を、この1関数が置き換えます。**

**入力**　`('HKD', 2025)` = 2025年度（2025年4月〜2026年3月）

**出力**　年報の掲載順（年度の月順、同月内は開始日順）

```javascript
[
  { no:1, month:4, days:12, rep_org:'東京大学農学生命科学研究科農学国際専攻',
    staff:0, student:0, grad:12, other:0, total:12,
    purpose:'Classification of the composition…',
    lodging:'山部宿泊施設' },
  ...
]
```

**列の対応**　年報の「12．利用状況」の表と一致します。

| 年報の列 | この関数の項目 |
|---|---|
| No | no |
| 月 | month |
| 日数 | days |
| 利用者所属 | rep_org |
| 教職員 / 学生 / 院生 / その他 | staff / student / grad / other |
| 計 | total |
| 利用目的 | purpose |
| 宿泊施設 | lodging |

---

### 3.15　getMasters(forestId) / getAudit(q)

```javascript
getMasters('HKD')
// → { forests:[...], facilities:[...], statuses:[...], forms:[...], options:{...} }

getAudit({ staff_id:'S001', target:'2025-HKD-0001', action:'緊急' })
// → [ { at, staff_id, action, target, detail, ip }, ... ]　新しい順
```

---

## 4　アダプタが持つべき関数

保存先を変えるときは、次の関数を同じ形で用意します。
API層はこれ以外を呼びません。

| 関数 | 説明 |
|---|---|
| readAll(table) | その表の全行を配列で返す |
| findByKey(table, key) | 主キーで1行返す。無ければ null |
| insert(table, row) | 1行足す |
| insertMany(table, rows) | まとめて足す |
| update(table, key, patch) | 主キーで探して書き換える |
| remove(table, key) | 主キーで探して消す |
| nextId(table, prefix) | 新しいIDを作る |

`table` には `'T_APPLICATION'` のような、schema.js で定義した表の名前を渡します。
複合キーの表では、`key` に配列を渡します（例 `['2025-HKD-0001', '2026-05-01']`）。

---

## 5　データの定義

表と項目の定義は `api/schema.js` にあります。
**表を足す、項目を足すときは、必ずそのファイルを直してください。**

日本語のヘッダー（人が読む用）と、英語のキー（コードで使う用）の対応も
そこで一度だけ定義しています。他の場所には書かないでください。

```javascript
headerOf('T_APPLICATION')     // → ['申込ID','演習林','利用代表者',...]
keyMapOf('T_APPLICATION')     // → {'申込ID':'app_id', '演習林':'forest_id',...}
referencesTo('M_USER')        // → ['M_USER.user_id を参照している場所の一覧']
```

`referencesTo` は、表を消したり項目名を変えたりする前に、
影響範囲を調べるために使います。

---

## 6　守っていただきたいこと

```
① 画面から、アダプタやスプレッドシートを直接触らない
　　必ずAPI層の関数を通してください。
　　直接触ると、保存先を変えたときに壊れます。

② API層に、画面の都合を持ち込まない
　　色や文言の判断は画面側で行ってください。
　　（status_color を返しているのは、マスタの値をそのまま渡しているためです）

③ 関数を足したら、この文書に追記する
　　この文書に載っていない関数は、次の人には存在しないのと同じです。
```

---

作成　平山翔湧
