// daily-log-kit v1.10.5 — フックの結合テスト（一時的な Git リポジトリに導入して、実際にフックを動かす）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install } from '../install.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', CLAUDE_CODE_REMOTE: 'true' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-hook-'));
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  install(dir, {});
  fs.writeFileSync(path.join(dir, 'SPEC.md'), '| ID | 作業 | 完了条件 | 実行場所 | 状態 |\n| --- | --- | --- | --- | --- |\n| D4 | CF_LootTable | 単体テストが通る | Web | 未着手 |\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { eslint: '^9.0.0' } }));
  const memo = (day, time, changes, next) => {
    const d = path.join(dir, 'docs/log/entries', day);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${time.replace(':', '')}-m.md`), `---\ndate: ${day}\ntime: "${time}"\nsource: claude-code-web\nbranch: x\ntitle: 作業 ${day}\n---\n## 決めたこと\n- \n## 作ったもの・変えたもの\n${changes.map((c) => `- ${c}`).join('\n')}\n## 次にやること\n${next.map((c) => `- ${c}`).join('\n')}\n## 未解決・判断待ち\n- ボスの名前（ヴォルクは仮）\n`);
  };
  const today = new Date();
  const day = (n) => new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  memo(day(9), '21:00', ['PCで CF_HeroineStatus を登録'], ['（PC）C3 の画像1体の取り込み']);
  memo(day(6), '21:00', ['CF_EscapeItems をプラグイン管理に登録'], ['（PC）C3 の画像1体の取り込み']);
  memo(day(2), '21:00', ['CF_LastResort を登録'], ['D4 CF_LootTable', '（PC）C3 の画像1体の取り込み']);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'setup');
  fs.writeFileSync(path.join(dir, 'b.txt'), '作業中');
  return dir;
}

function runHook(dir, file, input = '{}', extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(dir, file)], { cwd: dir, input, encoding: 'utf8', env: { ...env, CLAUDE_PROJECT_DIR: dir, ...extraEnv } });
}

test('導入すると settings.json に Stop と SessionStart のフックが入る', () => {
  const dir = makeRepo();
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
  assert.ok(s.hooks.Stop[0].hooks[0].command.includes('daily-log-reminder.mjs'));
  assert.ok(s.hooks.SessionStart[0].hooks[0].command.includes('daily-log-session-start.mjs'));
});

