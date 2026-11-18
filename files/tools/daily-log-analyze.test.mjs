// daily-log-kit v1.10.0 — 実行: node --test tools/daily-log-analyze.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessions, median, extractSections, pendingItems, resolvedItems, parseResolution, matchesPending,
  weekStart, issueTitle, issueBody, weeklyIssueEnabled, ISSUE_TITLE_PREFIX, parseFeel, feelSummary, blockerSummary, isFixCommit, hourBuckets, weekdayCounts,
  lateNightRatio, weeklySeries, detectFindings, renderReport, parseAnalyzeArgs, ANALYSIS_DEFAULTS, daysBetween, formatDuration,
  isKitCommit, isLogOnlyItem, detectRepetition,
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
  assert.deepEqual(s, { decisions: ['パターンB'], changes: [], next: ['（PC）テスト'], pending: ['ボスの名前'], blockers: [], feel: [] });
});

test('判断待ちの解決: 「解決: <項目>」を読む（矢印の後ろは決めた内容）', () => {
  assert.deepEqual(parseResolution('解決: ボスの名前 → ヴォルクに決定'), { item: 'ボスの名前', outcome: 'ヴォルクに決定' });
  assert.deepEqual(parseResolution('解決：消費MPの値'), { item: '消費MPの値', outcome: '' });
  assert.equal(parseResolution('ボスの名前を解決した'), null);
  assert.equal(parseResolution('解決:'), null);
});

test('判断待ちの解決: 同じ文か、一方がもう一方を含む（短い方が4文字以上）ときだけ同じとみなす', () => {
  assert.ok(matchesPending('ボスの名前（ヴォルクは仮）', 'ボスの名前（ヴォルクは仮）'));
  assert.ok(matchesPending('ボスの名前（ヴォルクは仮）', 'ボスの名前'));
  assert.ok(matchesPending('奥の手の正式名', '奥の手の正式名（S-13）、ダメージの決め方'));
  assert.ok(!matchesPending('ボスの名前', 'ボス'));
  assert.ok(!matchesPending('ボスの名前', '敵の名前'));
});

