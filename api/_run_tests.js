/**
 * _run_tests.js  試験を走らせる
 *
 * ■ なぜもう1つ作ったか
 *   _test_runner.js は vm を使っているが、
 *   この環境（Windows / Node 22）では途中で落ちる。
 *   同じことを、vm を使わずに行う。
 *
 * ■ 使い方
 *   node _run_tests.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;

// 読み込む順（依存の順）
const FILES = [
  'schema.js',
  'adapter_memory.js',
  'conditions.js',
  'deadline.js',
  'forms_seed.js',
  'export.js',
  'upload.js',
  'auth.js',
  'api.js',
];

const loaded = [];
for (const f of FILES) {
  const p = path.join(HERE, f);
  if (!fs.existsSync(p)) { console.log('（無し）', f); continue; }
  try {
    (0, eval)(fs.readFileSync(p, 'utf8'));
    loaded.push(f);
  } catch (e) {
    console.log('★読み込めない', f, e.message);
  }
}
console.log('読み込み', loaded.length, 'ファイル');

// ---- スプレッドシート側と同じものを、メモリ上に用意する
const FORESTS = [
  ['HKD', '北海道演習林'], ['CHB', '千葉演習林'], ['CCB', '秩父演習林'],
  ['TNS', '田無演習林'], ['ERI', '生態水文学研究所'],
  ['FJI', '富士癒しの森研究所'], ['JUG', '樹芸研究所'], ['HQ', '本部'],
];

function __seedMasters() {
  const A = global.MemoryAdapter;
  FORESTS.forEach(function (f, i) {
    A.insert('M_FOREST', {
      forest_id: f[0], name: f[1], short_name: f[1], default_view: '日付軸',
      has_annual_plan: (f[0] !== 'TNS'),
      issues_permit: ['CHB', 'TNS', 'ERI', 'FJI'].indexOf(f[0]) >= 0,
      lodging_style: '別様式', post_use_report: 'なし', active: true,
    });
    ['受付', '審査中', '許可済', '完了'].forEach(function (c, j) {
      A.insert('M_STATUS', {
        forest_id: f[0], seq: j + 1, code: c, label: c,
        next_codes: [], is_open: (c !== '完了'), color: '#4A7A4A',
      });
    });
  });
  A.insert('M_FACILITY', { facility_id: 'F001', forest_id: 'HKD', kind: '宿泊',
    name: '山部宿泊施設', capacity: 40, has_meal: false, active: true });
  A.insert('M_FACILITY', { facility_id: 'F999', forest_id: 'HKD', kind: '宿泊',
    name: '定員未設定の施設', capacity: '', has_meal: false, active: true });
  A.insert('M_FACILITY', { facility_id: 'CCB-KAWAMATA', forest_id: 'CCB', kind: '宿泊',
    name: '川俣宿泊施設（賄い施設）', capacity: 28, has_meal: true, active: true });

  (global.FORMS_SEED || []).forEach(function (f) { A.insert('M_FORM', f); });

  A.insert('M_STAFF', { staff_id: 'S001', login_id: 's001@example.ac.jp',
    email: 's001@example.ac.jp', name: '試験用 職員',
    forest_id: 'HKD', role: '施設担当者', active: true });
  A.insert('M_STAFF', { staff_id: 'S002', login_id: 's002@example.ac.jp',
    email: 's002@example.ac.jp', name: '試験用 職員2',
    forest_id: 'HKD', role: '施設担当者', active: true });
}
global.__seedMasters = __seedMasters;

console.log('マスタ　演習林' + FORESTS.length + ' / ステータス' + (FORESTS.length * 4) +
            ' / 施設3 / 様式' + ((global.FORMS_SEED || []).length) + ' / 職員2');
console.log('');

const t = require('./_tests_enshurin_api.js');
t.main();
