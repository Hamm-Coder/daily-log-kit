#!/usr/bin/env node
// daily-log-kit v1.9.1 — 複数リポジトリのダッシュボード（HTML 1枚）を作る（各リポジトリには配らない）
//   node dashboard.mjs [--out dashboard.html] [--today YYYY-MM-DD] [--json] <リポジトリのフォルダ...>
// 普段は dashboard.ps1 から呼ぶ。対象の選び方（日報の仕組みを入れたリポジトリとキット本体）は dashboard.ps1 が行う
// 作った HTML には非公開のリポジトリの内容が入るので、コミットしない（.gitignore で除外）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, dayKey, addDays, DEFAULT_CONFIG } from './files/tools/daily-log.mjs';
import { analyzeRepo, weekStart } from './files/tools/daily-log-analyze.mjs';

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WEEKS = 24;
export const IDLE_BANDS = [100, 60, 30]; // 作業がない日数の区切り（重ねて数えない）
// キット本体以外では、キットの更新・日報の自動更新・日報メモ・日報の設定のコミットを作業に数えない。
// 判断は変えたファイルで行う（キットのファイルだけを変えたコミット）。ファイルの一覧がないマージは件名で判断する
export const KIT_PATHS = [
  'docs/log/', 'tools/daily-log', '.claude/hooks/daily-log', '.claude/skills/daily-log/', '.github/workflows/daily-log',
  'docs/specs/daily-log.md', 'docs/procedures/daily-log', 'docs/decisions/',
];
export const KIT_SUBJECT = /^docs\(log\)|日報の仕組み|daily-log/i;
/** キットの管理するファイルか（ADR は日報の ADR だけ） */
export function isKitPath(f) {
  if (f.startsWith('docs/decisions/')) return /daily-log/.test(f);
  return KIT_PATHS.some((p) => f.startsWith(p)) || f === 'CLAUDE.md' || f === '.claude/settings.json';
}

const README_MAX = 500;
const EXCERPT_MAX = 140;

/** キット本体のフォルダか（install.mjs・bump-version.mjs・files/tools/daily-log.mjs がそろっている） */
export function isKitRepo(dir) {
  return ['install.mjs', 'bump-version.mjs', 'files/tools/daily-log.mjs'].every((f) => fs.existsSync(path.join(dir, f)));
}

/** 作業がない日数の区切り（30・60・100日以上）。どれにも当たらなければ null */
export function idleBand(days) {
  if (days === null || days === undefined) return null;
  return IDLE_BANDS.find((b) => days >= b) ?? null;
}

const readText = (dir, f) => { const p = path.join(dir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r/g, '') : null; };
const clean = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

/** README.md の最初の見出しの後から次の見出しまで（段落と箇条書き。表・引用・コード・区切り線は除く）を、最大 500 文字 */
export function readmeOverview(text) {
  if (!text) return null;
  const lines = text.replace(/\r/g, '').split('\n');
  let i = lines.findIndex((l) => /^# /.test(l));
  i = i < 0 ? 0 : i + 1;
  const parts = [];
  let fence = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l.trim())) { fence = !fence; continue; }
    if (fence) continue;
    if (/^#{1,6} /.test(l)) break;
    if (!l.trim() || /^\s*[|>]/.test(l) || /^\s*([-*_]\s*){3,}$/.test(l)) continue;
    const b = /^\s*[-*+]\s+(.*)$/.exec(l);
    parts.push(b ? '・' + clean(b[1]) : clean(l));
  }
  const s = parts.join(' ').replace(/ ・/g, '\n・').trim();
  return s ? cut(s, README_MAX) : null;
}

