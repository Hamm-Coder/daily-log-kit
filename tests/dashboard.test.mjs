// daily-log-kit v1.10.0 — ダッシュボード（dashboard.mjs）のテスト
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install } from '../install.mjs';
import {
  isKitPath, isKitCommit, isKitRepo, idleBand, readmeOverview, docExcerpt, collectRepo, renderDashboard, weeklyCounts, dailyCounts,
} from '../dashboard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-11-14';
const at = (day) => `${day}T12:00:00+09:00`; // 日本時間の昼（朝4時区切りでも同じ日）
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function gitAt(cwd, day, ...args) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  if (day) { env.GIT_AUTHOR_DATE = at(day); env.GIT_COMMITTER_DATE = at(day); }
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(dir, rel, text) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
function commit(dir, day, msg) { gitAt(dir, day, 'add', '-A'); gitAt(dir, day, 'commit', '-q', '-m', msg); }

test('キットのコミットの判定: 件名（導入・更新・日報の自動更新）か、キットのファイルだけを変えた', () => {
  assert.equal(isKitCommit({ subject: 'chore: 日報の仕組みを更新（daily-log-kit v1.10.0）', files: ['package.json', 'tools/daily-log.mjs'] }), true);
  assert.equal(isKitCommit({ subject: 'docs(log): 日報を更新 [skip ci]', files: [] }), true);
  assert.equal(isKitCommit({ subject: 'Merge pull request #3 from x/chore/daily-log-v1.8.0', files: [] }), true);
  assert.equal(isKitCommit({ subject: 'chore: 準備のルールを追加', files: ['docs/log/config.json'] }), true);
  assert.equal(isKitCommit({ subject: 'feat: 奥の手', files: ['game/js/plugins/CF_LastResort.js', 'docs/log/entries/2026-11-09/m.md'] }), false);
  assert.equal(isKitCommit({ subject: 'docs: CLAUDE.md を直す', files: ['CLAUDE.md'] }), false, 'CLAUDE.md だけの変更は作業に数える');
  assert.equal(isKitPath('docs/decisions/0011-daily-log.md'), true);
  assert.equal(isKitPath('docs/decisions/0003-battle.md'), false);
});

test('作業がない日数は 30・60・100日以上の3段階（重ねて数えない）', () => {
  assert.equal(idleBand(29), null);
  assert.equal(idleBand(30), 30);
  assert.equal(idleBand(99), 60);
  assert.equal(idleBand(100), 100);
  assert.equal(idleBand(null), null);
});

test('README の冒頭: 段落と箇条書きを読み、表・区切り線・コードは除き、リンクは文字だけにする', () => {
  const t = '# ツール\n\n画像生成の[プロンプト](docs/a.md)を**組み立てる**ローカルアプリ。\n2行目。\n\n- 出力形式A\n- 出力形式B\n\n| a | b |\n| - | - |\n---\n```\ncode\n```\n## 起動\n本文\n';
  assert.equal(readmeOverview(t), '画像生成のプロンプトを組み立てるローカルアプリ。 2行目。\n・出力形式A\n・出力形式B');
  assert.ok(readmeOverview('# x\n\n' + 'あ'.repeat(800)).length <= 501);
  assert.equal(readmeOverview(null), null);
});

test('資料の抜粋: HANDOFF.md の経緯の表は最後の3行、なければ CHANGELOG.md の最新の節', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-dash-doc-'));
  write(dir, 'docs/HANDOFF.md', '# 引き継ぎ\n## 1. 概要\nx\n## 2. これまでの経緯\n| # | 内容 | コミット |\n| --- | --- | --- |\n| 1 | 最初 | a |\n| 2 | 二番目 | b |\n| 3 | 三番目 | c |\n| 4 | 四番目 `x` | d |\n## 3. 構成\n');
  assert.deepEqual(docExcerpt(dir), { file: 'docs/HANDOFF.md', title: '2. これまでの経緯', items: ['2 — 二番目', '3 — 三番目', '4 — 四番目 x'] });
  fs.rmSync(path.join(dir, 'docs'), { recursive: true });
  write(dir, 'CHANGELOG.md', '# Changelog\n\n## [Unreleased] - 刷新\n\n### Added\n- 一つ目\n- 二つ目\n- 三つ目\n- 四つ目\n## [1.0]\n- 古い\n');
  assert.deepEqual(docExcerpt(dir), { file: 'CHANGELOG.md', title: '[Unreleased] - 刷新', items: ['一つ目', '二つ目', '三つ目'] });
});

