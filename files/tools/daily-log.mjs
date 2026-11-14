#!/usr/bin/env node
// daily-log-kit v1.9.0 — 日報の生成ツール（依存パッケージなし。Node.js 18 以上）
// 仕様: docs/specs/daily-log.md
//
// 使い方:
//   node tools/daily-log.mjs generate [--all | --since YYYY-MM-DD] [--until YYYY-MM-DD] [--days 14] [--ref HEAD] [--dry-run]
//   node tools/daily-log.mjs new-entry [--source claude-code-web] [--date YYYY-MM-DD] [--title 件名]
//   node tools/daily-log.mjs check [--base origin/main] [--quiet]     # 終了コード 0=OK, 3=日報メモがない
//   node tools/daily-log.mjs transcripts [--since YYYY-MM-DD] [--dir ~/.claude/projects]
//
// 中核の関数は export しており、tools/daily-log.test.mjs で単体テストする。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const KIT_VERSION = '1.9.0';

export const DEFAULT_CONFIG = {
  tz: 'Asia/Tokyo',
  dayStartHour: 4, // この時刻より前の作業は前日に数える（深夜作業を1日にまとめる）
  logDir: 'docs/log',
  entriesDir: 'docs/log/entries',
  baseBranch: '', // 空なら origin/HEAD → origin/main → main → master の順に探す
  excludeAuthors: ['github-actions[bot]'],
  excludeSubjectPattern: '^docs\\(log\\): 日報を更新',
  defaultDays: 14,
};

const SEP_FIELD = '\x1f';
const SEP_REC = '\x1e';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ---------- 中核（純粋関数） ----------

export function mergeConfig(user = {}) {
  return { ...DEFAULT_CONFIG, ...user };
}

/** ISO日時 → タイムゾーンでの { date: 'YYYY-MM-DD', time: 'HH:MM' } */
export function localParts(iso, tz) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`日時を解釈できません: ${iso}`);
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** 作業日のキー。dayStartHour より前の時刻は前日に数える */
export function dayKey(iso, cfg = DEFAULT_CONFIG) {
  const shifted = new Date(new Date(iso).getTime() - cfg.dayStartHour * 3600_000);
  return localParts(shifted.toISOString(), cfg.tz).date;
}

/** 表示用の時刻。作業日より後の暦日なら「翌」を付ける */
export function displayTime(iso, day, cfg = DEFAULT_CONFIG) {
  const { date, time } = localParts(iso, cfg.tz);
  return date === day ? time : `翌${time}`;
}

