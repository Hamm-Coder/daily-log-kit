#!/usr/bin/env node
// daily-log-kit v1.0.0 — 1つのリポジトリに日報の仕組みを入れる（何度実行しても同じ結果になる）
//
//   node install.mjs <リポジトリのフォルダ> [--backfill] [--dry-run] [--no-workflow] [--no-hook] [--force]
//
//   --backfill     導入後に全履歴から過去の日報を作る（generate --all）
//   --dry-run      何をするかだけ表示する
//   --no-workflow  GitHub Actions を入れない（ブランチ保護がある等）
//   --no-hook      Stop フックを入れない
//   --force        キット以外の同名ファイルがあっても上書きする
//
// 既存ファイルの扱い:
//   キットのファイル（先頭付近に "daily-log-kit v" がある）→ 新しい版で上書き
//   docs/log/config.json → 既にあれば触らない
//   .claude/settings.json → Stop フックを1件追加（既存の設定は保持）
//   CLAUDE.md → <!-- daily-log:start --> 〜 <!-- daily-log:end --> の区間だけ置き換え（なければ末尾に追加）
//   package.json → scripts に log / log:entry / test:log を追加（同名があれば触らない）

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const KIT_VERSION = '1.0.0';
const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = path.join(KIT_DIR, 'files');
const MARK_START = '<!-- daily-log:start';
const MARK_END = '<!-- daily-log:end -->';
const HOOK_FILE = '.claude/hooks/daily-log-reminder.mjs';

export const CLAUDE_MD_BLOCK = `${MARK_START} (daily-log-kit v${KIT_VERSION}。この区間は導入スクリプトが更新します) -->
## 日報

- 作業の最後（PRを作る前）に \`daily-log\` Skill の手順で \`docs/log/entries/<日付>/\` に日報メモを書き、作業ブランチにコミットする
- 決めたことはユーザーが決めた・承認したことだけを書き、提案は「未解決・判断待ち」に書く。秘密情報は書かない
- \`docs/log/YYYY-MM/\` と \`docs/log/README.md\` は自動生成なので手で編集しない
- 仕様: \`docs/specs/daily-log.md\`
${MARK_END}`;

// ---------- 中核（純粋関数。テスト可能） ----------

export function upsertBlock(text, block) {
  const s = text.indexOf(MARK_START);
  const e = text.indexOf(MARK_END, s);
  if (s >= 0 && e > s) return text.slice(0, s) + block + text.slice(e + MARK_END.length);
  const base = text.replace(/\s*$/, '');
  return (base ? base + '\n\n' : '') + block + '\n';
}

/** 既存のフックの書き方（$CLAUDE_PROJECT_DIR の有無など）に合わせてコマンドを作る */
export function hookCommand(settings) {
  const cmds = [];
  for (const groups of Object.values(settings?.hooks || {})) {
    for (const g of groups || []) for (const h of g.hooks || []) if (typeof h.command === 'string') cmds.push(h.command);
  }
  for (const c of cmds) {
    const m = /^node\s+("?)(.*?)\.claude\/hooks\/[\w.-]+\.m?js\1\s*$/.exec(c);
    if (m) return `node ${m[1]}${m[2]}${HOOK_FILE}${m[1]}`;
  }
  return `node "$CLAUDE_PROJECT_DIR/${HOOK_FILE}"`;
}

export function mergeSettings(settings) {
  const s = structuredClone(settings || {});
  s.hooks ??= {};
  s.hooks.Stop ??= [];
  const exists = s.hooks.Stop.some((g) => (g.hooks || []).some((h) => String(h.command || '').includes('daily-log-reminder')));
  if (exists) return { settings: s, changed: false };
  s.hooks.Stop.push({ hooks: [{ type: 'command', command: hookCommand(settings), timeout: 30 }] });
  return { settings: s, changed: true };
}

export function mergePackageScripts(pkg) {
  const p = structuredClone(pkg);
  p.scripts ??= {};
  const want = {
    log: 'node tools/daily-log.mjs generate',
    'log:entry': 'node tools/daily-log.mjs new-entry',
    'test:log': 'node --test tools/daily-log.test.mjs',
  };
  const added = [];
  for (const [k, v] of Object.entries(want)) if (!(k in p.scripts)) { p.scripts[k] = v; added.push(k); }
  return { pkg: p, added };
}

export function isKitFile(text) {
  return /daily-log-kit v\d/.test(text.slice(0, 600));
}

function detectIndent(text) {
  const m = /^( +|\t)"/m.exec(text);
  return m ? m[1] : '  ';
}

// ---------- 実行 ----------

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, base) : [path.relative(base, p)];
  });
}

