#!/usr/bin/env node
// daily-log-kit v1.5.1 — Stop フック: 作業の差分があるのに日報メモがなければ、1回だけ記録を促す
// 止め方: 環境変数 DAILY_LOG_SKIP=1。判定できないとき・エラー時は何もしない（作業を止めない）
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

try {
  const input = readStdin();
  if (input.stop_hook_active || process.env.DAILY_LOG_SKIP === '1') process.exit(0);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const tool = path.join(root, 'tools', 'daily-log.mjs');
  if (!fs.existsSync(tool)) process.exit(0);

  // 同じ HEAD では1回だけ促す（stop_hook_active が渡らない場合のループ防止）
  const git = (a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const head = git(['rev-parse', 'HEAD']);
  const gitDir = path.resolve(root, git(['rev-parse', '--git-dir']));
  const mark = path.join(gitDir, 'daily-log-reminded');
  if (fs.existsSync(mark) && fs.readFileSync(mark, 'utf8').trim() === head) process.exit(0);

  const r = spawnSync(process.execPath, [tool, 'check', '--quiet'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 3) process.exit(0);
  fs.writeFileSync(mark, head);
  process.stderr.write(
    '日報メモがまだありません。終了する前に daily-log Skill の手順で記録してください:\n'
    + '1. node tools/daily-log.mjs new-entry を実行し、表示されたファイルに「決めたこと・作ったもの・次にやること・未解決」を書く\n'
    + '2. ユーザーが決めたことと、Claude の提案を区別して書く。秘密情報は書かない\n'
    + '3. 「docs(log): 日報メモ」でコミットする（作業ブランチ・PRに含める）\n'
    + '記録が不要な作業（質問への回答だけ等）なら、その旨を一言伝えて終了してかまいません。\n',
  );
  process.exit(2);
} catch {
  process.exit(0);
}
