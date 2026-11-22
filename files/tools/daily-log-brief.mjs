#!/usr/bin/env node
// daily-log-kit v1.10.3 — セッション開始時の引き継ぎ（次にやること・判断待ち・始める前の準備・効率化の候補）
// 仕様: docs/specs/daily-log.md の「13. セッション開始時の引き継ぎ」
//
// 使い方:
//   node tools/daily-log-brief.mjs                 # 引き継ぎの文を表示（SessionStart フックが使う）
//   node tools/daily-log-brief.mjs --env web|pc    # 環境を指定（既定は CLAUDE_CODE_REMOTE から判定）
//
// 速さを優先し、ネットワーク（git fetch）は使わない。失敗しても何も出さずに終わる（作業を止めない）。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dayKey, repoRoot, loadConfig, readEntries, tryGit, readCommits } from './daily-log.mjs';
import {
  analysisConfig, extractSections, pendingItems, detectRepetition, defaultExcludeCommit, readLogOnlyEntries, readFixFiles, suggestFor, addDaysSafe,
} from './daily-log-analyze.mjs';

const PC_MARK = /[（(]PC[）)]/;
const ID_RE = /(?<![\w-])([A-Z]{1,2}-?\d{1,3})(?![\w-])/g;

// ---------- 中核（純粋関数） ----------

/** Markdown の表のうち、最初の列の見出しが「ID」のものを読む（SPEC.md の作業キュー） */
export function parseSpecQueue(md) {
  const rows = new Map();
  const lines = String(md || '').split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const head = splitRow(lines[i]);
    if (!head || head[0] !== 'ID' || !/^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) continue;
    for (let j = i + 2; j < lines.length; j++) {
      const cells = splitRow(lines[j]);
      if (!cells) break;
      const row = Object.fromEntries(head.map((h, k) => [h, cells[k] ?? '']));
      if (row.ID) rows.set(row.ID, row);
    }
  }
  return rows;
}

