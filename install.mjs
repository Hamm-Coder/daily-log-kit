#!/usr/bin/env node
// daily-log-kit v1.3.1 — 1つのリポジトリに日報の仕組みを入れる（何度実行しても同じ結果になる）
//
//   node install.mjs <リポジトリのフォルダ> [--backfill] [--dry-run] [--no-workflow] [--no-hook] [--no-adr] [--force]
//
//   --backfill     導入後に全履歴から過去の日報を作る（generate --all）
//   --dry-run      何をするかだけ表示する
//   --no-workflow  GitHub Actions を入れない（ブランチ保護がある等）
//   --no-hook      Stop フックを入れない
//   --force        キット以外の同名ファイルがあっても上書きする
//   --no-adr       ADR を作らない（docs/decisions/ があるリポジトリでは、既定で「採用」の ADR を1件作る）
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

export const KIT_VERSION = '1.3.1';
const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = path.join(KIT_DIR, 'files');
const MARK_START = '<!-- daily-log:start';
const MARK_END = '<!-- daily-log:end -->';
// 登録するフック（イベントとファイル）
export const HOOKS = [
  { event: 'Stop', file: '.claude/hooks/daily-log-reminder.mjs' },
  { event: 'SessionStart', file: '.claude/hooks/daily-log-session-start.mjs' },
];
const ADR_DIR = 'docs/decisions';
const ADR_TEMPLATE = path.join(KIT_DIR, 'templates', 'adr-daily-log.md');