export function weekdayOf(day) {
  const [y, m, d] = day.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function parseGitLog(raw) {
  return raw.split(SEP_REC).map((r) => r.replace(/^\n+/, '')).filter((r) => r.trim()).map((r) => {
    const [hash, date, author, parents, subject, body = ''] = r.split(SEP_FIELD);
    return {
      hash, date, author,
      parents: parents ? parents.trim().split(/\s+/) : [],
      subject: subject ?? '', body: body.trim(),
    };
  });
}

/** マージ・スカッシュのコミットから PR 番号と題名を取り出す */
export function prInfo(c) {
  const m = /^Merge pull request #(\d+) from (\S+)/.exec(c.subject);
  if (m) {
    const title = c.body.split('\n').map((s) => s.trim()).find(Boolean) || m[2];
    return { number: Number(m[1]), title, kind: 'merge' };
  }
  const s = /^(.*) \(#(\d+)\)$/.exec(c.subject);
  if (s) return { number: Number(s[2]), title: s[1], kind: 'squash' };
  return null;
}

export function filterCommits(commits, cfg = DEFAULT_CONFIG) {
  const re = cfg.excludeSubjectPattern ? new RegExp(cfg.excludeSubjectPattern) : null;
  return commits.filter((c) => !cfg.excludeAuthors.includes(c.author) && !(re && re.test(c.subject)));
}

export function groupByDay(commits, cfg = DEFAULT_CONFIG) {
  const map = new Map();
  for (const c of commits) {
    const k = dayKey(c.date, cfg);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  // git log は新しい順。同じ時刻のコミットも親→子の順に並ぶよう、逆順にしてから安定ソートする
  for (const [k, list] of map) map.set(k, list.reverse().sort((a, b) => new Date(a.date) - new Date(b.date)));
  return map;
}

/** 日報メモ（frontmatter 付き Markdown）を読む */
export function parseEntry(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2].trim() };
}

/** メモ本文の見出しを日報の階層に合わせて下げる（## → ####） */
export function demoteHeadings(body, by = 2) {
  let inFence = false;
  return body.split('\n').map((l) => {
    if (/^```/.test(l)) inFence = !inFence;
    if (!inFence && /^#{1,4} /.test(l)) return '#'.repeat(by) + l;
    return l;
  }).join('\n');
}

/** 空の見出し（中身が「- 」だけ等）を除き、書き忘れの雛形が日報に出ないようにする */
export function stripEmptySections(body) {
  body = body.replace(/<!--[\s\S]*?-->\n?/g, '');
  const parts = body.split(/\n(?=#{1,6} )/);
  return parts.filter((p) => {
    const lines = p.split('\n');
    if (!/^#{1,6} /.test(lines[0])) return p.trim() !== '';
    return lines.slice(1).some((l) => l.trim() && !/^[-*]\s*$/.test(l.trim()) && !/^<!--.*-->$/.test(l.trim()));
  }).join('\n').trim();
}

export function renderDay(day, commits, entries, cfg = DEFAULT_CONFIG) {
  const out = [];
  out.push(`# ${day}（${weekdayOf(day)}）`, '');
  out.push(`<!-- tools/daily-log.mjs が生成。手で編集しないでください。メモは ${cfg.entriesDir}/${day}/ に追加します -->`, '');
  const merges = commits.filter((c) => c.parents.length > 1).length;
  const prs = commits.map((c) => ({ c, pr: prInfo(c) })).filter((x) => x.pr);
  out.push('| 項目 | 値 |', '| --- | --- |');
  out.push(`| コミット | ${commits.length}件${merges ? `（うちマージ ${merges}件）` : ''} |`);
  if (commits.length) {
    out.push(`| 時間帯 | ${displayTime(commits[0].date, day, cfg)}〜${displayTime(commits.at(-1).date, day, cfg)} |`);
  }
  out.push(`| PR | ${prs.length}本 |`, `| 日報メモ | ${entries.length}件 |`, '');

  out.push('## 日報メモ', '');
  if (!entries.length) out.push('（なし）', '');
  for (const e of entries) {
    const label = [e.meta.time, e.meta.title || e.meta.branch].filter(Boolean).join(' ');
    out.push(`### ${label || e.file}${e.meta.source ? `（${e.meta.source}）` : ''}`, '');
    const body = demoteHeadings(stripEmptySections(e.body));
    out.push(body || '（未記入）', '');
  }

  if (prs.length) {
    out.push('## PR', '');
    for (const { c, pr } of prs) out.push(`- #${pr.number} ${pr.title}（${displayTime(c.date, day, cfg)}）`);
    out.push('');
  }
  const plain = commits.filter((c) => c.parents.length <= 1); // マージは PR 欄に出す
  if (plain.length) {
    out.push('## コミット', '');
    for (const c of plain) out.push(`- ${displayTime(c.date, day, cfg)} \`${c.hash.slice(0, 7)}\` ${c.subject}`);
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function renderIndex(days, cfg = DEFAULT_CONFIG) {
  const out = ['# 日報の一覧', '',
    `<!-- tools/daily-log.mjs が生成。作業日は ${cfg.tz} の ${cfg.dayStartHour}:00 区切り -->`, '',
    '| 日付 | コミット | PR | 日報メモ |', '| --- | ---: | ---: | ---: |'];
  for (const d of [...days].sort((a, b) => b.day.localeCompare(a.day))) {
    out.push(`| [${d.day}（${weekdayOf(d.day)}）](${dayPath(d.day)}) | ${d.commits} | ${d.prs} | ${d.entries} |`);
  }
  return out.join('\n') + '\n';
}

/** logDir からの相対パス（月ごとのフォルダ） */
export function dayPath(day) {
  return `${day.slice(0, 7)}/${day}.md`;
}

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note';
}

export function entryTemplate({ day, time, source, branch, title }) {
  return `---
date: ${day}
time: "${time}"
source: ${source}
branch: ${branch}
title: ${title}
---
<!-- 書いたら中身のない見出しは残してかまいません（日報には出ません）。秘密情報・個人情報は書かない。判断待ちが解決したら、「決めたこと」に「解決: <判断待ちの項目> → <決めた内容>」と書く。「詰まったこと」「手応え」は任意（手応えは先頭に1〜5、例「- 4（だいたい進んだ）」） -->
## 決めたこと
-

## 作ったもの・変えたもの
-

## 次にやること
-

## 未解決・判断待ち
-

## 詰まったこと
-

## 手応え（1〜5。任意）
-
`;
}

/** Claude Code の会話記録（JSONL）1行から、ユーザーの依頼文を取り出す。形式は非公式なので失敗したら null */
export function userPromptFromTranscriptLine(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (o?.type !== 'user' || !o.timestamp || o.isMeta) return null;
  const c = o.message?.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) text = c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n');
  text = text.trim();
  if (!text || text.startsWith('<command-') || text.startsWith('<local-command')) return null;
  return { timestamp: o.timestamp, cwd: o.cwd || '', sessionId: o.sessionId || '', text };
}

export function samePath(a, b) {
  const n = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return n(a) === n(b);
}

// ---------- 入出力 ----------

export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function tryGit(args, cwd) {
  try { return git(args, cwd).trim(); } catch { return null; }
}

export function repoRoot(cwd = process.cwd()) {
  const r = tryGit(['rev-parse', '--show-toplevel'], cwd);
  if (!r) throw new Error('Git リポジトリの中で実行してください');
  return r;
}

export function loadConfig(root) {
  const p = path.join(root, 'docs/log/config.json');
  if (!fs.existsSync(p)) return mergeConfig();
  try { return mergeConfig(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch (e) {
    throw new Error(`docs/log/config.json を読めません: ${e.message}`);
  }
}

export function readCommits(root, ref, cfg) {
  if (tryGit(['rev-parse', '--is-shallow-repository'], root) === 'true') {
    console.error('注意: 浅いクローンです。古い日の日報が欠けます（git fetch --unshallow を推奨）');
  }
  if (!tryGit(['rev-parse', '--verify', '--quiet', ref], root)) return []; // コミットがまだない
  const fmt = ['%H', '%aI', '%an', '%P', '%s', '%b'].join('%x1f') + '%x1e';
  return filterCommits(parseGitLog(git(['log', ref, `--pretty=format:${fmt}`], root)), cfg);
}

export function readEntries(root, cfg) {
  const base = path.join(root, cfg.entriesDir);
  const map = new Map();
  if (!fs.existsSync(base)) return map;
  for (const day of fs.readdirSync(base).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const dir = path.join(base, day);
    if (!fs.statSync(dir).isDirectory()) continue;
    const list = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
      const { meta, body } = parseEntry(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { file: f, meta, body };
    });
    if (list.length) map.set(day, list);
  }
  return map;
}

export function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      a[k] = v;
    } else a._.push(t);
  }
  return a;
}

function writeIfChanged(file, text, dry) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (old === text) return false;
  if (!dry) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return true;
}

export function cmdGenerate(args, root = repoRoot()) {
  const cfg = loadConfig(root);
  const ref = args.ref || 'HEAD';
  const byDay = groupByDay(readCommits(root, ref, cfg), cfg);
  const entries = readEntries(root, cfg);
  const allDays = [...new Set([...byDay.keys(), ...entries.keys()])].sort();
  const today = dayKey(new Date().toISOString(), cfg);
  let since = args.since;
  if (args.all || !allDays.length) since = allDays[0] || today;
  if (!since) since = addDays(today, -Number(args.days || cfg.defaultDays));
  const until = args.until || '9999-12-31';
  const changed = [];
  const summary = [];
  for (const day of allDays) {
    const commits = byDay.get(day) || [];
    const es = entries.get(day) || [];
    summary.push({ day, commits: commits.length, prs: commits.filter(prInfo).length, entries: es.length });
    if (day < since || day > until) continue;
    const file = path.join(root, cfg.logDir, dayPath(day));
    if (writeIfChanged(file, renderDay(day, commits, es, cfg), args['dry-run'])) changed.push(path.relative(root, file));
  }
  const idx = path.join(root, cfg.logDir, 'README.md');
  if (writeIfChanged(idx, renderIndex(summary, cfg), args['dry-run'])) changed.push(path.relative(root, idx));
  console.log(changed.length ? `${args['dry-run'] ? '変更予定' : '更新'}: ${changed.length}件\n${changed.map((f) => `  ${f}`).join('\n')}` : '変更なし');
  return changed;
}

export function cmdNewEntry(args, root = repoRoot()) {
  const cfg = loadConfig(root);
  const now = new Date().toISOString();
  const day = args.date || dayKey(now, cfg);
  const time = localParts(now, cfg.tz).time;
  const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], root) || 'unknown';
  const source = args.source || (process.env.CLAUDE_CODE_REMOTE === 'true' ? 'claude-code-web' : 'claude-code');
  const title = args.title || branch;
  const dir = path.join(root, cfg.entriesDir, day);
  const slug = slugify(args.title) === 'note' ? slugify(branch) : slugify(args.title);
  let file = path.join(dir, `${time.replace(':', '')}-${slug}.md`);
  for (let n = 2; fs.existsSync(file); n++) file = file.replace(/(-\d+)?\.md$/, `-${n}.md`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, entryTemplate({ day, time, source, branch, title }));
  console.log(path.relative(root, file).replace(/\\/g, '/'));
  return file;
}

