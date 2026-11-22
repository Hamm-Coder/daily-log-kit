// daily-log-kit v1.10.4 — 実行: node --test tools/daily-log-brief.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpecQueue, idsIn, summarizeRow, placeOf, prepFromRules, prepFromState, renderBrief } from './daily-log-brief.mjs';
import { similarity, clusterItems, detectRepetition, prepKeywordRepeats, simKey, ANALYSIS_DEFAULTS } from './daily-log-analyze.mjs';

const SPEC = `## 作業キュー

| ID | 作業 | 成果物 | 完了条件 | 実行場所 | 状態 |
| --- | --- | --- | --- | --- | --- |
| D4 | CF_LootTable | \`game/js/plugins/CF_LootTable.js\` | 抽選の単体テストが通る | Web | 未着手 |
| D8 | 価格0の売却不可を実機で確認 | なし | ショップで売れない | PC | 未着手 |

| 名前 | 説明 |
| --- | --- |
| D4 | これは作業キューではない |
`;

test('SPEC.md の作業キュー（最初の列が ID の表）だけを読む', () => {
  const q = parseSpecQueue(SPEC);
  assert.deepEqual([...q.keys()], ['D4', 'D8']);
  assert.equal(q.get('D8')['実行場所'], 'PC');
  assert.equal(summarizeRow(q.get('D4')), '作業: CF_LootTable / 成果物: game/js/plugins/CF_LootTable.js / 完了条件: 抽選の単体テストが通る / 実行場所: Web / 状態: 未着手');
});

test('次にやることから作業キューの番号を拾う（PR番号や英単語は拾わない）', () => {
  assert.deepEqual(idsIn('D4 CF_LootTable と S-02 の判断、PR #32'), ['D4', 'S-02']);
  assert.deepEqual(idsIn('CF_D4x（PC）'), []);
});

test('この環境でできるかの判定', () => {
  assert.equal(placeOf('（PC）PR #32 のテストプレイ'), 'pc');
  assert.equal(placeOf('D8 の確認', { ID: 'D8', 実行場所: 'PC' }), 'pc');
  assert.equal(placeOf('D4', { ID: 'D4', 実行場所: 'Web' }), 'web');
  assert.equal(placeOf('README を直す'), 'any');
});

test('準備のルールは次にやることに合うものだけ、手順は重複させない', () => {
  const rules = [
    { when: 'テストプレイ|（PC）', steps: ['git pull', 'RPG Maker MZ でプロジェクトを開く'] },
    { when: 'CF_', steps: ['git pull', 'プラグイン管理で ON にする'] },
    { when: '素材', steps: ['使わない'] },
    { when: '([', steps: ['壊れた正規表現は無視'] },
  ];
  const p = prepFromRules(['（PC）PR #32 のテストプレイ', 'D4 CF_LootTable'], rules);
  assert.deepEqual(p.map((x) => x.text), ['git pull', 'RPG Maker MZ でプロジェクトを開く', 'プラグイン管理で ON にする']);
});

test('リポジトリの状態からの準備', () => {
  const p = prepFromState({ behind: 3, dirty: 2, needsNpm: true, usesLfs: true, hasLfs: false, branch: 'feat/x', defaultBranch: 'main' }, 'pc');
  assert.equal(p.length, 5);
  assert.match(p[0].text, /3コミット遅れている.*git pull/);
  assert.deepEqual(prepFromState({ behind: 0, dirty: 0, needsNpm: false, usesLfs: false, hasLfs: true, branch: 'main', defaultBranch: 'main' }, 'web'), []);
});

test('似ている度合い: 番号や記号の違いは無視、別の作業は低い', () => {
  assert.equal(simKey('fix(ui): D14 煙玉の判定を修正 (#26)'), '煙玉の判定を修正');
  assert.ok(similarity('プラグイン管理への登録', 'プラグイン管理に登録する') >= 0.5);
  assert.ok(similarity('D4 CF_LootTable', 'D12 CF_Bounty') < 0.2);
  assert.ok(similarity('（PC）C3 の画像1体の取り込み', '（PC）C3 の画像を1体取り込む') >= 0.9); // 送り仮名と助詞の違い
  assert.ok(similarity('煙玉の判定を修正', '奥の手の発動条件を修正') < 0.5);
  assert.equal(similarity('D14: CF_EscapeItems', 'CF_EscapeItems をプラグイン管理に登録'), 0); // 実装と登録は別の作業
  assert.ok(similarity('Update README', 'Update README.md') >= 0.8);
});

test('似た項目をまとめ、日数を数える', () => {
  const c = clusterItems([
    { text: 'DB を CSV に同期', day: '2026-11-01' }, { text: 'DBをCSVに同期', day: '2026-11-03' },
    { text: 'DB を CSV に同期する', day: '2026-11-05' }, { text: '煙玉', day: '2026-11-05' },
  ]);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].days, ['2026-11-01', '2026-11-03', '2026-11-05']);
});

