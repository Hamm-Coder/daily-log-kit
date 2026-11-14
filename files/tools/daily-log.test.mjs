// daily-log-kit v1.7.0 — 実行: node --test tools/daily-log.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG, dayKey, displayTime, weekdayOf, addDays, parseGitLog, prInfo, filterCommits,
  groupByDay, parseEntry, demoteHeadings, stripEmptySections, renderDay, renderIndex, dayPath,
  slugify, userPromptFromTranscriptLine, mergeConfig,
} from './daily-log.mjs';

const cfg = DEFAULT_CONFIG;
const F = '\x1f', R = '\x1e';
const rec = (h, d, a, p, s, b = '') => [h, d, a, p, s, b].join(F) + R;

test('深夜4時前の作業は前日に数える（日本時間）', () => {
  assert.equal(dayKey('2026-11-01T15:13:00Z', cfg), '2026-11-01'); // JST 11/02 00:13
  assert.equal(dayKey('2026-11-01T18:59:00Z', cfg), '2026-11-01'); // JST 03:59
  assert.equal(dayKey('2026-11-01T19:00:00Z', cfg), '2026-11-02'); // JST 04:00
  assert.equal(dayKey('2026-11-01T19:47:00+09:00', cfg), '2026-11-01');
});

test('dayStartHour=0 なら暦日どおり', () => {
  assert.equal(dayKey('2026-11-01T15:13:00Z', mergeConfig({ dayStartHour: 0 })), '2026-11-02');
});

test('作業日をまたぐ時刻に「翌」を付ける', () => {
  assert.equal(displayTime('2026-11-01T15:13:00Z', '2026-11-01', cfg), '翌00:13');
  assert.equal(displayTime('2026-11-01T10:47:00Z', '2026-11-01', cfg), '19:47');
});

test('曜日と日付の加算', () => {
  assert.equal(weekdayOf('2026-11-10'), '火');
  assert.equal(addDays('2026-11-01', -2), '2026-10-30');
  assert.equal(dayPath('2026-11-09'), '2026-11/2026-11-09.md');
});

test('git log の解析とPRの判別', () => {
  const raw = rec('a'.repeat(40), '2026-11-08T22:00:00+09:00', 'me', 'p1 p2', 'Merge pull request #19 from Hamm-Coder/b1', 'B1: ゲーム設計の下書き\n\n詳細')
    + '\n' + rec('b'.repeat(40), '2026-11-08T21:59:00+09:00', 'me', 'p0', 'D2: 検査ツール (#20)')
    + '\n' + rec('c'.repeat(40), '2026-11-08T21:00:00+09:00', 'me', 'p0', 'fix typo');
  const cs = parseGitLog(raw);
  assert.equal(cs.length, 3);
  assert.deepEqual(cs[0].parents, ['p1', 'p2']);
  assert.deepEqual(prInfo(cs[0]), { number: 19, title: 'B1: ゲーム設計の下書き', kind: 'merge' });
  assert.deepEqual(prInfo(cs[1]), { number: 20, title: 'D2: 検査ツール', kind: 'squash' });
  assert.equal(prInfo(cs[2]), null);
});

test('ボットと日報更新のコミットを除外する', () => {
  const cs = [
    { author: 'github-actions[bot]', subject: 'x' },
    { author: 'me', subject: 'docs(log): 日報を更新 [skip ci]' },
    { author: 'me', subject: 'docs(log): 日報メモ' },
  ];
  assert.deepEqual(filterCommits(cs, cfg).map((c) => c.subject), ['docs(log): 日報メモ']);
});

test('日ごとにまとめ、時刻順に並べる', () => {
  const m = groupByDay([
    { date: '2026-11-01T17:00:00Z' }, { date: '2026-11-01T11:00:00Z' }, { date: '2026-11-02T01:00:00Z' },
  ], cfg);
  assert.deepEqual([...m.keys()], ['2026-11-01', '2026-11-02']);
  assert.equal(m.get('2026-11-01')[0].date, '2026-11-01T11:00:00Z');
  const same = groupByDay([{ date: '2026-11-03T03:00:00Z', subject: '子' }, { date: '2026-11-03T03:00:00Z', subject: '親' }], cfg);
  assert.deepEqual(same.get('2026-11-03').map((c) => c.subject), ['親', '子']);
});

test('日報メモの frontmatter と空の見出し', () => {
  const { meta, body } = parseEntry('---\ndate: 2026-11-09\ntime: "02:27"\nsource: chat\n---\n## 決めたこと\n- 奥の手を確定\n\n## 次にやること\n- \n');
  assert.equal(meta.time, '02:27');
  assert.equal(meta.source, 'chat');
  assert.equal(stripEmptySections(body), '## 決めたこと\n- 奥の手を確定');
  assert.equal(stripEmptySections('<!-- 説明 -->\n## A\n-\n## B\n- x'), '## B\n- x');
  assert.equal(demoteHeadings('## A\n```\n## code\n```'), '#### A\n```\n## code\n```');
});

test('日報の出力は決定的で、マージはPR欄に出る', () => {
  const commits = parseGitLog(
    rec('a'.repeat(40), '2026-11-08T12:59:00Z', 'me', 'p0', 'C3: ai-asset')
    + rec('b'.repeat(40), '2026-11-08T13:21:00Z', 'me', 'p1 p2', 'Merge pull request #21 from x/y', '短編を取り込む'),
  );
  const entries = [{ file: '2138-chat.md', meta: { time: '21:38', title: '世界設定', source: 'chat' }, body: '## 決めたこと\n- パターンB' }];
  const md = renderDay('2026-11-08', commits, entries, cfg);
  assert.equal(md, renderDay('2026-11-08', commits, entries, cfg));
  assert.match(md, /^# 2026-11-08（日）/);
  assert.match(md, /\| 時間帯 \| 21:59〜22:21 \|/);
  assert.match(md, /### 21:38 世界設定（chat）\n\n#### 決めたこと\n- パターンB/);
  assert.match(md, /- #21 短編を取り込む（22:21）/);
  assert.doesNotMatch(md, /Merge pull request/);
  assert.match(renderIndex([{ day: '2026-11-08', commits: 2, prs: 1, entries: 1 }], cfg), /\[2026-11-08（日）\]\(2026-11\/2026-11-08\.md\) \| 2 \| 1 \| 1/);
});

test('コミットのない日（チャットのみ）も出せる', () => {
  const md = renderDay('2026-11-04', [], [{ file: 'a.md', meta: {}, body: '- 世界設定 v0.1' }], cfg);
  assert.match(md, /\| コミット \| 0件 \|/);
  assert.doesNotMatch(md, /時間帯/);
});

test('ファイル名用の文字列', () => {
  assert.equal(slugify('feat/Heroine Status'), 'feat-heroine-status');
  assert.equal(slugify('日本語のみ'), 'note');
});

test('会話記録の1行からユーザーの依頼だけを取り出す', () => {
  const ok = userPromptFromTranscriptLine(JSON.stringify({ type: 'user', timestamp: '2026-11-09T00:00:00Z', cwd: '/r', sessionId: 's', message: { role: 'user', content: 'D5を実装して' } }));
  assert.equal(ok.text, 'D5を実装して');
  const arr = userPromptFromTranscriptLine(JSON.stringify({ type: 'user', timestamp: 't', message: { content: [{ type: 'tool_result', content: 'x' }] } }));
  assert.equal(arr, null);
  assert.equal(userPromptFromTranscriptLine('{壊れた行'), null);
  assert.equal(userPromptFromTranscriptLine(JSON.stringify({ type: 'assistant', timestamp: 't', message: { content: 'x' } })), null);
});