test('SessionStart フック: 次にやること・作業キュー・準備・繰り返しを出す', () => {
  const dir = makeRepo();
  const r = runHook(dir, '.claude/hooks/daily-log-session-start.mjs', JSON.stringify({ source: 'startup' }));
  assert.equal(r.status, 0);
  const out = r.stdout;
  assert.match(out, /## 日報からの引き継ぎ（daily-log）/);
  assert.match(out, /この環境: Web版/);
  assert.match(out, /- D4 CF_LootTable\n {2}- SPEC D4: 作業: CF_LootTable \/ 完了条件: 単体テストが通る \/ 実行場所: Web/);
  assert.match(out, /（PC）C3 の画像1体の取り込み ← この環境（Web版）ではできない/);
  assert.match(out, /ボスの名前（ヴォルクは仮）/);
  assert.match(out, /\[確認\] 未コミットの変更が 1ファイル/);
  assert.match(out, /\[必要\] package\.json に依存パッケージがあるが node_modules がない/);
  assert.match(out, /準備作業の繰り返し: 「登録」を含む作業が3日/);
  assert.match(out, /繰り越し: 「（PC）C3 の画像1体の取り込み」が3回/);
});

test('SessionStart フック: 止める設定とツールがない場合は何も出さず 0 で終わる', () => {
  const dir = makeRepo();
  assert.equal(runHook(dir, '.claude/hooks/daily-log-session-start.mjs', '{}', { DAILY_LOG_SKIP: '1' }).stdout, '');
  fs.rmSync(path.join(dir, 'tools/daily-log-brief.mjs'));
  const r = runHook(dir, '.claude/hooks/daily-log-session-start.mjs');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('Stop フック: 作業ブランチで自動生成の日報が変わっていたら1回だけ知らせる（PR の衝突の防止。仕様 4.4）', () => {
  const dir = makeRepo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-remote-'));
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', '--auto');
  git(dir, 'switch', '-q', '-c', 'feat/y');
  fs.rmSync(path.join(dir, 'b.txt'));
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  fs.mkdirSync(path.join(dir, 'docs/log/entries/2026-11-21'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/log/entries/2026-11-21/0900-m.md'), '---\ndate: 2026-11-21\n---\n## 決めたこと\n- x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat と日報メモ');
  assert.equal(runHook(dir, '.claude/hooks/daily-log-reminder.mjs').status, 0, '日報メモだけなら知らせない');
  execFileSync(process.execPath, [path.join(dir, 'tools/daily-log.mjs'), 'generate'], { cwd: dir, env, stdio: 'ignore' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'docs(log): 日報メモ（生成した日報も含めてしまった）');
  const r = runHook(dir, '.claude/hooks/daily-log-reminder.mjs');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /自動生成の日報/);
  assert.match(r.stderr, /git restore --source=origin\/HEAD/);
  assert.equal(runHook(dir, '.claude/hooks/daily-log-reminder.mjs').status, 0, '同じ HEAD では2回目は通す');
  git(dir, 'restore', '--source=origin/HEAD', '--staged', '--worktree', '--', 'docs/log/README.md', 'docs/log/20*');
  git(dir, 'commit', '-q', '-m', 'docs(log): 自動生成の日報を戻す');
  assert.equal(runHook(dir, '.claude/hooks/daily-log-reminder.mjs').status, 0, '戻せば知らせない');
});

test('Stop フック: 既定のブランチを取り込んだだけの日報は知らせない（取り込みで入った日報は既定のブランチと同じ中身）', () => {
  const dir = makeRepo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-remote-'));
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', remote);
  fs.rmSync(path.join(dir, 'b.txt'));
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', '--auto');
  git(dir, 'switch', '-q', '-c', 'feat/z');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  fs.mkdirSync(path.join(dir, 'docs/log/entries/2026-11-21'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/log/entries/2026-11-21/0900-m.md'), '---\ndate: 2026-11-21\n---\n## 決めたこと\n- x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat と日報メモ');
  // main 側で Actions が日報を作り直した（を再現）→ 作業ブランチに取り込む
  git(dir, 'switch', '-q', 'main');
  execFileSync(process.execPath, [path.join(dir, 'tools/daily-log.mjs'), 'generate'], { cwd: dir, env, stdio: 'ignore' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'docs(log): 日報を更新 [skip ci]');
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'switch', '-q', 'feat/z');
  git(dir, 'merge', '-q', '--no-edit', 'origin/main');
  assert.equal(runHook(dir, '.claude/hooks/daily-log-reminder.mjs').status, 0);
});

test('Stop フック: 作業の差分があってメモがなければ1回だけ促し、2回目と stop_hook_active では通す', () => {
  const dir = makeRepo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-remote-'));
  git(remote, 'init', '-q', '--bare', '-b', 'main'); // -b main: 既定のブランチ名（init.defaultBranch）が環境で違っても origin/HEAD が決まる
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', '--auto');
  git(dir, 'switch', '-q', '-c', 'feat/x');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  git(dir, 'add', 'c.txt');
  git(dir, 'commit', '-q', '-m', 'feat');
  const first = runHook(dir, '.claude/hooks/daily-log-reminder.mjs', '{"stop_hook_active":false}');
  assert.equal(first.status, 2);
  assert.match(first.stderr, /日報メモがまだありません/);
  assert.equal(runHook(dir, '.claude/hooks/daily-log-reminder.mjs').status, 0);
  assert.equal(runHook(dir, '.claude/hooks/daily-log-reminder.mjs', '{"stop_hook_active":true}').status, 0);
});

test('daily-log.yml: 先に別の回が日報を push していても、最新の main に合わせて作り直して push できる（v1.10.3。RPGMZ_Prototype の連続マージで失敗した形）', () => {
  const yml = fs.readFileSync(path.join(KIT, 'files/.github/workflows/daily-log.yml'), 'utf8');
  assert.doesNotMatch(yml, /pull --rebase/, '自動生成の日報どうしが衝突するので rebase しない');
  const step = yml.split(/\r?\n/);
  const start = step.findIndex((l) => /name: 日報を作り直して push/.test(l));
  const runAt = step.findIndex((l, i) => i > start && /^\s+run: \|/.test(l));
  const body = [];
  for (let i = runAt + 1; i < step.length && (/^\s{10}/.test(step[i]) || step[i].trim() === ''); i++) body.push(step[i].slice(10));
  const script = body.join('\n').replace(/\$\{\{ inputs\.all \}\}/g, '');

  // GitHub 役と、2つの回（先に終わった回 A と、古いコミットから始まった回 B）
  const dir = makeRepo();
  fs.rmSync(path.join(dir, 'b.txt'));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-remote-'));
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  const runB = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-runB-'));
  git(runB, 'clone', '-q', remote, '.');
  // 回 A: 新しいマージの日報を作って先に push した（README.md が変わる）
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Merge pull request #81');
  git(dir, 'push', '-q', 'origin', 'main');
  execFileSync(process.execPath, [path.join(dir, 'tools/daily-log.mjs'), 'generate'], { cwd: dir, env, stdio: 'ignore' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'docs(log): 日報を更新 [skip ci]');
  git(dir, 'push', '-q', 'origin', 'main');
  // 回 B: 古いコミット（#81 の前）から始まり、自分で日報を作っていた
  execFileSync(process.execPath, [path.join(runB, 'tools/daily-log.mjs'), 'generate'], { cwd: runB, env, stdio: 'ignore' });
  const r = spawnSync('bash', ['-e', '-c', script], { cwd: runB, encoding: 'utf8', env: { ...env, GITHUB_REF_NAME: 'main' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /CONFLICT|unmerged/);
  // GitHub 役の main は、回 A の日報の上に積まれている（巻き戻していない）
  assert.match(git(remote, 'log', '--format=%s', 'main'), /Merge pull request #81/);
});

test('Stop フック: 手で作った日報メモ（date の見出しがない・フォルダと日付が違う）を1回知らせる（v1.10.4、仕様 4.5）', () => {
  const dir = makeRepo();
  fs.rmSync(path.join(dir, 'b.txt'));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-remote-'));
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', '--auto');
  git(dir, 'switch', '-q', '-c', 'feat/w');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  // MangaCreation で起きた形: 前のメモを写して、UTC の日付のフォルダに date なしで置いた
  fs.mkdirSync(path.join(dir, 'docs/log/entries/2026-11-22'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/log/entries/2026-11-22/0646-x.md'), '---\ntitle: 手で作ったメモ\n---\n## 決めたこと\n- x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat と手書きのメモ');
  const r = runHook(dir, '.claude/hooks/daily-log-reminder.mjs');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /new-entry/);
  assert.equal(runHook(dir, '.claude/hooks/daily-log-reminder.mjs').status, 0, '同じ HEAD では2回目は通す');
  // date があってもフォルダと違えば知らせる
  fs.writeFileSync(path.join(dir, 'docs/log/entries/2026-11-22/0646-x.md'), '---\ndate: 2026-11-23\ntitle: x\n---\n## 決めたこと\n- x\n');
  git(dir, 'commit', '-qam', 'date を足した（フォルダと違う）');
  assert.equal(runHook(dir, '.claude/hooks/daily-log-reminder.mjs').status, 2);
  // new-entry で作ったメモなら知らせない
  fs.rmSync(path.join(dir, 'docs/log/entries/2026-11-22'), { recursive: true });
  execFileSync(process.execPath, [path.join(dir, 'tools/daily-log.mjs'), 'new-entry', '--title', 'x'], { cwd: dir, env, stdio: 'ignore' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'new-entry で作り直した');
  assert.equal(runHook(dir, '.claude/hooks/daily-log-reminder.mjs').status, 0);
});

test('SessionStart フック: 今日の作業日を毎回出す（メモがないリポジトリでも）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-today-'));
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  install(dir, {});
  const r = runHook(dir, '.claude/hooks/daily-log-session-start.mjs');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /今日の作業日: \d{4}-\d{2}-\d{2}（Asia\/Tokyo・朝4時区切り）/);
  assert.match(r.stdout, /new-entry/);
});