export const CLAUDE_MD_BLOCK = `${MARK_START} (daily-log-kit v${KIT_VERSION}。この区間は導入スクリプトが更新します) -->
## 日報

- 作業の最後（PRを作る前）に \`daily-log\` Skill の手順で \`docs/log/entries/<日付>/\` に日報メモを書き、作業ブランチにコミットする
- 決めたことはユーザーが決めた・承認したことだけを書き、提案は「未解決・判断待ち」に書く。秘密情報は書かない
- セッションの開始時に「日報からの引き継ぎ」（次にやること・判断待ち・始める前の準備・効率化の候補）が渡される。依頼に関係するときに使い、準備の項目は作業の前に確かめる
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
export function hookCommand(settings, file = HOOKS[0].file) {
  const cmds = [];
  for (const groups of Object.values(settings?.hooks || {})) {
    for (const g of groups || []) for (const h of g.hooks || []) if (typeof h.command === 'string') cmds.push(h.command);
  }
  for (const c of cmds) {
    const m = /^node\s+("?)(.*?)\.claude\/hooks\/[\w.-]+\.m?js\1\s*$/.exec(c);
    if (m) return `node ${m[1]}${m[2]}${file}${m[1]}`;
  }
  return `node "$CLAUDE_PROJECT_DIR/${file}"`;
}

/** 日報のフック（Stop と SessionStart）を足す。既存の設定と、既にあるフックはそのまま */
export function mergeSettings(settings) {
  const s = structuredClone(settings || {});
  s.hooks ??= {};
  const added = [];
  for (const { event, file } of HOOKS) {
    s.hooks[event] ??= [];
    const name = path.basename(file, '.mjs');
    const exists = s.hooks[event].some((g) => (g.hooks || []).some((h) => String(h.command || '').includes(name)));
    if (exists) continue;
    s.hooks[event].push({ hooks: [{ type: 'command', command: hookCommand(settings, file), timeout: 30 }] });
    added.push(event);
  }
  return { settings: s, changed: added.length > 0, added };
}

export function mergePackageScripts(pkg) {
  const p = structuredClone(pkg);
  p.scripts ??= {};
  const want = {
    log: 'node tools/daily-log.mjs generate',
    'log:entry': 'node tools/daily-log.mjs new-entry',
    'log:analyze': 'node tools/daily-log-analyze.mjs',
    'log:brief': 'node tools/daily-log-brief.mjs',
    'test:log': 'node --test tools/daily-log.test.mjs tools/daily-log-analyze.test.mjs tools/daily-log-brief.test.mjs',
  };
  const added = [];
  for (const [k, v] of Object.entries(want)) if (!(k in p.scripts)) { p.scripts[k] = v; added.push(k); }
  return { pkg: p, added };
}

export function isKitFile(text) {
  return /daily-log-kit v\d/.test(text.slice(0, 600));
}

/** docs/decisions の次の番号（4桁）。番号付きのファイルがなければ 0001 */
export function nextAdrNumber(names) {
  const nums = names.map((n) => /^(\d{4})-/.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0');
}

/** 日報の ADR が既にあるか（ファイル名か本文で判定。導入済み・手書き済みのどちらも二重に作らない） */
export function hasDailyLogAdr(files) {
  return files.some(({ name, text }) => /daily-log/i.test(name) || /daily-log-kit/.test(text) || /^# ADR.*日報/m.test(text));
}

export function renderAdr(template, { number, date, version, workflow }) {
  return template.replaceAll('{{NUMBER}}', number).replaceAll('{{DATE}}', date).replaceAll('{{VERSION}}', version)
    .replaceAll('{{WORKFLOW_LINE}}', workflow
      ? 'main への push で GitHub Actions が日報を作り直す'
      : 'このリポジトリでは GitHub Actions を使わず、PRの中で `node tools/daily-log.mjs generate` を実行して日報を更新する');
}

export function todayIn(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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
    if (opt.noHook && HOOKS.some((h) => h.file === relPosix)) continue;
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
    const { settings, changed, added } = mergeSettings(cur);
    if (changed) act(`設定 .claude/settings.json に ${added.join('・')} フックを追加`, () => {
      fs.mkdirSync(path.dirname(sp), { recursive: true });
      fs.writeFileSync(sp, JSON.stringify(settings, null, 2) + '\n');
    });
  }

  const cm = path.join(root, 'CLAUDE.md');
  const cmText = fs.existsSync(cm) ? fs.readFileSync(cm, 'utf8') : '';
  const cmNew = upsertBlock(cmText, CLAUDE_MD_BLOCK);
  if (cmNew !== cmText) act(`${cmText ? '更新' : '追加'} CLAUDE.md（日報の区間）`, () => fs.writeFileSync(cm, cmNew));

  const adrDir = path.join(root, ADR_DIR);
  if (opt.noAdr) {
    // 何もしない
  } else if (!fs.existsSync(adrDir)) {
    log.push(`ADR なし（${ADR_DIR}/ がないリポジトリなので作らない）`);
  } else {
    const names = fs.readdirSync(adrDir).filter((n) => n.endsWith('.md'));
    const files = names.map((name) => ({ name, text: fs.readFileSync(path.join(adrDir, name), 'utf8') }));
    if (hasDailyLogAdr(files)) {
      log.push(`ADR あり（${ADR_DIR}/ に日報の ADR が既にあるので作らない）`);
    } else {
      let tz = 'Asia/Tokyo';
      try { tz = JSON.parse(fs.readFileSync(path.join(root, 'docs/log/config.json'), 'utf8')).tz || tz; } catch { /* 既定 */ }
      const number = nextAdrNumber(names);
      const file = `${ADR_DIR}/${number}-daily-log.md`;
      const text = renderAdr(fs.readFileSync(ADR_TEMPLATE, 'utf8'), { number, date: todayIn(tz), version: KIT_VERSION, workflow: !opt.noWorkflow });
      act(`追加 ${file}（状態: 採用）`, () => fs.writeFileSync(path.join(root, file), text));
    }
  }

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
  if (!target) { console.log('使い方: node install.mjs <リポジトリのフォルダ> [--backfill] [--dry-run] [--no-workflow] [--no-hook] [--no-adr] [--force]'); process.exit(1); }
  const opt = {
    backfill: args.includes('--backfill'), dryRun: args.includes('--dry-run'),
    noWorkflow: args.includes('--no-workflow'), noHook: args.includes('--no-hook'), noAdr: args.includes('--no-adr'), force: args.includes('--force'),
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