export function install(target, opt = {}) {
  const root = path.resolve(target);
  const log = [];
  const act = (msg, fn) => { log.push(msg); if (!opt.dryRun) fn(); };
  if (!fs.existsSync(path.join(root, '.git'))) throw new Error(`Git リポジトリではありません: ${root}`);

  for (const rel of walk(FILES_DIR)) {
    const relPosix = rel.split(path.sep).join('/');
    if (opt.noWorkflow && relPosix.startsWith('.github/')) continue;
    if (opt.noHook && relPosix === HOOK_FILE) continue;
    const src = path.join(FILES_DIR, rel);
    const dst = path.join(root, rel);
    const body = fs.readFileSync(src);
    if (fs.existsSync(dst)) {
      const cur = fs.readFileSync(dst);
      if (cur.equals(body)) continue;
      if (relPosix === 'docs/log/config.json') { log.push(`保持 ${relPosix}（既存の設定）`); continue; }
      if (!isKitFile(cur.toString('utf8')) && !opt.force) { log.push(`スキップ ${relPosix}（キット以外の同名ファイル。--force で上書き）`); continue; }
      act(`更新 ${relPosix}`, () => fs.writeFileSync(dst, body));
    } else {
      act(`追加 ${relPosix}`, () => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, body); });
    }
  }

  if (!opt.noHook) {
    const sp = path.join(root, '.claude/settings.json');
    let cur = {};
    if (fs.existsSync(sp)) {
      try { cur = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch { throw new Error('.claude/settings.json が JSON として読めません。直してから再実行してください'); }
    }
    const { settings, changed } = mergeSettings(cur);
    if (changed) act('設定 .claude/settings.json に Stop フックを追加', () => {
      fs.mkdirSync(path.dirname(sp), { recursive: true });
      fs.writeFileSync(sp, JSON.stringify(settings, null, 2) + '\n');
    });
  }

  const cm = path.join(root, 'CLAUDE.md');
  const cmText = fs.existsSync(cm) ? fs.readFileSync(cm, 'utf8') : '';
  const cmNew = upsertBlock(cmText, CLAUDE_MD_BLOCK);
  if (cmNew !== cmText) act(`${cmText ? '更新' : '追加'} CLAUDE.md（日報の区間）`, () => fs.writeFileSync(cm, cmNew));

  const pj = path.join(root, 'package.json');
  if (fs.existsSync(pj)) {
    const text = fs.readFileSync(pj, 'utf8');
    const { pkg, added } = mergePackageScripts(JSON.parse(text));
    if (added.length) act(`設定 package.json に scripts（${added.join(', ')}）を追加`, () => fs.writeFileSync(pj, JSON.stringify(pkg, null, detectIndent(text)) + '\n'));
  }

  if (opt.backfill) {
    act('実行 node tools/daily-log.mjs generate --all', () => {
      const r = spawnSync(process.execPath, ['tools/daily-log.mjs', 'generate', '--all'], { cwd: root, encoding: 'utf8' });
      if (r.stdout) log.push(r.stdout.trim().split('\n')[0]);
      if (r.status !== 0) throw new Error(`過去の日報の生成に失敗: ${r.stderr}`);
    });
  }
  return log;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) { console.log('使い方: node install.mjs <リポジトリのフォルダ> [--backfill] [--dry-run] [--no-workflow] [--no-hook] [--force]'); process.exit(1); }
  const opt = {
    backfill: args.includes('--backfill'), dryRun: args.includes('--dry-run'),
    noWorkflow: args.includes('--no-workflow'), noHook: args.includes('--no-hook'), force: args.includes('--force'),
  };
  try {
    const log = install(target, opt);
    console.log(`daily-log-kit v${KIT_VERSION} → ${path.resolve(target)}${opt.dryRun ? '（確認のみ）' : ''}`);
    console.log(log.length ? log.map((l) => `  ${l}`).join('\n') : '  変更なし（導入済み）');
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  }
}
