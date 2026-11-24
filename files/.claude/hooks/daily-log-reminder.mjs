#!/usr/bin/env node
// daily-log-kit v1.10.5 — Stop フック: 作業の差分があるのに日報メモがなければ、1回だけ記録を促す
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
  if (r.status === 4) {
    fs.writeFileSync(mark, head);
    process.stderr.write(
      '自動生成の日報（docs/log/YYYY-MM/、docs/log/README.md）が作業ブランチで変わっています。PR に含めると、続けてマージしたときに衝突します。\n'
      + '既定のブランチの内容に戻してコミットしてください（日報は、マージの後に Actions が作り直します）:\n'
      + '  git restore --source=origin/HEAD --staged --worktree -- docs/log/README.md "docs/log/20*"\n'
      + '日報メモ（docs/log/entries/）はそのまま含めてかまいません。\n',
    );
    process.exit(2);
  }
  if (r.status === 5) {
    fs.writeFileSync(mark, head);
    process.stderr.write(
      '日付の見出し（date:）がない、またはフォルダの日付と date が合わない日報メモがあります（手で作ったメモ）。\n'
      + '今日の作業のメモなら、node tools/daily-log.mjs new-entry で作り直し、内容を移してから古いファイルを消してください（日付とフォルダは日本時間・朝4時区切りで決まる）。\n'
      + '過去の日のメモ（チャットの補完など）なら、正しい日付のフォルダに置き、先頭の --- の中に date: YYYY-MM-DD を書いてください。\n'
      + '詳しくは node tools/daily-log.mjs check を実行。\n',
    );
    process.exit(2);
  }
  if (r.status !== 3) process.exit(0);
  fs.writeFileSync(mark, head);
  process.stderr.write(
    '日報メモがまだありません。終了する前に daily-log Skill の手順で記録してください:\n'
    + '1. node tools/daily-log.mjs new-entry を実行し、表示されたファイルに「決めたこと・作ったもの・次にやること・未解決」を書く\n'
    + '2. ユーザーが決めたことと、Claude の提案を区別して書く。秘密情報は書かない\n'
    + '3. 「docs(log): 日報メモ」でコミットする（作業ブランチ・PRに含める）\n'
    + '記録が不要な作業（質問への回答だけ、日報メモだけの PR のマージや Actions の結果の確認だけ等）なら、その旨を一言伝えて終了してかまいません。\n',
  );
  process.exit(2);
} catch {
  process.exit(0);
}