test('集計: キット本体以外は、キット・日報のコミットを最後の作業・コミット数・週ごとの数・改善点から除く', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-dash-repo-'));
  gitAt(dir, null, 'init', '-q', '-b', 'main');
  write(dir, 'README.md', '# サンプル\n\n作業を記録するためのサンプル。\n');
  write(dir, 'src/a.js', 'a');
  commit(dir, addDays(TODAY, -40), 'feat: 最初の機能');
  install(dir, {});
  commit(dir, addDays(TODAY, -3), 'chore: 日報の仕組みを導入（daily-log-kit v1.10.0）');
  write(dir, 'docs/log/config.json', '{"weeklyIssue": true}\n');
  commit(dir, addDays(TODAY, -2), 'chore: 週の Issue を有効に');
  write(dir, 'docs/log/README.md', '# 日報\n');
  commit(dir, addDays(TODAY, -1), 'docs(log): 日報を更新 [skip ci]');

  const r = collectRepo(dir, { today: TODAY });
  assert.equal(r.isKit, false);
  assert.deepEqual(r.created, { day: addDays(TODAY, -40), shallow: false }, '作成日は最初のコミットの日');
  assert.equal(r.daily.length, 30);
  assert.equal(r.daily.reduce((a, b) => a + b, 0), 0, '30日より前の作業と、キット・日報のコミットは数えない');
  assert.deepEqual(r.lastWork, { day: addDays(TODAY, -40), text: 'feat: 最初の機能' });
  assert.equal(r.commitsAll, 1);
  assert.equal(r.commits24, 1);
  assert.equal(r.weeks.length, 24);
  assert.equal(r.weeks.at(-1).commits, 0, '今週のキットのコミットは数えない');
  assert.equal(r.overview, '作業を記録するためのサンプル。');
  assert.deepEqual(r.recent.map((c) => c.text), ['feat: 最初の機能']);
  assert.ok(!r.findings.some((f) => f.id === 'large-commits'), 'キットの導入の大きなコミットは改善点に出さない');
  assert.equal(isKitRepo(dir), false);
  assert.equal(isKitRepo(ROOT), true);
});

test('修正の集中: 多くのファイルをまとめて直したコミット（版の更新など）は数えない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-dash-fix-'));
  gitAt(dir, null, 'init', '-q', '-b', 'main');
  write(dir, 'a.js', '0');
  commit(dir, addDays(TODAY, -20), 'feat: a');
  for (let i = 1; i <= 3; i++) {
    write(dir, 'a.js', String(i));
    for (let j = 0; j < 20; j++) write(dir, `many/f${j}.js`, `${i}`);
    commit(dir, addDays(TODAY, -10 + i), `fix: 版の更新 ${i}`);
  }
  assert.ok(!collectRepo(dir, { today: TODAY }).findings.some((f) => f.id === 'fix-hotspot'));
  for (let i = 4; i <= 6; i++) { write(dir, 'a.js', String(i)); commit(dir, addDays(TODAY, -6 + i), `fix: a を直す ${i}`); }
  assert.ok(collectRepo(dir, { today: TODAY }).findings.some((f) => f.id === 'fix-hotspot'), '1ファイルずつの修正の繰り返しは知らせる');
});

test('週ごとの数: 月曜始まりの直近24週', () => {
  const w = weeklyCounts([{ day: TODAY }, { day: addDays(TODAY, -7) }, { day: '2020-01-01' }], TODAY);
  assert.equal(w.length, 24);
  assert.equal(w.at(-1).week, '2026-11-09');
  assert.deepEqual([w.at(-2).commits, w.at(-1).commits], [1, 1]);
});

test('HTML: 集計結果に「</script>」があっても script を閉じない', () => {
  const html = renderDashboard([{ key: 'x', name: '</script><b>x', today: TODAY }], '<script>\nconst DATA = __DATA__;\n</script>');
  assert.equal(html.split('</script>').length - 1, 1);
  const json = /const DATA = (.*);/.exec(html)[1];
  assert.equal(JSON.parse(json)[0].name, '</script><b>x');
  assert.match(fs.readFileSync(path.join(ROOT, 'dashboard-template.html'), 'utf8'), /const DATA = __DATA__;/);
});

test('日ごとのコミット数: 基準日を含む直近30日を古い順に数える', () => {
  const c = (day) => ({ day });
  const d = dailyCounts([c(TODAY), c(TODAY), c(addDays(TODAY, -29)), c(addDays(TODAY, -30)), c(addDays(TODAY, 1))], TODAY);
  assert.equal(d.length, 30);
  assert.equal(d[29], 2, '基準日');
  assert.equal(d[0], 1, '29日前は入る');
  assert.equal(d.reduce((a, b) => a + b, 0), 3, '30日前と未来の日は入らない');
});