export function findBase(root, cfg, explicit) {
  const cands = [explicit, cfg.baseBranch,
    tryGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root),
    'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
  return cands.find((c) => tryGit(['rev-parse', '--verify', '--quiet', c], root)) || null;
}

/** 0=OK、3=日報メモがない。判定できないときは 0（作業を止めない） */
export function cmdCheck(args, root = repoRoot()) {
  const cfg = loadConfig(root);
  const base = findBase(root, cfg, args.base);
  const say = (m) => { if (!args.quiet) console.log(m); };
  if (!base) { say('比較先のブランチが見つからないため確認を省略'); return 0; }
  const ahead = Number(tryGit(['rev-list', '--count', `${base}..HEAD`], root) || 0);
  const dirty = (tryGit(['status', '--porcelain', '--untracked-files=all'], root) || '').split('\n').filter(Boolean);
  const touched = [
    ...(tryGit(['diff', '--name-only', `${base}...HEAD`], root) || '').split('\n'),
    ...dirty.map((l) => l.slice(3)),
  ].filter(Boolean).map((f) => f.replace(/\\/g, '/'));
  const work = touched.filter((f) => !f.startsWith(cfg.logDir + '/'));
  if (!ahead && !work.length) { say('変更なし'); return 0; }
  if (touched.some((f) => f.startsWith(cfg.entriesDir + '/'))) { say('日報メモあり'); return 0; }
  if (!work.length) { say('日報の変更のみ'); return 0; }
  say(`日報メモがありません（${base} との差分 ${work.length}ファイル）`);
  return 3;
}