/** HANDOFF.md の「経緯・現状・状態・最近」の節（表なら最後の3行、文なら最初の4行）。なければ CHANGELOG.md の最新の節の3行 */
export function docExcerpt(dir) {
  for (const f of ['docs/HANDOFF.md', 'HANDOFF.md']) {
    const t = readText(dir, f);
    if (!t) continue;
    const sec = t.split(/\n(?=## )/).find((s) => /^## .*(経緯|現状|状態|最近)/.test(s));
    if (!sec) continue;
    const title = sec.split('\n')[0].replace(/^##\s*/, '');
    const rows = sec.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*:?-/.test(l)).slice(1);
    const items = rows.length
      ? rows.slice(-3).map((l) => clean(l.split('|').map((c) => c.trim()).filter(Boolean).slice(0, 2).join(' — ')))
      : sec.split('\n').slice(1).filter((l) => l.trim() && !/^#/.test(l)).slice(0, 4).map((l) => clean(l.replace(/^\s*[-*]\s*/, '')));
    return { file: f, title, items: items.filter(Boolean).map((s) => cut(s, EXCERPT_MAX)) };
  }
  const c = readText(dir, 'CHANGELOG.md');
  const sec = c && c.split(/\n(?=## )/).find((s) => /^## /.test(s));
  if (!sec) return null;
  return {
    file: 'CHANGELOG.md', title: sec.split('\n')[0].replace(/^##\s*/, ''),
    items: sec.split('\n').filter((l) => /^\s*-\s+/.test(l)).slice(0, 3).map((l) => cut(clean(l.replace(/^\s*-\s*/, '')), EXCERPT_MAX)),
  };
}

/** キット・日報のコミットか。件名が合う（キットの導入・更新、日報の自動更新など）か、キットのファイルだけを変えた
 *  （CLAUDE.md と .claude/settings.json は、キットのファイルと一緒に変えたときだけキットのものとみなす） */
export function isKitCommit({ subject = '', files = [] }) {
  if (KIT_SUBJECT.test(subject)) return true;
  return files.length > 0 && files.every(isKitPath) && files.some((f) => f !== 'CLAUDE.md' && f !== '.claude/settings.json');
}

/** マージを除いたコミット（新しい順）。kit: キット・日報のコミットか */
export function readWorkLog(dir, cfg) {
  let raw = '';
  try { raw = execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', 'log', '--no-merges', '--name-only', '--format=%x1e%H%x1f%aI%x1f%s'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }); } catch { return []; }
  return raw.split('\x1e').filter((b) => b.trim()).map((b) => {
    const [head, ...lines] = b.split('\n');
    const [hash, iso, subject] = head.split('\x1f');
    const files = lines.map((s) => s.trim()).filter(Boolean);
    return { hash, iso, day: dayKey(iso, cfg), text: subject, kit: isKitCommit({ subject, files }) };
  });
}

/** 直近 WEEKS 週（月曜始まり）のコミット数 */
export function weeklyCounts(commits, today, weeks = WEEKS) {
  const end = weekStart(today);
  const keys = Array.from({ length: weeks }, (_, i) => addDays(end, (i - weeks + 1) * 7));
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const c of commits) { const w = weekStart(c.day); if (counts.has(w)) counts.set(w, counts.get(w) + 1); }
  return keys.map((week) => ({ week, commits: counts.get(week) }));
}

/** 1つのリポジトリの集計 */
export function collectRepo(dir, { today } = {}) {
  const root = path.resolve(dir);
  const isKit = isKitRepo(root);
  const cfg = loadConfig(root);
  const day = today || dayKey(new Date().toISOString(), cfg);
  const log = readWorkLog(root, cfg);
  const commits = isKit ? log : log.filter((c) => !c.kit);
  const kitHashes = new Set(log.filter((c) => c.kit).map((c) => c.hash));
  const excludeCommit = isKit ? null : ({ hash, subject }) => kitHashes.has(hash) || KIT_SUBJECT.test(subject);
  const r = analyzeRepo(root, { today: day, excludeCommit });
  const m = r.metrics;
  const memoWeeks = new Map(m.weekly.map((w) => [w.week, w.memos]));
  const weeks = weeklyCounts(commits, day).map((w) => ({ ...w, memos: memoWeeks.get(w.week) || 0 }));
  return {
    key: path.basename(root).replace(/[^\w.-]/g, '-'), name: path.basename(root), isKit, today: day,
    lastWork: commits[0] ? { day: commits[0].day, text: commits[0].text } : null,
    commits24: weeks.reduce((s, w) => s + w.commits, 0), commitsAll: commits.length,
    prs: m.prs, memos: m.memos, weeks,
    next: m.latestNext, pending: m.pending, resolved: m.resolved || [], pcTasks: m.pcTasks,
    feel: m.feel || null, blockers: m.blockers || null, decisions: (m.recentDecisions || []).slice(0, 5),
    findings: r.findings.map(({ id, level, title, evidence, action }) => ({ id, level, title, evidence, action })),
    overview: readmeOverview(readText(root, 'README.md')), excerpt: docExcerpt(root),
    recent: commits.slice(0, 5).map((c) => ({ day: c.day, text: c.text })),
  };
}

/** ひな形に集計結果を入れて HTML を作る。JSON の中の「</」は書き換えて、script を途中で閉じないようにする */
export function renderDashboard(repos, template = fs.readFileSync(path.join(KIT_DIR, 'dashboard-template.html'), 'utf8')) {
  const json = JSON.stringify(repos).replace(/</g, '\\u003c');
  return template.replace('__DATA__', () => json);
}

export function parseDashboardArgs(argv) {
  const a = { dirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--out') a.out = argv[++i];
    else if (t === '--today') a.today = argv[++i];
    else if (t === '--json') a.json = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else a.dirs.push(t);
  }
  return a;
}

export function main(argv = process.argv.slice(2)) {
  const a = parseDashboardArgs(argv);
  if (a.help || !a.dirs.length) {
    console.log('使い方: node dashboard.mjs [--out dashboard.html] [--today YYYY-MM-DD] [--json] <リポジトリのフォルダ...>');
    return a.help ? 0 : 1;
  }
  const today = a.today || dayKey(new Date().toISOString(), DEFAULT_CONFIG);
  const repos = [];
  for (const d of a.dirs) {
    try { repos.push(collectRepo(d, { today })); } catch (e) { console.error(`飛ばしました: ${d}（${e.message}）`); }
  }
  if (!repos.length) { console.error('集計できたリポジトリがありません'); return 1; }
  const text = a.json ? JSON.stringify(repos, null, 2) + '\n' : renderDashboard(repos);
  if (a.out) {
    fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
    fs.writeFileSync(a.out, text);
    console.log(`作成: ${a.out}（${repos.length} リポジトリ）`);
  } else process.stdout.write(text);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); } catch (e) { console.error(`エラー: ${e.message}`); process.exitCode = 1; }
}