test('判断待ちの解決: 解決した項目は一覧から外れ、解決の後にまた書かれたら戻る', () => {
  const memo = (day, time, pending, decisions = []) => ({ day, meta: { time }, sections: { pending, decisions } });
  const memos = [
    memo('2026-11-08', '21:00', ['ボスの名前（ヴォルクは仮）', '消費MPの値']),
    memo('2026-11-10', '21:00', ['ボスの名前（ヴォルクは仮）', '消費MPの値'], ['解決: ボスの名前 → ヴォルクに決定']),
    memo('2026-11-11', '09:00', [], ['解決: 消費MPの値 → 20']),
    memo('2026-11-12', '21:00', ['消費MPの値（もう一度検討）', '新しい件']),
  ];
  const p = pendingItems(memos, '2026-11-13', 7);
  assert.deepEqual(p.map((x) => x.text).sort(), ['新しい件', '消費MPの値（もう一度検討）'].sort());
  const r = resolvedItems(memos, '2026-11-13', 7);
  assert.deepEqual(r.map((x) => [x.text, x.resolvedDay, x.outcome, x.waitedDays]), [
    ['ボスの名前（ヴォルクは仮）', '2026-11-10', 'ヴォルクに決定', 2],
    ['消費MPの値', '2026-11-11', '20', 3],
  ]);
  // 同じメモで判断待ちにも書き、「解決:」も書いたら解決を優先する
  assert.deepEqual(pendingItems([memo('2026-11-12', '10:00', ['A案かB案か'], ['解決: A案かB案か → A案'])], '2026-11-13', 7), []);
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

test('週1回の Issue: 件名は週の月曜日で決まり、同じ週なら同じ件名', () => {
  assert.equal(weekStart('2026-11-16'), '2026-11-16'); // 月曜
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // 日曜
  assert.equal(weekStart('2026-11-14'), '2026-11-09'); // 土曜
  assert.equal(issueTitle('2026-11-18'), issueTitle('2026-11-16'));
  assert.ok(issueTitle('2026-11-18').startsWith(ISSUE_TITLE_PREFIX));
  assert.equal(issueTitle('2026-11-18'), '日報の分析（2026-11-16 の週）');
});

test('週1回の Issue: 本文に読み方と止め方を書き、長すぎれば切る', () => {
  const b = issueBody('# 分析\n本文\n', { today: '2026-11-16' });
  assert.match(b, /成果や生産性の評価には使わない/);
  assert.match(b, /"weeklyIssue"/);
  assert.match(b, /# 分析\n本文/);
  const long = issueBody('あ'.repeat(70000), { today: '2026-11-16' });
  assert.ok(long.length < 65536);
  assert.match(long, /ここで切りました/);
});

test('週1回の Issue: config.json の weeklyIssue が true のときだけ有効', () => {
  assert.equal(weeklyIssueEnabled({}), false);
  assert.equal(weeklyIssueEnabled({ weeklyIssue: 'true' }), false);
  assert.equal(weeklyIssueEnabled({ weeklyIssue: true }), true);
});

test('手応えと詰まったこと: 任意の見出しを読む（見出しの補足のかっこは無視）', () => {
  const s = extractSections('## 詰まったこと\n- プラグイン管理の並び順が分からない\n## 手応え（1〜5。任意）\n- 4（だいたい進んだ）\n');
  assert.deepEqual(s.blockers, ['プラグイン管理の並び順が分からない']);
  assert.deepEqual(s.feel, ['4（だいたい進んだ）']);
});

test('手応え: 最初の箇条書きの先頭の 1〜5 だけを数える', () => {
  assert.equal(parseFeel(['4（だいたい進んだ）']), 4);
  assert.equal(parseFeel(['2/5 環境構築で止まった']), 2);
  assert.equal(parseFeel(['５']), 5);
  assert.equal(parseFeel(['6']), null);
  assert.equal(parseFeel(['3.5']), null);
  assert.equal(parseFeel(['まあまあ']), null);
  assert.equal(parseFeel([]), null);
});

test('手応えと詰まったこと: 平均・週ごと・繰り返しをまとめ、改善点に出す', () => {
  const memo = (day, feel, blockers = []) => ({ day, sections: { decisions: [], changes: [], next: [], pending: [], blockers, feel: feel ? [feel] : [] } });
  const memos = [
    memo('2026-11-02', '4'),
    memo('2026-11-09', '2', ['Unity のバージョンが合わず開けない']),
    memo('2026-11-11', '1', ['Unity のバージョンが合わない']),
    memo('2026-11-12', '3（少し進んだ）'),
    memo('2026-11-13', null, ['別の件']),
  ];
  const f = feelSummary(memos, '2026-11-14', 14);
  assert.deepEqual(f.recent, { count: 4, avg: 2.5, low: ['2026-11-09', '2026-11-11'] });
  assert.deepEqual(f.weekly, [{ week: '2026-11-02', avg: 4, count: 1 }, { week: '2026-11-09', avg: 2, count: 3 }]);
  const b = blockerSummary(memos, '2026-11-14', { recentDays: 14, windowDays: 60, minDays: 2, threshold: 0.5 });
  assert.equal(b.recent.length, 3);
  assert.equal(b.repeated.length, 1);
  assert.deepEqual(b.repeated[0].days, ['2026-11-09', '2026-11-11']);
  const base = {
    memoCoverage: null, commits: 0, lateNight: { ratio: 0, count: 0 }, prLeadTime: { count: 0, medianDays: null }, staleBranches: [], largeCommits: [],
    recent: { commits: 0, fixRatio: 0 }, pending: [], pcTasks: [], lastActiveDay: '2026-11-13', daysSinceActive: 1,
  };
  const ids = detectFindings({ ...base, feel: f, blockers: b }).map((x) => x.id);
  assert.deepEqual(ids, ['low-feel', 'repeated-blocker']);
  // 書かれていなければ何も出さない（既存のメモだけのリポジトリ）
  assert.deepEqual(detectFindings(base).map((x) => x.id), []);
});

test('日報の仕組み自身のコミットと、日報メモのファイルを指す行は、作業に数えない（仕様 4.3・12.1）', () => {
  assert.equal(isKitCommit({ subject: 'chore: 日報の仕組みを更新（daily-log-kit v1.10.0）' }), true);
  assert.equal(isKitCommit({ subject: 'docs(log): 日報メモ', files: ['docs/log/entries/2026-11-18/0643-3.md'] }), true);
  assert.equal(isKitCommit({ subject: 'Update notes', files: ['docs/log/config.json'] }), true);
  assert.equal(isKitCommit({ subject: 'feat: トークン数の表示', files: ['app.js', 'docs/log/entries/a.md'] }), false);
  assert.equal(isKitCommit({ subject: 'docs: README', files: ['CLAUDE.md'] }), false, 'CLAUDE.md だけの変更は作業');
  assert.equal(isLogOnlyItem('日報メモ docs/log/entries/2026-11-18/0643-3.md'), true);
  assert.equal(isLogOnlyItem('日報メモを追加'), true);
  assert.equal(isLogOnlyItem('tools/count.js にトークンの数え方を追加'), false);
  // 3日続けて日報メモだけを書いても「似た作業の繰り返し」にならない
  const memos = ['2026-11-16', '2026-11-17', '2026-11-18'].map((day) => ({
    day, meta: {}, sections: { changes: [`日報メモ docs/log/entries/${day}/0700-main.md`], next: [], decisions: [], pending: [], blockers: [], feel: [] },
  }));
  const rep = detectRepetition({ memos, commits: [], fixFiles: [], today: '2026-11-18', a: ANALYSIS_DEFAULTS });
  assert.deepEqual(rep.repeatedWork, []);
  assert.deepEqual(rep.prepRepeats, []);
});