test('準備作業の言葉は対象が違っても数える（再起動は起動に数えない）', () => {
  const r = prepKeywordRepeats([
    { text: 'PCで CF_HeroineStatus を登録', day: '2026-11-10' },
    { text: 'CF_EscapeItems をプラグイン管理に登録', day: '2026-11-12' },
    { text: 'CF_LastResort を登録しエディタを再起動', day: '2026-11-13' },
    { text: 'エディタを再起動', day: '2026-11-13' },
  ], 3);
  assert.deepEqual(r.map((x) => [x.keyword, x.days.length]), [['登録', 3]]);
});

test('繰り返し・繰り越し・修正の集中を判別する', () => {
  const memo = (day, changes, next) => ({ day, sections: { decisions: [], changes, next, pending: [] } });
  const memos = [
    memo('2026-11-01', ['DB を CSV に同期'], ['（PC）C3 の画像1体の取り込み']),
    memo('2026-11-04', ['DB を CSV に同期'], ['（PC）C3 の画像1体の取り込み', 'D4']),
    memo('2026-11-08', ['DBをCSVに同期した'], ['（PC）C3 の画像1体の取り込み']),
    memo('2026-11-12', [], ['（PC）C3 の画像を1体取り込む']),
  ];
  const fixFiles = [1, 2, 3].map(() => ({ subject: 'fix: x', files: ['game/js/plugins/CF_HeroineStatus.js'] }));
  const r = detectRepetition({ memos, fixFiles, today: '2026-11-13', a: ANALYSIS_DEFAULTS, latestNext: memos.at(-1).sections.next });
  assert.equal(r.repeatedWork.length, 1);
  assert.equal(r.repeatedWork[0].days.length, 3);
  assert.equal(r.repeatedWork[0].prep, true); // 「同期」は準備作業
  assert.equal(r.carriedNext.length, 1);
  assert.equal(r.carriedNext[0].count, 4);
  assert.deepEqual(r.fixHotspots, [{ file: 'game/js/plugins/CF_HeroineStatus.js', fixes: 3 }]);
});

test('最新のメモから消えた「次にやること」は繰り越しにしない（終わったとみなす）', () => {
  const memo = (day, next) => ({ day, sections: { decisions: [], changes: [], next, pending: [] } });
  const memos = [memo('2026-11-01', ['D4']), memo('2026-11-04', ['D4']), memo('2026-11-08', ['D4']), memo('2026-11-12', ['D5'])];
  const r = detectRepetition({ memos, today: '2026-11-13', a: ANALYSIS_DEFAULTS, latestNext: ['D5'] });
  assert.deepEqual(r.carriedNext, []);
});

test('引き継ぎの文: Web版では PC の作業に印を付け、何もなければ空', () => {
  const b = {
    env: 'web', latest: { day: '2026-11-13', time: '09:30', title: 'ADR 0011 を採用', source: 'claude-code-web' },
    next: [
      { text: 'D4 CF_LootTable', place: 'web', spec: [{ id: 'D4', summary: '完了条件: 抽選の単体テストが通る' }] },
      { text: '（PC）PR #32 のテストプレイ', place: 'pc', spec: [] },
    ],
    pending: [{ text: 'ボスの名前', firstDay: '2026-11-08', count: 2 }],
    prep: [{ level: '必要', text: 'node_modules がない → npm ci' }],
    efficiency: ['準備作業の繰り返し: 「登録」を含む作業が3日'],
  };
  const s = renderBrief(b);
  assert.match(s, /^## 日報からの引き継ぎ（daily-log）/);
  assert.match(s, /- D4 CF_LootTable\n {2}- SPEC D4: 完了条件: 抽選の単体テストが通る/);
  assert.match(s, /（PC）PR #32 のテストプレイ ← この環境（Web版）ではできない/);
  assert.match(s, /（Web版で今できるのは 1件）/);
  assert.match(s, /- \[必要\] node_modules がない → npm ci/);
  assert.equal(renderBrief({ env: 'pc', latest: null, next: [], pending: [], prep: [], efficiency: [] }), '');
});

test('引き継ぎ: 前回のメモの「詰まったこと」を出す（なければ見出しも出さない）', () => {
  const base = { env: 'web', latest: { day: '2026-11-13', time: '21:00', title: 't' }, next: [], pending: [], prep: [], efficiency: [] };
  const out = renderBrief({ ...base, blockers: ['プラグイン管理の並び順が分からない'] });
  assert.match(out, /### 前回詰まったこと\n- プラグイン管理の並び順が分からない/);
  assert.equal(renderBrief({ ...base, blockers: [] }), '');
});
