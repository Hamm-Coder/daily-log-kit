// daily-log-kit v1.3.0 — 実行: node --test tools/daily-log-analyze.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessions, median, extractSections, pendingItems, isFixCommit, hourBuckets, weekdayCounts,
  lateNightRatio, weeklySeries, detectFindings, renderReport, parseAnalyzeArgs, ANALYSIS_DEFAULTS, daysBetween, formatDuration,
} from './daily-log-analyze.mjs';

const TZ = 'Asia/Tokyo';

test('コミットの間隔でセッションに分ける', () => {
  const s = buildSessions(['2026-11-01T10:00:00Z', '2026-11-01T11:30:00Z', '2026-11-01T15:00:00Z'], 120, 30);
  assert.equal(s.count, 2); // 10:00-11:30 と 15:00
  assert.equal(s.estimatedHours, 2.5); // 90分 + 30分×2
  assert.equal(buildSessions([]).count, 0);
});

test('中央値と日数', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(daysBetween('2026-10-31', '2026-11-13'), 13);
});

test('日報メモの4つの見出しを取り出す', () => {
  const s = extractSections('（日付は推定）\n## 決めたこと\n- パターンB\n- \n## 次にやること\n- （PC）テスト\n```\n## 決めたこと\n- コード内\n```\n## 未解決・判断待ち\n- ボスの名前\n');
  assert.deepEqual(s, { decisions: ['パターンB'], changes: [], next: ['（PC）テスト'], pending: ['ボスの名前'] });
});

test('判断待ち: 繰り越しを数え、古いメモだけの項目は外す', () => {
  const memos = [
    { day: '2026-11-01', sections: { pending: ['ボスの名前', '古い件'] } },
    { day: '2026-11-08', sections: { pending: ['ボスの名前。'] } },
    { day: '2026-11-12', sections: { pending: ['ボスの名前', '新しい件'] } },
  ];
  const p = pendingItems(memos, '2026-11-13', 7); // 11/06 以降のメモに出た項目だけ
  assert.deepEqual(p.map((x) => [x.text, x.firstDay, x.count, x.ageDays]), [['ボスの名前', '2026-11-01', 3, 12], ['新しい件', '2026-11-12', 1, 1]]);
});

test('修正コミットの判定', () => {
  assert.equal(isFixCommit('fix: 煙玉の判定'), true);
  assert.equal(isFixCommit('fix(log)!: x'), true);
  assert.equal(isFixCommit('Revert "D5"'), true);
  assert.equal(isFixCommit('D14: 煙玉の不具合を直す'), true);
  assert.equal(isFixCommit('feat: 煙玉'), false);
});

test('時間帯・曜日・深夜率（日本時間）', () => {
  const times = ['2026-11-01T15:30:00Z', '2026-11-01T01:00:00Z', '2026-11-01T10:00:00Z']; // JST 00:30, 10:00, 19:00
  assert.deepEqual(hourBuckets(times, TZ), [1, 0, 0, 1, 0, 0, 1, 0]);
  assert.equal(lateNightRatio(times, TZ), 1 / 3);
  assert.deepEqual(weekdayCounts(['2026-11-08', '2026-11-09', '2026-11-15']), [2, 1, 0, 0, 0, 0, 0]);
});

test('週ごとの推移は月曜始まりで直近の週が最後', () => {
  const m = new Map([['2026-11-09', { commits: 16, memos: 0 }], ['2026-11-13', { commits: 1, memos: 2 }], ['2026-11-08', { commits: 16, memos: 1 }]]);
  const w = weeklySeries(m, '2026-11-13', 2);
  assert.deepEqual(w, [{ week: '2026-11-02', commits: 16, memos: 1 }, { week: '2026-11-09', commits: 17, memos: 2 }]);
  // 作業のない古い週は省く
  assert.deepEqual(weeklySeries(new Map([['2026-11-13', { commits: 1, memos: 0 }]]), '2026-11-13', 12), [{ week: '2026-11-09', commits: 1, memos: 0 }]);
});

const base = () => ({
  commits: 40, memoCoverage: { since: '2026-11-04', commitDays: 4, withMemo: 4, ratio: 1 },
  lateNight: { ratio: 0.1, count: 4 }, prLeadTime: { count: 5, medianDays: 0.4 }, staleBranches: [], largeCommits: [],
  recent: { commits: 20, fixRatio: 0.1 }, pending: [], pcTasks: [], lastActiveDay: '2026-11-13', daysSinceActive: 0,
});

