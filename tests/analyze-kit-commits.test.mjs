// daily-log-kit v1.10.0 — 分析と引き継ぎが日報の仕組み自身のコミットを作業に数えないこと（仕様 4.3・12.1）。実際の Git リポジトリで確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeRepo, readKitHashes } from '../files/tools/daily-log-analyze.mjs';
import { buildBrief } from '../files/tools/daily-log-brief.mjs';

const at = (day) => `${day}T12:00:00+09:00`;
function g(cwd, day, ...args) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  if (day) { env.GIT_AUTHOR_DATE = at(day); env.GIT_COMMITTER_DATE = at(day); }
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(dir, rel, text) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
function commit(dir, day, msg) { g(dir, day, 'add', '-A'); g(dir, day, 'commit', '-q', '-m', msg); }
const memo = (day, title, changes) => `---\ndate: ${day}\ntime: "07:00"\nsource: claude-code-web\ntitle: ${title}\n---\n## 決めたこと\n- ユーザーが PR をマージした\n\n## 作ったもの・変えたもの\n${changes.map((c) => `- ${c}`).join('\n')}\n\n## 次にやること\n- 作業を始める前に git pull する\n`;

/** A1111_SD_TokenCounter で起きた形: 作業は1日だけで、その後はキットの更新と、日報メモだけの PR のマージが続く */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-kitc-'));
  g(dir, null, 'init', '-q', '-b', 'main');
  write(dir, 'app.js', 'v1\n'); commit(dir, '2026-11-10', 'feat: トークン数を数える');
  write(dir, 'tools/daily-log.mjs', '// v1\n'); write(dir, 'docs/log/config.json', '{}\n'); commit(dir, '2026-11-12', 'chore: 日報の仕組みを導入');
  write(dir, 'app.js', 'v2\n'); write(dir, 'docs/log/entries/2026-11-13/0700-a.md', memo('2026-11-13', '表示を直す', ['app.js の表示を直した']));
  commit(dir, '2026-11-13', 'fix: 表示');
  ['2026-11-14', '2026-11-15', '2026-11-16'].forEach((day, i) => {
    write(dir, 'tools/daily-log.mjs', `// v${i + 2}\n`); commit(dir, day, `chore: 日報の仕組みを更新（${i + 1}回目）`);
  });
  ['2026-11-16', '2026-11-17', '2026-11-18'].forEach((day, i) => {
    g(dir, null, 'switch', '-q', '-c', `memo${i}`);
    write(dir, `docs/log/entries/${day}/0700-m.md`, memo(day, 'マージの記録', [`PR #${9 + i} を作成（マージ済み）`, `日報メモ docs/log/entries/${day}/0700-m.md`]));
    commit(dir, day, 'docs(log): 日報メモ');
    g(dir, null, 'switch', '-q', 'main');
    g(dir, day, 'merge', '-q', '--no-ff', '-m', `Merge pull request #${9 + i} from owner/claude/festive-bell`, `memo${i}`);
  });
  return dir;
}

test('日報メモだけの PR のマージとキットの更新は、作業・PR・記録率・繰り返しに数えない', () => {
  const dir = makeRepo();
  try {
    const kit = readKitHashes(dir);
    const merges = g(dir, null, 'log', '--merges', '--format=%H').split('\n');
    assert.equal(merges.length, 3);
    for (const h of merges) assert.ok(kit.has(h), '日報メモだけの PR のマージはキットのコミット');
    const r = analyzeRepo(dir, { today: '2026-11-18', now: '2026-11-18T03:00:00Z' });
    const m = r.metrics;
    assert.equal(m.commits, 2, '作業のコミットは feat と fix の2件だけ');
    assert.equal(m.prs, 0, '日報メモだけの PR は数えない');
    assert.deepEqual(m.repetition.repeatedWork, [], '似た作業の繰り返しにしない');
    assert.equal(m.memoCoverage.commitDays, 1, '記録率の対象は、導入後に作業のコミットがあった 11/13 だけ');
    assert.equal(m.memoCoverage.withMemo, 1);
    assert.deepEqual(m.repetition.carriedNext, [], '日報メモだけの PR のメモは「次にやること」の繰り越しに数えない');
    assert.ok(!r.findings.some((f) => ['repeated-work', 'repeated-prep', 'memo-coverage', 'carried-next'].includes(f.id)), `改善点: ${r.findings.map((f) => f.id).join(',')}`);
    // null を渡すと何も除かない（キット本体のダッシュボード用）
    assert.equal(analyzeRepo(dir, { today: '2026-11-18', excludeCommit: null }).metrics.commits, 12, '作業2件、キット4件、メモ3件、マージ3件');
    // 引き継ぎの「効率化の候補」にも出さない
    const brief = buildBrief(dir, { today: '2026-11-18', env: 'web', state: {} });
    assert.deepEqual(brief.efficiency, [], `効率化の候補: ${brief.efficiency.join(' / ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