function splitRow(line) {
  const t = String(line).trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

export function idsIn(text) {
  return [...String(text).matchAll(ID_RE)].map((m) => m[1]);
}

/** 作業キューの行から、引き継ぎに出す項目（作業・成果物・完了条件・実行場所・状態）を短くまとめる */
export function summarizeRow(row) {
  const pick = Object.keys(row).filter((k) => k !== 'ID' && /(作業|成果物|完了条件|実行場所|状態)/.test(k));
  return pick.map((k) => `${k}: ${clip(row[k], 50)}`).join(' / ');
}

function clip(s, n) {
  const t = String(s).replace(/`/g, '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 実行場所の列や（PC）の印から、この環境でできるかを判定する */
export function placeOf(text, row) {
  const where = row ? Object.entries(row).find(([k]) => /実行場所/.test(k))?.[1] || '' : '';
  if (PC_MARK.test(text) || /^(PC|デスクトップ)$/.test(where.trim())) return 'pc';
  if (/^(Web|Web版)$/.test(where.trim())) return 'web';
  return 'any';
}

/** 準備のルール（config.json の prep）から、次にやることに合う手順を集める */
export function prepFromRules(nextItems, rules = []) {
  const out = [];
  for (const rule of rules) {
    let re;
    try { re = new RegExp(rule.when, 'i'); } catch { continue; }
    const hit = nextItems.find((t) => re.test(t));
    if (hit) for (const s of rule.steps || []) if (!out.some((o) => o.text === s)) out.push({ level: '手順', text: s, reason: clip(hit.replace(PC_MARK, '').trim(), 30) });
  }
  return out;
}

/** リポジトリの状態から準備作業を出す。state は collectState() の結果 */
export function prepFromState(state, env) {
  const out = [];
  if (state.behind > 0) out.push({ level: '必要', text: `origin より ${state.behind}コミット遅れている（最後に取得した時点）→ git pull` });
  if (state.dirty > 0) out.push({ level: '確認', text: `未コミットの変更が ${state.dirty}ファイル → 前回の作業の残りか確認する` });
  if (state.needsNpm) out.push({ level: '必要', text: 'package.json に依存パッケージがあるが node_modules がない → npm ci（ロックファイルがなければ npm install）' });
  if (state.usesLfs && !state.hasLfs) out.push({ level: '必要', text: 'Git LFS を使うリポジトリだが git-lfs が見つからない → 素材が取得できない。git lfs install' });
  if (state.branch && state.defaultBranch && state.branch !== state.defaultBranch && env === 'pc') out.push({ level: '確認', text: `今のブランチは ${state.branch}（作業を続けるブランチか確認する）` });
  return out;
}

export function renderBrief(b) {
  const lines = [];
  const blockers = b.blockers || [];
  const has = b.next.length || b.pending.length || b.prep.length || b.efficiency.length || blockers.length;
  if (!has) return '';
  lines.push('## 日報からの引き継ぎ（daily-log）', '');
  lines.push('この情報は、ユーザーの依頼に関係するときに使う。最初の返答で全部を繰り返さない。');
  if (b.latest) lines.push(`前回のメモ: ${b.latest.day}${b.latest.time ? ' ' + b.latest.time : ''}「${b.latest.title || '（題名なし）'}」${b.latest.source ? `（${b.latest.source}）` : ''} / この環境: ${b.env === 'web' ? 'Web版' : 'PC'}`);
  if (b.next.length) {
    lines.push('', '### 次にやること');
    for (const n of b.next) {
      const tag = n.place === 'pc' && b.env === 'web' ? ' ← この環境（Web版）ではできない' : '';
      lines.push(`- ${n.text}${tag}`);
      for (const s of n.spec) lines.push(`  - SPEC ${s.id}: ${s.summary}`);
    }
    const web = b.next.filter((n) => !(n.place === 'pc' && b.env === 'web'));
    if (b.env === 'web' && web.length && web.length < b.next.length) lines.push(`- （Web版で今できるのは ${web.length}件）`);
  }
  if (blockers.length) {
    lines.push('', '### 前回詰まったこと');
    for (const t of blockers) lines.push(`- ${t}`);
  }
  if (b.pending.length) {
    lines.push('', '### 判断待ち');
    for (const p of b.pending) lines.push(`- ${p.text}（${p.firstDay}から、メモに${p.count}回）`);
  }
  if (b.prep.length) {
    lines.push('', '### 始める前の準備');
    for (const p of b.prep) lines.push(`- [${p.level}] ${p.text}${p.reason ? `（${p.reason} のため）` : ''}`);
  }
  if (b.efficiency.length) {
    lines.push('', '### 効率化の候補（繰り返しの判別）');
    for (const e of b.efficiency) lines.push(`- ${e}`);
  }
  return lines.join('\n') + '\n';
}

// ---------- 入出力 ----------

export function collectState(root, cfg) {
  const n = (s) => Number(s || 0) || 0;
  const pkgPath = path.join(root, 'package.json');
  let needsNpm = false;
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
      needsNpm = deps.length > 0 && !fs.existsSync(path.join(root, 'node_modules'));
    } catch { /* 読めなければ判定しない */ }
  }
  const attrs = path.join(root, '.gitattributes');
  const usesLfs = fs.existsSync(attrs) && /filter=lfs/.test(fs.readFileSync(attrs, 'utf8'));
  const head = tryGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root);
  return {
    behind: n(tryGit(['rev-list', '--count', 'HEAD..@{u}'], root)),
    dirty: (tryGit(['status', '--porcelain'], root) || '').split('\n').filter(Boolean).length,
    branch: tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], root),
    defaultBranch: head ? head.replace(/^origin\//, '') : null,
    needsNpm, usesLfs, hasLfs: usesLfs ? !!tryGit(['lfs', 'version'], root) : true,
  };
}

export function buildBrief(root, opts = {}) {
  const cfg = loadConfig(root);
  const a = analysisConfig(cfg);
  const env = opts.env || (process.env.CLAUDE_CODE_REMOTE === 'true' ? 'web' : 'pc');
  const today = opts.today || dayKey(new Date().toISOString(), cfg);
  const memos = [];
  for (const [day, list] of readEntries(root, cfg)) for (const e of list) memos.push({ day, file: e.file, meta: e.meta, sections: extractSections(e.body) });
  memos.sort((x, y) => (x.day + (x.meta.time || '')).localeCompare(y.day + (y.meta.time || '')));
  const latest = memos.at(-1);
  const specPath = path.join(root, 'SPEC.md');
  const spec = fs.existsSync(specPath) ? parseSpecQueue(fs.readFileSync(specPath, 'utf8')) : new Map();
  const next = (latest?.sections.next || []).slice(0, 8).map((text) => {
    const rows = idsIn(text).map((id) => spec.get(id) && { id, row: spec.get(id) }).filter(Boolean);
    return { text, place: placeOf(text, rows[0]?.row), spec: rows.map(({ id, row }) => ({ id, summary: summarizeRow(row) })) };
  });
  const prep = [
    ...prepFromState(opts.state || collectState(root, cfg), env),
    ...prepFromRules(next.map((n) => n.text), cfg.prep || []),
  ];
  if (env === 'web' && next.some((n) => n.place === 'pc')) prep.push({ level: '確認', text: '（PC）の作業はこの環境ではできない。Web版でできる作業を先に進め、PC作業はまとめて行う' });

  const since = addDaysSafe(today, -a.repeatWindowDays);
  // キット・日報だけのコミット（導入・更新、日報メモなど）と、日報メモだけの PR で入ったメモは繰り返しに数えない（仕様 4.3・12.1）
  const exclude = (opts.commits && opts.fixFiles) ? null : defaultExcludeCommit(root);
  const logOnly = exclude ? readLogOnlyEntries(root, cfg) : new Set();
  const workMemos = memos.map((m) => ({ ...m, logOnly: logOnly.has(`${m.day}/${m.file}`) }));
  const keep = (c) => !(exclude && exclude({ hash: c.hash, subject: c.subject || '' }));
  const commits = opts.commits || readCommits(root, 'HEAD', cfg).filter((c) => c.parents.length <= 1 && keep(c)).map((c) => ({ subject: c.subject, day: dayKey(c.date, cfg) })).filter((c) => c.day >= since);
  const fixFiles = opts.fixFiles || readFixFiles(root, new Date(Date.parse(today + 'T00:00:00Z') - a.hotspotDays * 86_400_000).toISOString(), a.ignorePaths, { maxFiles: a.hotspotMaxFiles, excludeCommit: exclude });
  const rep = detectRepetition({ memos: workMemos, commits, fixFiles, today, a, latestNext: latest?.sections.next || [] });
  const efficiency = [
    ...rep.prepRepeats.slice(0, 2).map((p) => `準備作業の繰り返し: 「${p.keyword}」を含む作業が${p.days.length}日（例: ${clip(p.examples[0], 40)}）→ 手順を1つのスクリプトか Skill にまとめる`),
    ...rep.repeatedWork.slice(0, 2).map((w) => `${w.prep ? '準備作業' : '作業'}の繰り返し: ${w.examples.slice(-2).map((e) => `「${clip(e, 30)}」`).join('')}など、似た作業が${w.days.length}日 → ${suggestFor(w)}`),
    ...rep.carriedNext.slice(0, 2).map((c) => `繰り越し: 「${clip(c.text, 40)}」が${c.count}回のメモに残っている（${c.firstDay}から）→ 着手できない理由を確かめる`),
    ...rep.fixHotspots.slice(0, 2).map((h) => `修正の集中: ${h.file} を直近${a.hotspotDays}日で${h.fixes}回修正 → テストか検査を追加する`),
  ];
  return {
    env, latest: latest ? { day: latest.day, time: latest.meta.time, title: latest.meta.title, source: latest.meta.source } : null,
    next, blockers: (latest?.sections.blockers || []).slice(0, 5),
    pending: pendingItems(memos, today, a.pendingWindowDays).slice(0, 5), prep, efficiency,
  };
}

export function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--env');
  const env = i >= 0 ? argv[i + 1] : undefined;
  const root = repoRoot(process.cwd());
  process.stdout.write(renderBrief(buildBrief(root, { env })));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); } catch { process.exitCode = 0; } // 引き継ぎは補助なので、失敗しても作業を止めない
}