test('問題がなければ改善点は出ない', () => {
  assert.deepEqual(detectFindings(base()), []);
});

test('しきい値を超えた項目だけ改善点になる', () => {
  const m = {
    ...base(),
    memoCoverage: { since: '2026-11-04', commitDays: 5, withMemo: 2, ratio: 0.4 },
    lateNight: { ratio: 0.4, count: 16 },
    prLeadTime: { count: 4, medianDays: 5 },
    staleBranches: [{ name: 'origin/feat/x', ageDays: 30 }],
    largeCommits: [{ day: '2026-11-08', subject: '短編を取り込む', files: 60, lines: 5000 }],
    recent: { commits: 12, fixRatio: 0.5 },
    pending: [{ text: 'ボスの名前', firstDay: '2026-11-01', count: 3, ageDays: 12 }, { text: '一度だけ', firstDay: '2026-11-01', count: 1, ageDays: 12 }],
    pcTasks: [1, 2, 3, 4, 5].map((i) => ({ day: '2026-11-10', text: `（PC）テスト${i}` })),
    daysSinceActive: 20,
  };
  const ids = detectFindings(m, ANALYSIS_DEFAULTS).map((f) => f.id);
  assert.deepEqual(ids, ['memo-coverage', 'late-night', 'pr-lead-time', 'stale-branches', 'large-commits', 'fix-ratio', 'pending-carry', 'pc-tasks', 'inactive']);
  const carry = detectFindings(m).find((f) => f.id === 'pending-carry');
  assert.match(carry.evidence, /ボスの名前/);
  assert.doesNotMatch(carry.evidence, /一度だけ/);
});

test('件数が少ないときは割合の改善点を出さない', () => {
  const m = { ...base(), commits: 5, lateNight: { ratio: 1, count: 5 }, recent: { commits: 3, fixRatio: 1 }, memoCoverage: { since: 'x', commitDays: 2, withMemo: 0, ratio: 0 } };
  assert.deepEqual(detectFindings(m), []);
});

test('レポートは決定的で、複数リポジトリの概要表を持つ', () => {
  const metrics = {
    ...base(), period: { from: '2026-10-31', to: '2026-11-13', days: 14 }, activeDays: 9, commitDays: 6, memoOnlyDays: 3, prs: 25, memos: 9,
    sessions: { count: 12, estimatedHours: 30.5 }, latestNext: { day: '2026-11-13', items: ['（PC）C3 の取り込み'] },
    weekly: [{ week: '2026-11-09', commits: 3, memos: 2 }], weekdays: [1, 2, 0, 0, 0, 0, 1], hours: [5, 0, 0, 2, 0, 0, 10, 8],
    recentDecisions: [{ day: '2026-11-13', text: 'ADR 0011 を採用' }],
  };
  const r = [{ name: 'RPGMZ_prototype', metrics, findings: [] }, { name: 'Unity_CharacterTest', metrics, findings: [] }];
  const md = renderReport(r, { today: '2026-11-13' });
  assert.equal(md, renderReport(r, { today: '2026-11-13' }));
  assert.match(md, /## リポジトリ別の概要/);
  assert.match(md, /\| RPGMZ_prototype \| 2026-10-31〜2026-11-13 \| 9 \| 40 \| 25 \| 9 \| 100% \| 10% \| 0 \|/);
  assert.match(md, /### 次にやること（最新のメモ）\n\n2026-11-13 のメモより\n\n- （PC）C3 の取り込み/);
  assert.match(md, /- 2026-11-13 ADR 0011 を採用/);
});

test('引数: 真偽値のフラグの後ろのリポジトリを値として食べない', () => {
  assert.deepEqual(parseAnalyzeArgs(['--json', 'C:\\repo', '--since', '2026-11-01', 'D:\\b']), { _: ['C:\\repo', 'D:\\b'], json: true, since: '2026-11-01' });
});

test('期間の表示は短ければ時間で', () => {
  assert.equal(formatDuration(0.01), '1時間未満');
  assert.equal(formatDuration(0.5), '約12時間');
  assert.equal(formatDuration(3.25), '約3.3日');
  assert.equal(formatDuration(null), '—');
});
