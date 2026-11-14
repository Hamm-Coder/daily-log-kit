#!/usr/bin/env node
// daily-log-kit v1.9.0 — SessionStart フック: 日報からの引き継ぎ（次にやること・判断待ち・始める前の準備・効率化の候補）を Claude に渡す
// 標準出力の内容が Claude の文脈に入る。止め方: 環境変数 DAILY_LOG_SKIP=1。失敗しても何も出さない（作業を止めない）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

try {
  try { fs.readFileSync(0, 'utf8'); } catch { /* 入力は使わない */ }
  if (process.env.DAILY_LOG_SKIP === '1') process.exit(0);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const tool = path.join(root, 'tools', 'daily-log-brief.mjs');
  if (!fs.existsSync(tool)) process.exit(0);
  const r = spawnSync(process.execPath, [tool], { cwd: root, encoding: 'utf8', timeout: 15000 });
  if (r.status === 0 && r.stdout && r.stdout.trim()) process.stdout.write(r.stdout);
} catch { /* 何もしない */ }
process.exit(0);