export function cmdTranscripts(args, root = repoRoot()) {
  const cfg = loadConfig(root);
  const dir = args.dir || path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(dir)) { console.log(`会話記録のフォルダがありません: ${dir}`); return; }
  const since = args.since || '0000-00-00';
  const byDay = new Map();
  for (const proj of fs.readdirSync(dir)) {
    const pdir = path.join(dir, proj);
    if (!fs.statSync(pdir).isDirectory()) continue;
    for (const f of fs.readdirSync(pdir).filter((x) => x.endsWith('.jsonl'))) {
      for (const line of fs.readFileSync(path.join(pdir, f), 'utf8').split('\n')) {
        const p = userPromptFromTranscriptLine(line);
        if (!p || !p.cwd || !(samePath(p.cwd, root) || path.resolve(p.cwd).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep))) continue;
        const day = dayKey(p.timestamp, cfg);
        if (day < since) continue;
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(p);
      }
    }
  }
  const out = ['# Claude Code の依頼文（日報メモの材料。コミットしない）', ''];
  for (const day of [...byDay.keys()].sort()) {
    out.push(`## ${day}（${weekdayOf(day)}）`, '');
    for (const p of byDay.get(day).sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
      const t = p.text.replace(/\s+/g, ' ');
      out.push(`- ${displayTime(p.timestamp, day, cfg)} [${p.sessionId.slice(0, 8)}] ${t.length > 300 ? t.slice(0, 300) + '…' : t}`);
    }
    out.push('');
  }
  if (byDay.size === 0) out.push('（このリポジトリの会話記録は見つかりませんでした）');
  console.log(out.join('\n'));
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  switch (cmd) {
    case 'generate': cmdGenerate(args); return 0;
    case 'new-entry': cmdNewEntry(args); return 0;
    case 'check': return cmdCheck(args);
    case 'transcripts': cmdTranscripts(args); return 0;
    case 'version': console.log(KIT_VERSION); return 0;
    default:
      console.log('使い方: node tools/daily-log.mjs <generate|new-entry|check|transcripts|version> [オプション]\n詳細は docs/specs/daily-log.md');
      return cmd ? 1 : 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); } catch (e) { console.error(`エラー: ${e.message}`); process.exitCode = 1; }
}
