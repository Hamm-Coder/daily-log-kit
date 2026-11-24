#!/usr/bin/env node
// daily-log-kit v1.10.5 — 日報と Git 履歴の分析（作業の傾向、改善点、判断待ちの一覧）
// 仕様: docs/specs/daily-log.md の「12. 分析」
//
// 使い方:
//   node tools/daily-log-analyze.mjs                       # このリポジトリを分析して表示
//   node tools/daily-log-analyze.mjs --out docs/log/ANALYSIS.md
//   node tools/daily-log-analyze.mjs --since 2026-10-01 --json
//   node tools/daily-log-analyze.mjs C:\AllGitRepository\A C:\AllGitRepository\B   # 複数リポジトリをまとめて
//
// 数値は「作業の傾向をつかむ目安」であり、成果や生産性の評価には使わない（docs/specs/daily-log.md 12.4）。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_CONFIG, dayKey, localParts, prInfo, weekdayOf, addDays,
  repoRoot, loadConfig, readCommits, readEntries, tryGit, findBase,
} from './daily-log.mjs';

export const ANALYSIS_DEFAULTS = {
  sessionGapMinutes: 120, // これ以上あいたら別の作業のまとまり（セッション）とみなす
  sessionPadMinutes: 30, // セッションの最初のコミットより前の作業分として足す目安
  lateNightStartHour: 0,
  lateNightEndHour: 4, // 0:00〜3:59 を深夜とする（Eyolfson et al. 2011 の区分）
  memoCoverageMin: 0.8,
  lateNightRatioMax: 0.25,
  prLeadTimeDaysMax: 3,
  staleBranchDays: 14,
  largeCommitLines: 1000,
  largeCommitFiles: 50,
  fixRatioMax: 0.3,
  pendingCarryDays: 7,
  pcTasksMax: 5,
  inactiveDays: 14,
  recentDays: 14,
  lowFeelAvg: 2.5, // 直近の手応えの平均がこれ以下なら知らせる
  lowFeelMinMemos: 3, // 手応えが書かれたメモがこれ未満なら判定しない
  blockerRepeatDays: 2, // 同じ「詰まったこと」が何日に出たら知らせるか
  pendingWindowDays: 7, // 判断待ちは直近7日のメモに書かれた項目（「決めたこと」の「解決: <項目>」で外れる）
  similarity: 0.5, // 似た作業とみなす文字の重なり（2文字ずつの組の一致率）
  repeatMinDays: 3, // 同じ作業が何日に出たら「繰り返し」とみなすか
  repeatWindowDays: 60, // 繰り返しを探す期間
  carryMinCount: 3, // 同じ「次にやること」が何回のメモに出たら「繰り越し」とみなすか
  carryMinDays: 3, // そのうち何日に分かれて出たら「繰り越し」とみなすか（同じ日のメモだけなら数えない）
  hotspotFixes: 3, // 同じファイルの修正が何回続いたら知らせるか
  hotspotDays: 30,
  hotspotMaxFiles: 15, // これより多くのファイルをまとめて直したコミット（版の更新など）は、修正の集中に数えない
  ignorePaths: [
    'docs/log/', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    // キット自体のファイル（導入・更新のコミットを「大きなコミット」に数えない）
    'tools/daily-log', '.claude/hooks/daily-log-reminder.mjs', '.claude/skills/daily-log/', '.github/workflows/daily-log',
    'docs/specs/daily-log.md', 'docs/procedures/daily-log.md', 'docs/decisions/0011-daily-log.md',
  ],
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const SECTION_KEYS = {
  決めたこと: 'decisions',
  '作ったもの・変えたもの': 'changes',
  次にやること: 'next',
  '未解決・判断待ち': 'pending',
  詰まったこと: 'blockers', // 任意（仕様 4.2）
  手応え: 'feel', // 任意。最初の箇条書きの先頭に 1〜5（仕様 4.2）
};

// ---------- 中核（純粋関数） ----------

// キット（日報の仕組み）自身のコミットは、作業の傾向に数えない（導入・更新、日報の自動更新、日報メモ、日報の設定）。
// ユーザーの作業ではないのに「似た作業の繰り返し」「日報メモの書き忘れ」に数えられ、記録を増やす方向に働くため
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
/** キット・日報のコミットか。件名が合う（キットの導入・更新、日報の自動更新、日報メモ）か、キットのファイルだけを変えた
 *  （CLAUDE.md と .claude/settings.json は、キットのファイルと一緒に変えたときだけキットのものとみなす） */
export function isKitCommit({ subject = '', files = [] }) {
  if (KIT_SUBJECT.test(subject)) return true;
  return files.length > 0 && files.every(isKitPath) && files.some((f) => f !== 'CLAUDE.md' && f !== '.claude/settings.json');
}
/** キット・日報だけのコミットのハッシュ。マージは1つ目の親との差分で判断する（日報メモだけの PR のマージも外れる） */
export function readKitHashes(root) {
  const set = new Set();
  const take = (raw) => {
    for (const b of (raw || '').split('\x1e')) {
      if (!b.trim()) continue;
      const [head, ...lines] = b.split('\n');
      const [hash, subject] = head.split('\x1f');
      if (isKitCommit({ subject, files: lines.map((s) => s.trim()).filter(Boolean) })) set.add(hash.trim());
    }
  };
  take(tryGit(['-c', 'core.quotepath=false', 'log', '--no-merges', '--name-only', '--format=%x1e%H%x1f%s'], root));
  take(tryGit(['-c', 'core.quotepath=false', 'log', '--merges', '--first-parent', '-m', '--name-only', '--format=%x1e%H%x1f%s'], root));
  return set;
}
/** 日報メモだけの PR（マージの差分が日報のフォルダだけ）で入った日報メモ。値は「YYYY-MM-DD/ファイル名」
 *  マージの記録などのためだけに書かれたメモなので、繰り返しの判別に数えない（仕様 4.3） */
export function readLogOnlyEntries(root, cfg = DEFAULT_CONFIG) {
  const set = new Set();
  const logDir = (cfg.logDir || 'docs/log') + '/';
  const entriesDir = (cfg.entriesDir || 'docs/log/entries') + '/';
  const raw = tryGit(['-c', 'core.quotepath=false', 'log', '--merges', '--first-parent', '-m', '--name-only', '--format=%x1e%H'], root) || '';
  for (const b of raw.split('\x1e')) {
    const files = b.split('\n').slice(1).map((s) => s.trim()).filter(Boolean);
    if (!files.length || !files.every((f) => f.startsWith(logDir))) continue;
    for (const f of files) if (f.startsWith(entriesDir)) set.add(f.slice(entriesDir.length));
  }
  return set;
}
/** analyzeRepo・引き継ぎで使う既定の除外（キット本体のリポジトリでは何も除かない） */
export function defaultExcludeCommit(root) {
  if (['install.mjs', 'bump-version.mjs', 'files/tools/daily-log.mjs'].every((f) => fs.existsSync(path.join(root, f)))) return null;
  const kit = readKitHashes(root);
  return ({ hash, subject }) => kit.has(hash) || KIT_SUBJECT.test(subject || '');
}
/** 「作ったもの・変えたもの」のうち、日報メモそのものを指す行（繰り返しの判別に数えない） */
export function isLogOnlyItem(text) {
  return /docs\/log\//.test(text) || /^日報メモ(を|の|$|\s)/.test(text.trim());
}

export function analysisConfig(cfg = {}) {
  return { ...ANALYSIS_DEFAULTS, ...(cfg.analysis || {}) };
}

/** コミットを時間の近さでまとめる（gap 分以内なら同じセッション） */
export function buildSessions(isoTimes, gapMinutes = 120, padMinutes = 30) {
  const ts = isoTimes.map((t) => new Date(t).getTime()).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  const sessions = [];
  for (const t of ts) {
    const cur = sessions.at(-1);
    if (cur && t - cur.end <= gapMinutes * 60_000) { cur.end = t; cur.commits++; } else sessions.push({ start: t, end: t, commits: 1 });
  }
  const minutes = sessions.reduce((s, x) => s + (x.end - x.start) / 60_000 + padMinutes, 0);
  return { count: sessions.length, estimatedHours: Math.round((minutes / 60) * 10) / 10, sessions };
}

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 日報メモの本文から4つの見出しの箇条書きを取り出す */
export function extractSections(body) {
  const out = { decisions: [], changes: [], next: [], pending: [], blockers: [], feel: [] };
  let key = null;
  let inFence = false;
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    // 「手応え（1〜5。任意）」のような補足のかっこは外して見る
    if (h) { key = SECTION_KEYS[h[1].trim().replace(/\s*[（(].*$/, '')] || null; continue; }
    const b = /^\s*[-*]\s+(.+)$/.exec(line);
    if (key && b && b[1].trim()) out[key].push(b[1].trim());
  }
  return out;
}

export function normalizeItem(s) {
  return String(s).replace(/（[^）]*推定[^）]*）/g, '').replace(/[\s。、，,．.・:：「」『』（）()]/g, '').toLowerCase();
}

/**
 * 「決めたこと」の「解決: <判断待ちの項目>」を取り出す。「解決: ボスの名前 → ヴォルクに決定」のように
 * 矢印（→ -> ⇒）の後ろに決めた内容を書いてよい。項目の部分だけを返す
 */
export function parseResolution(line) {
  const m = /^解決\s*[:：]\s*(.+)$/.exec(String(line || '').trim());
  if (!m) return null;
  const [item, ...rest] = m[1].split(/\s*(?:→|->|⇒)\s*/);
  const text = item.trim();
  return text ? { item: text, outcome: rest.join(' → ').trim() } : null;
}

/** 判断待ちと「解決:」の項目が同じか。同じ文、または一方がもう一方を含む（短い方が4文字以上） */
export function matchesPending(pendingText, resolvedText) {
  const a = normalizeItem(pendingText);
  const b = normalizeItem(resolvedText);
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.includes(s);
}

/**
 * 判断待ちを古いメモから順にたどる。同じ項目が複数のメモに出ていれば「繰り越し」とみなし、最初に出た日を持つ。
 * 「決めたこと」の「解決: <項目>」で解決済みにする。解決の後のメモにまた書かれたら、判断待ちに戻す
 */
function trackPending(memos) {
  const map = new Map();
  const order = (m) => m.day + ' ' + (m.meta?.time || '');
  for (const m of [...memos].sort((a, b) => order(a).localeCompare(order(b)))) {
    for (const text of m.sections.pending || []) {
      const k = normalizeItem(text);
      if (!k) continue;
      const cur = map.get(k) || { text, firstDay: m.day, lastDay: m.day, count: 0 };
      cur.lastDay = m.day; cur.count++; cur.text = text;
      delete cur.resolvedDay; delete cur.outcome;
      map.set(k, cur);
    }
    // 同じメモの判断待ちより後に処理する（同じメモで「解決:」と書いたら解決を優先）
    for (const line of m.sections.decisions || []) {
      const r = parseResolution(line);
      if (!r) continue;
      for (const cur of map.values()) {
        if (!cur.resolvedDay && matchesPending(cur.text, r.item)) { cur.resolvedDay = m.day; cur.outcome = r.outcome; }
      }
    }
  }
  return [...map.values()];
}

/**
 * 今の判断待ちの一覧。直近 recentDays 日のメモに出た項目のうち、「解決:」で解決していないもの。
 * 「解決:」を書かなくても、新しいメモに書かれなくなれば期間を過ぎて一覧から消える
 */
export function pendingItems(memos, today, recentDays = 14) {
  const since = addDays(today, -recentDays);
  return trackPending(memos).filter((x) => !x.resolvedDay && x.lastDay >= since)
    .map(({ resolvedDay, outcome, ...x }) => ({ ...x, ageDays: daysBetween(x.firstDay, today) }))
    .sort((a, b) => a.firstDay.localeCompare(b.firstDay) || a.text.localeCompare(b.text));
}

/** 直近 recentDays 日に「解決:」で解決した判断待ち（解決した日、決めた内容、判断待ちだった日数） */
export function resolvedItems(memos, today, recentDays = 14) {
  const since = addDays(today, -recentDays);
  return trackPending(memos).filter((x) => x.resolvedDay && x.resolvedDay >= since)
    .map((x) => ({ text: x.text, firstDay: x.firstDay, resolvedDay: x.resolvedDay, outcome: x.outcome || '', waitedDays: daysBetween(x.firstDay, x.resolvedDay) }))
    .sort((a, b) => a.resolvedDay.localeCompare(b.resolvedDay) || a.text.localeCompare(b.text));
}

/** 「手応え」の最初の箇条書きの先頭の 1〜5（「4」「4/5」「４（だいたい進んだ）」）。書かれていなければ null */
export function parseFeel(items = []) {
  const first = String(items[0] || '').trim().replace(/[１-５]/g, (c) => String(c.charCodeAt(0) - 0xff10));
  const m = /^([1-5])(?:\s*\/\s*5)?(?![0-9.])/.exec(first);
  return m ? Number(m[1]) : null;
}

/** 手応えのまとめ: 直近 recentDays 日の平均と件数、週ごと（月曜始まり）の平均 */
export function feelSummary(memos, today, recentDays = 14) {
  const since = addDays(today, -recentDays);
  const all = memos.map((m) => ({ day: m.day, feel: parseFeel(m.sections.feel) })).filter((x) => x.feel !== null);
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x.feel, 0) / xs.length) * 10) / 10 : null);
  const recent = all.filter((x) => x.day >= since);
  const weeks = new Map();
  for (const x of all) { const w = weekStart(x.day); weeks.set(w, [...(weeks.get(w) || []), x]); }
  return {
    recent: { count: recent.length, avg: avg(recent), low: recent.filter((x) => x.feel <= 2).map((x) => x.day) },
    weekly: [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, xs]) => ({ week, avg: avg(xs), count: xs.length })),
  };
}

/** 詰まったことのまとめ: 直近 recentDays 日の一覧と、windowDays 日のうち似た内容が minDays 日以上に出たもの */
export function blockerSummary(memos, today, { recentDays = 14, windowDays = 60, minDays = 2, threshold = 0.5 } = {}) {
  const items = (since) => memos.filter((m) => m.day >= since).flatMap((m) => (m.sections.blockers || []).map((text) => ({ text, day: m.day })));
  return {
    recent: items(addDays(today, -recentDays)).sort((a, b) => a.day.localeCompare(b.day)),
    repeated: clusterItems(items(addDays(today, -windowDays)), threshold).filter((c) => c.days.length >= minDays)
      .sort((x, y) => y.days.length - x.days.length || y.count - x.count),
  };
}

/** addDays の再公開（daily-log-brief.mjs から使う） */
export function addDaysSafe(day, n) { return addDays(day, n); }

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

export function isFixCommit(subject) {
  return /^(fix|hotfix|revert)(\(.+\))?!?:/i.test(subject) || /^Revert "/.test(subject) || /(修正|不具合|バグ)/.test(subject);
}

export function hourBuckets(isoTimes, tz) {
  const b = new Array(8).fill(0); // 0-2,3-5,...,21-23
  for (const t of isoTimes) b[Math.floor(Number(localParts(t, tz).time.slice(0, 2)) / 3)]++;
  return b;
}

export function weekdayCounts(days) {
  const w = new Array(7).fill(0);
  for (const d of days) w[WEEKDAYS.indexOf(weekdayOf(d))]++;
  return w;
}

export function lateNightRatio(isoTimes, tz, start = 0, end = 4) {
  if (!isoTimes.length) return 0;
  const n = isoTimes.filter((t) => { const h = Number(localParts(t, tz).time.slice(0, 2)); return h >= start && h < end; }).length;
  return n / isoTimes.length;
}

/** 週ごと（月曜始まり）の件数。直近 weeks 週 */
export function weeklySeries(dayCounts, today, weeks = 12) {
  const dow = (WEEKDAYS.indexOf(weekdayOf(today)) + 6) % 7; // 月=0
  const thisMonday = addDays(today, -dow);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisMonday, -7 * i);
    const end = addDays(start, 6);
    let commits = 0, memos = 0;
    for (const [d, v] of dayCounts) if (d >= start && d <= end) { commits += v.commits; memos += v.memos; }
    out.push({ week: start, commits, memos });
  }
  const first = out.findIndex((w) => w.commits || w.memos);
  return first < 0 ? out.slice(-1) : out.slice(first);
}

/** 集計済みの指標から改善点を出す。各項目に根拠の数値と、次にやることを付ける */
export function detectFindings(m, a = ANALYSIS_DEFAULTS) {
  const f = [];
  const pct = (x) => `${Math.round(x * 100)}%`;
  if (m.memoCoverage && m.memoCoverage.commitDays >= 3 && m.memoCoverage.ratio < a.memoCoverageMin) {
    f.push({ id: 'memo-coverage', level: '注意', title: '日報メモの書き忘れ',
      evidence: `日報の仕組みを入れた ${m.memoCoverage.since} 以降、コミットのあった ${m.memoCoverage.commitDays}日のうちメモがあるのは ${m.memoCoverage.withMemo}日（${pct(m.memoCoverage.ratio)}）${m.memoCoverage.preInstallCommits ? `。導入前のコミット ${m.memoCoverage.preInstallCommits}件は記録の対象外` : ''}`,
      action: 'Stop フックが効いているか（.claude/settings.json）を確認し、PCで作業した日は「日報を書いて」と頼む' });
  }
  if (m.commits >= 10 && m.lateNight.ratio >= a.lateNightRatioMax) {
    f.push({ id: 'late-night', level: '注意', title: '深夜（0〜4時）のコミットが多い',
      evidence: `コミットの ${pct(m.lateNight.ratio)}（${m.lateNight.count}件）が深夜。深夜のコミットはバグを含みやすいという研究がある（Eyolfson et al. 2011）`,
      action: '深夜に作ったPRは翌朝に差分を見直してからマージする' });
  }
  if (m.prLeadTime.count >= 3 && m.prLeadTime.medianDays > a.prLeadTimeDaysMax) {
    f.push({ id: 'pr-lead-time', level: '注意', title: 'PRがマージまで長い',
      evidence: `PRの最初のコミットからマージまでの中央値 ${formatDuration(m.prLeadTime.medianDays)}（${m.prLeadTime.count}本）`,
      action: '1つのPRを作業キュー1項目に絞り、小さく分けてマージする' });
  }
  if (m.staleBranches.length) {
    f.push({ id: 'stale-branches', level: '注意', title: `放置されたブランチが ${m.staleBranches.length}本`,
      evidence: m.staleBranches.slice(0, 5).map((b) => `${b.name}（${b.ageDays}日前）`).join('、'),
      action: '不要なら GitHub でブランチを削除する。続けるならPRにして作業キューに戻す' });
  }
  if (m.largeCommits.length) {
    f.push({ id: 'large-commits', level: '情報', title: `大きなコミットが ${m.largeCommits.length}件`,
      evidence: m.largeCommits.slice(0, 3).map((c) => `${c.day} ${c.subject}（${c.files}ファイル、${c.lines}行）`).join('、'),
      action: '素材やデータの一括取り込みなら問題ない。コードなら機能ごとにコミットを分けると、後で原因を追いやすい' });
  }
  if (m.recent.commits >= 10 && m.recent.fixRatio >= a.fixRatioMax) {
    f.push({ id: 'fix-ratio', level: '注意', title: '直近の修正コミットの割合が高い',
      evidence: `直近${a.recentDays}日のコミット ${m.recent.commits}件のうち修正が ${pct(m.recent.fixRatio)}`,
      action: '同じ箇所の修正が続いていないか確認し、テストや検査を作業キューに追加する' });
  }
  const carried = m.pending.filter((p) => p.count >= 2 && p.ageDays >= a.pendingCarryDays);
  if (carried.length) {
    f.push({ id: 'pending-carry', level: '注意', title: `判断待ちが ${a.pendingCarryDays}日以上繰り越し（${carried.length}件）`,
      evidence: carried.slice(0, 5).map((p) => `「${p.text}」（${p.firstDay}から）`).join('、'),
      action: '次のチャットで決めるか、期限を決めて SPEC.md の未決事項に移す' });
  }
  if (m.pcTasks.length >= a.pcTasksMax) {
    f.push({ id: 'pc-tasks', level: '注意', title: `PCでしかできない作業が ${m.pcTasks.length}件たまっている`,
      evidence: m.pcTasks.slice(0, 5).map((t) => t.text).join('、'),
      action: 'PCで作業する日を決めてまとめて片付ける' });
  }
  const rep = { repeatedWork: [], prepRepeats: [], carriedNext: [], fixHotspots: [], ...(m.repetition || {}) };
  if (rep.prepRepeats.length) {
    f.push({ id: 'repeated-prep', level: '提案', title: `同じ種類の準備作業を繰り返している（${rep.prepRepeats.length}種類）`,
      evidence: rep.prepRepeats.slice(0, 3).map((p) => `「${p.keyword}」が${p.days.length}日（例: ${p.examples[0]}）`).join('、'),
      action: '手順を1つのスクリプトか Skill にまとめる。毎回のセッションで必要な準備なら SessionStart フックに入れる' });
  }
  if (rep.repeatedWork.length) {
    f.push({ id: 'repeated-work', level: '提案', title: `繰り返している作業が ${rep.repeatedWork.length}件（自動化の候補）`,
      evidence: rep.repeatedWork.slice(0, 3).map((w) => `「${w.text}」（${w.days.length}日）`).join('、'),
      action: suggestFor(rep.repeatedWork[0]) });
  }
  if (rep.carriedNext.length) {
    f.push({ id: 'carried-next', level: '注意', title: `何度も繰り越されている「次にやること」が ${rep.carriedNext.length}件`,
      evidence: rep.carriedNext.slice(0, 3).map((c) => `「${c.text}」（${c.count}回、${c.firstDay}から）`).join('、'),
      action: '着手できない理由（PCが要る、判断待ち、準備が足りない）を確かめ、作業キューに戻すか分割する' });
  }
  if (rep.fixHotspots.length) {
    f.push({ id: 'fix-hotspot', level: '注意', title: `同じファイルの修正が続いている（${rep.fixHotspots.length}件）`,
      evidence: rep.fixHotspots.slice(0, 3).map((h) => `${h.file}（直近${a.hotspotDays}日で修正${h.fixes}回）`).join('、'),
      action: 'そのファイルの単体テストか検査を作業キューに追加する' });
  }
  const feel = m.feel?.recent;
  if (feel && feel.count >= a.lowFeelMinMemos && feel.avg !== null && feel.avg <= a.lowFeelAvg) {
    f.push({ id: 'low-feel', level: '注意', title: '手応えが低めの日が続いている',
      evidence: `直近${a.recentDays}日の手応えの平均 ${feel.avg}（${feel.count}件。2以下の日: ${feel.low.slice(-5).join('、') || 'なし'}）。自分で付けた目安で、評価には使わない`,
      action: '「詰まったこと」を見直し、作業を小さく分けるか、準備・進め方・休み方を変える' });
  }
  const blk = m.blockers?.repeated || [];
  if (blk.length) {
    f.push({ id: 'repeated-blocker', level: '注意', title: `同じことで何度も詰まっている（${blk.length}件）`,
      evidence: blk.slice(0, 3).map((b) => `「${b.text}」（${b.days.length}日、${b.firstDay}から）`).join('、'),
      action: '対処（手順書、スクリプト、調べもの、相談）を作業キューに1件入れる' });
  }
  if (m.lastActiveDay && m.daysSinceActive >= a.inactiveDays) {
    f.push({ id: 'inactive', level: '情報', title: `${m.daysSinceActive}日間作業がない`,
      evidence: `最後の作業日 ${m.lastActiveDay}`,
      action: '再開するときは docs/log/README.md と最新の日報メモの「次にやること」から始める' });
  }
  return f;
}

export function formatDuration(days) {
  if (days == null) return '—';
  const h = days * 24;
  if (h < 1) return '1時間未満';
  if (h < 48) return `約${Math.round(h)}時間`;
  return `約${Math.round(days * 10) / 10}日`;
}

// ---------- 繰り返しの判別 ----------

const PREP_WORDS = /(pull|clone|install|インストール|導入|登録|起動|再起動|設定|展開|コピー|配置|ログイン|認証|取り込み|更新|同期|ビルド|書き出し|エクスポート|準備)/i;
// 対象が違っても同じ種類の手作業を見つけるための言葉（「更新」「追加」のような一般的すぎる言葉は入れない）
export const PREP_KEYWORDS = ['再起動', '起動', '登録', '設定', '展開', 'コピー', '配置', 'ログイン', '認証', '取り込み', '同期', 'ビルド', '書き出し', 'エクスポート', 'インストール', 'install', 'pull', 'clone'];

/** 日報メモの「作ったもの・変えたもの」に、同じ準備作業の言葉が何日出ているか */
export function prepKeywordRepeats(items, minDays = 3) {
  const map = new Map();
  for (const it of items) {
    const low = it.text.toLowerCase();
    const hit = PREP_KEYWORDS.filter((k) => low.includes(k.toLowerCase()));
    const words = hit.filter((k) => !hit.some((o) => o !== k && o.includes(k))); // 「再起動」があれば「起動」は数えない
    for (const k of words) {
      const v = map.get(k) || { keyword: k, days: new Set(), examples: [] };
      v.days.add(it.day);
      if (v.examples.length < 3 && !v.examples.includes(it.text)) v.examples.push(it.text);
      map.set(k, v);
    }
  }
  return [...map.values()].filter((v) => v.days.size >= minDays)
    .map((v) => ({ keyword: v.keyword, days: [...v.days].sort(), examples: v.examples }))
    .sort((x, y) => y.days.length - x.days.length);
}

/** 比べるための正規化（作業キューの番号、PR番号、数字、記号、「（PC）」を除く） */
export function simKey(s) {
  return String(s).replace(/[（(]PC[）)]/g, '').replace(/(?<![\w-])[A-Z]{1,2}-?\d{1,3}(?![\w-])/g, '')
    .replace(/#\d+/g, '').replace(/^\s*\w+(\([^)]*\))?!?:\s*/, '').replace(/[0-9０-９]+/g, '')
    .replace(/[\s。、，,．.・:：「」『』（）()\[\]【】"'`/\\|~〜\-_+*=]/g, '').toLowerCase();
}

function bigrams(s) {
  if (s.length < 2) return new Set(s ? [s] : []);
  const g = new Set();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}

function jaccard(p, q) {
  const x = bigrams(p), y = bigrams(q);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const v of x) if (y.has(v)) inter++;
  return inter / (x.size + y.size - inter);
}

/** 内容の言葉だけ（ひらがなの助詞・送り仮名を除く）。「画像1体の取り込み」と「画像を1体取り込む」を同じにする */
export function contentKey(s) {
  return simKey(s).replace(/[\u3041-\u309f]/g, '');
}

/**
 * 2つの文の似ている度合い（0〜1）。日本語でも使えるよう、2文字ずつの組の一致率で測る。
 * 文そのものと、内容の言葉だけの両方で比べ、高い方を使う（言い換えに強くする）
 */
export function similarity(a, b) {
  const ka = simKey(a), kb = simKey(b);
  const full = jaccard(ka, kb);
  // 英字だけの文（例: コミットの件名「D14: CF_EscapeItems」）と日本語を含む文は、名前が同じでも作業が違うことが多い。
  // ほぼ同じ文のときだけ同じ作業とみなす
  if (/[^\x00-\x7f]/.test(ka) !== /[^\x00-\x7f]/.test(kb)) return full >= 0.8 ? full : 0;
  const ca = contentKey(a), cb = contentKey(b);
  return ca.length >= 2 && cb.length >= 2 ? Math.max(full, jaccard(ca, cb)) : full;
}

/** 似た項目をまとめる。items: [{ text, day }] */
export function clusterItems(items, threshold = 0.5) {
  const clusters = [];
  for (const it of [...items].sort((a, b) => a.day.localeCompare(b.day))) {
    if (!simKey(it.text)) continue;
    let best = null, bestSim = 0;
    for (const c of clusters) { const s = similarity(c.rep, it.text); if (s > bestSim) { bestSim = s; best = c; } }
    if (best && bestSim >= threshold) { best.items.push(it); best.days.add(it.day); best.latest = it.text; }
    else clusters.push({ rep: it.text, latest: it.text, items: [it], days: new Set([it.day]) });
  }
  return clusters.map((c) => ({
    text: c.latest, count: c.items.length, days: [...c.days].sort(), firstDay: [...c.days].sort()[0], lastDay: [...c.days].sort().at(-1),
    examples: [...new Set(c.items.map((i) => i.text))].slice(-3),
  }));
}

/**
 * 繰り返しの判別
 * - repeatedWork: 日報メモの「作ったもの・変えたもの」とコミットの件名で、似た作業が何日も出ているもの（自動化の候補）
 * - carriedNext: 同じ「次にやること」が何回も繰り越されているもの（準備不足や詰まりの兆し）
 * - fixHotspots: 同じファイルへの修正コミットが続いているもの（テストや検査の候補）
 */
export function detectRepetition({ memos = [], commits = [], fixFiles = [], today, a = ANALYSIS_DEFAULTS, latestNext = [] }) {
  const since = addDays(today, -a.repeatWindowDays);
  const workMemos = memos.filter((m) => m.day >= since && !m.logOnly); // 日報メモだけの PR で入ったメモは数えない
  const work = [
    ...workMemos.flatMap((m) => m.sections.changes.filter((t) => !isLogOnlyItem(t)).map((text) => ({ text, day: m.day, src: 'memo' }))),
    ...commits.filter((c) => c.day >= since && !/^docs\(log\)|^Merge /.test(c.subject)).map((c) => ({ text: c.subject, day: c.day, src: 'commit' })),
  ];
  const repeatedWork = clusterItems(work, a.similarity).filter((c) => c.days.length >= a.repeatMinDays)
    .map((c) => ({ ...c, prep: PREP_WORDS.test(c.text) }))
    .sort((x, y) => y.days.length - x.days.length || y.count - x.count);
  const latestKeys = latestNext.map((t) => t);
  const carriedNext = clusterItems(memos.filter((m) => !m.logOnly).flatMap((m) => m.sections.next.map((text) => ({ text, day: m.day }))), a.similarity)
    .filter((c) => c.count >= a.carryMinCount && c.days.length >= a.carryMinDays)
    .filter((c) => !latestKeys.length || latestKeys.some((t) => similarity(t, c.text) >= a.similarity))
    .sort((x, y) => y.count - x.count);
  const counts = new Map();
  for (const f of fixFiles) for (const file of f.files) counts.set(file, (counts.get(file) || 0) + 1);
  const fixHotspots = [...counts].filter(([, n]) => n >= a.hotspotFixes).map(([file, fixes]) => ({ file, fixes })).sort((x, y) => y.fixes - x.fixes);
  const memoChanges = workMemos.flatMap((m) => m.sections.changes.filter((t) => !isLogOnlyItem(t)).map((text) => ({ text, day: m.day })));
  const prepRepeats = prepKeywordRepeats(memoChanges, a.repeatMinDays);
  return { repeatedWork, prepRepeats, carriedNext, fixHotspots };
}

export function suggestFor(item) {
  return item.prep
    ? '毎回の準備作業なら、スクリプト（例: tools/setup.ps1）か SessionStart フックで自動化する'
    : '同じ手順の繰り返しなら、Skill（.claude/skills/）か npm スクリプトにまとめる';
}

function bar(n, max, width = 20) {
  if (!max) return '';
  return '█'.repeat(Math.round((n / max) * width)) || (n ? '▏' : '');
}

export function renderReport(results, { today, generatedFor } = {}) {
  const out = [];
  out.push('# 作業の分析', '');
  out.push(`<!-- tools/daily-log-analyze.mjs が生成（基準日 ${today}）。数値は傾向をつかむ目安で、成果の評価には使わない -->`, '');
  if (results.length > 1) {
    out.push('## リポジトリ別の概要', '', '| リポジトリ | 期間 | 作業日 | コミット | PR | 日報メモ | メモ記録率 | 深夜率 | 改善点 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const r of results) {
      const m = r.metrics;
      out.push(`| ${r.name} | ${m.period.from}〜${m.period.to} | ${m.activeDays} | ${m.commits} | ${m.prs} | ${m.memos} | ${m.memoCoverage?.commitDays ? Math.round(m.memoCoverage.ratio * 100) + '%' : '—'} | ${Math.round(m.lateNight.ratio * 100)}% | ${r.findings.length} |`);
    }
    out.push('');
  }
  for (const r of results) {
    const m = r.metrics;
    const h = results.length > 1 ? '###' : '##';
    if (results.length > 1) out.push(`## ${r.name}`, '');
    out.push(`${h} 概要`, '');
    out.push('| 項目 | 値 |', '| --- | --- |');
    out.push(`| 期間 | ${m.period.from}〜${m.period.to}（${m.period.days}日） |`);
    out.push(`| 作業日 | ${m.activeDays}日（コミットのある日 ${m.commitDays}日、メモだけの日 ${m.memoOnlyDays}日） |`);
    out.push(`| コミット / PR / 日報メモ | ${m.commits}件 / ${m.prs}本 / ${m.memos}件 |`);
    out.push(`| 作業のまとまり（推定） | ${m.sessions.count}回、約${m.sessions.estimatedHours}時間（コミットの間隔から推定した目安） |`);
    const cov = m.memoCoverage;
    out.push(`| 日報メモの記録率 | ${!cov ? 'メモなし' : cov.commitDays ? `${Math.round(cov.ratio * 100)}%（導入した ${cov.since} 以降、コミットのあった ${cov.commitDays}日のうち ${cov.withMemo}日）` : `対象の日なし（導入した ${cov.since} 以降、日報の仕組み以外のコミットがない）`}${cov?.preInstallCommits ? `。導入前のコミット ${cov.preInstallCommits}件は記録の対象外` : ''} |`);
    out.push(`| 深夜（0〜4時）のコミット | ${Math.round(m.lateNight.ratio * 100)}%（${m.lateNight.count}件） |`);
    out.push(`| PRの最初のコミットからマージまで（中央値） | ${m.prLeadTime.count ? `${formatDuration(m.prLeadTime.medianDays)}（${m.prLeadTime.count}本）` : '—（マージコミットなし）'} |`);
    out.push(`| 最後の作業日 | ${m.lastActiveDay || '—'}${m.lastActiveDay ? `（${m.daysSinceActive}日前）` : ''} |`, '');

    out.push(`${h} 改善点`, '');
    if (!r.findings.length) out.push('検出なし', '');
    for (const x of r.findings) out.push(`- **[${x.level}] ${x.title}**`, `  - 根拠: ${x.evidence}`, `  - 次にやること: ${x.action}`);
    if (r.findings.length) out.push('');

    out.push(`${h} 判断待ち（直近のメモ）`, '');
    if (!m.pending.length) out.push('なし', '');
    else {
      out.push('| 項目 | 最初に出た日 | メモに出た回数 |', '| --- | --- | ---: |');
      for (const p of m.pending) out.push(`| ${p.text.replace(/\|/g, '｜')} | ${p.firstDay} | ${p.count} |`);
      out.push('');
    }
    if (m.resolved?.length) {
      out.push(`${h} 解決した判断待ち（直近のメモ）`, '', '| 項目 | 決めた内容 | 最初に出た日 | 解決した日 |', '| --- | --- | --- | --- |');
      for (const p of m.resolved) out.push(`| ${p.text.replace(/\|/g, '｜')} | ${(p.outcome || '—').replace(/\|/g, '｜')} | ${p.firstDay} | ${p.resolvedDay} |`);
      out.push('');
    }
    if (m.feel?.recent.count || m.blockers?.recent.length) {
      out.push(`${h} 手応えと詰まったこと（直近のメモ）`, '');
      if (m.feel?.recent.count) {
        out.push(`手応えの平均 ${m.feel.recent.avg}（${m.feel.recent.count}件、1〜5）。自分で付けた目安で、比べたり評価したりしない`, '');
        if (m.feel.weekly.length > 1) {
          out.push('| 週（月曜） | 手応えの平均 | 件数 |', '| --- | ---: | ---: |');
          for (const w of m.feel.weekly.slice(-8)) out.push(`| ${w.week} | ${w.avg} | ${w.count} |`);
          out.push('');
        }
      }
      if (m.blockers?.recent.length) out.push(...m.blockers.recent.map((b) => `- ${b.day} ${b.text}`), '');
    }
    out.push(`${h} 次にやること（最新のメモ）`, '');
    if (!m.latestNext.items.length) out.push('なし', '');
    else out.push(`${m.latestNext.day} のメモより`, '', ...m.latestNext.items.map((t) => `- ${t}`), '');
    if (m.pcTasks.length) {
      out.push(`${h} PCでしかできない作業（直近のメモ）`, '', ...m.pcTasks.map((t) => `- ${t.text}（${t.day}）`), '');
    }

    const rep = { repeatedWork: [], prepRepeats: [], carriedNext: [], fixHotspots: [], ...(m.repetition || {}) };
    out.push(`${h} 繰り返しと効率化の候補`, '');
    if (!rep.repeatedWork.length && !rep.prepRepeats.length && !rep.carriedNext.length && !rep.fixHotspots.length) out.push('検出なし', '');
    else {
      out.push('| 種類 | 内容 | 根拠 | 次にやること |', '| --- | --- | --- | --- |');
      const esc = (s) => String(s).replace(/\|/g, '｜');
      for (const p of rep.prepRepeats) out.push(`| 準備作業の繰り返し | 「${esc(p.keyword)}」を含む作業（例: ${esc(p.examples.join(' / '))}） | ${p.days.length}日（${p.days.slice(-3).join('、')}） | 手順を1つのスクリプトか Skill にまとめる |`);
      for (const w of rep.repeatedWork) out.push(`| ${w.prep ? '準備作業の繰り返し' : '作業の繰り返し'} | ${esc(w.examples.join(' / '))} | ${w.days.length}日（${w.days.slice(-3).join('、')}） | ${suggestFor(w)} |`);
      for (const c of rep.carriedNext) out.push(`| 繰り越し | ${esc(c.text)} | ${c.count}回（${c.firstDay}から） | 着手できない理由を確かめる |`);
      for (const x of rep.fixHotspots) out.push(`| 修正の集中 | ${esc(x.file)} | 修正${x.fixes}回 | テストか検査を追加 |`);
      out.push('');
    }
    out.push(`${h} 週ごとの推移（直近12週のうち作業のあった週から）`, '', '| 週（月曜） | コミット | 日報メモ |', '| --- | --- | --- |');
    const maxW = Math.max(...m.weekly.map((w) => w.commits), 1);
    for (const w of m.weekly) out.push(`| ${w.week} | ${String(w.commits).padStart(3)} ${bar(w.commits, maxW, 15)} | ${w.memos} |`);
    out.push('');
    out.push(`${h} 曜日と時間帯`, '', '| 曜日 | 作業日 |   | 時間帯 | コミット |', '| --- | --- | --- | --- | --- |');
    const maxD = Math.max(...m.weekdays, 1);
    const maxH = Math.max(...m.hours, 1);
    for (let i = 0; i < 8; i++) {
      const wd = i < 7 ? `${WEEKDAYS[i]} | ${String(m.weekdays[i]).padStart(3)} ${bar(m.weekdays[i], maxD, 10)}` : ' | ';
      out.push(`| ${wd} |   | ${String(i * 3).padStart(2, '0')}-${String(i * 3 + 2).padStart(2, '0')}時 | ${String(m.hours[i]).padStart(3)} ${bar(m.hours[i], maxH, 10)} |`);
    }
    out.push('');
    if (m.recentDecisions.length) {
      out.push(`${h} 最近の決定（日報メモの「決めたこと」）`, '', ...m.recentDecisions.map((d) => `- ${d.day} ${d.text}`), '');
    }
  }
  out.push('## 数値の読み方', '',
    '- 作業日は日報と同じ区切り（`docs/log/config.json` の `dayStartHour`）。深夜率は時計どおりの0〜4時で数える',
    '- 作業のまとまりは、コミットの間隔が一定時間以内なら同じ作業とみなした推定。コミットしない作業（調べもの、チャット）は入らない',
    '- 件数は作業の量の目安で、成果や生産性の評価には使わない（SPACE フレームワーク: 活動量の指標を単独で使わない）',
    '- 判断待ちは、直近のメモに書かれている項目。解決したら「決めたこと」に「解決: <項目>」と書くと一覧から外れる（書かなくても、新しいメモに書かれなくなれば期間を過ぎて消える）');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ---------- 入出力 ----------

// ---------- 週1回の Issue（.github/workflows/daily-log-weekly.yml が使う） ----------

export const ISSUE_TITLE_PREFIX = '日報の分析（';
const ISSUE_BODY_MAX = 60000; // GitHub の Issue 本文の上限（65,536文字）より少なく

/** その週の月曜日（YYYY-MM-DD） */
export function weekStart(day) {
  const d = new Date(day + 'T00:00:00Z');
  const back = (d.getUTCDay() + 6) % 7; // 月曜なら0、日曜なら6
  return addDays(day, -back);
}

/** Issue の件名。同じ週なら同じ件名になる（同じ週に2回動いたら、作り直さずに本文を更新するため） */
export function issueTitle(today) {
  return `${ISSUE_TITLE_PREFIX}${weekStart(today)} の週）`;
}

/** Issue の本文。レポートの前に読み方と止め方を書き、長すぎれば末尾を切る */
export function issueBody(report, { today } = {}) {
  const lead = [
    `> daily-log-kit の週1回の分析（${today || ''} 時点）。数値は作業の傾向をつかむ目安で、成果や生産性の評価には使わない。`,
    '> 改善点は確認のきっかけ。理由があれば対応しなくてよい。止めるときは `docs/log/config.json` の `"weeklyIssue"` を `false` にする。',
    '', '',
  ].join('\n');
  let text = lead + report;
  if (text.length > ISSUE_BODY_MAX) text = text.slice(0, ISSUE_BODY_MAX) + '\n\n（長いため、ここで切りました。全体は `node tools/daily-log-analyze.mjs` で見られます）\n';
  return text;
}

/** config.json の weeklyIssue が true のときだけ有効（既定は無効） */
export function weeklyIssueEnabled(cfg = {}) {
  return cfg.weeklyIssue === true;
}

export function parseAnalyzeArgs(argv) {
  const bool = new Set(['json', 'help', 'issue']);
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      if (bool.has(k)) a[k] = true;
      else a[k] = argv[++i];
    } else a._.push(t);
  }
  return a;
}

function readNumstat(root, ignore) {
  const raw = tryGit(['log', '--no-merges', '--numstat', '--format=%x1e%H%x1f%aI%x1f%s'], root) || '';
  const res = [];
  for (const block of raw.split('\x1e').filter((b) => b.trim())) {
    const [head, ...lines] = block.split('\n');
    const [hash, date, subject] = head.split('\x1f');
    let files = 0, n = 0;
    for (const l of lines) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
      if (!m || ignore.some((p) => m[3].startsWith(p) || m[3].endsWith('/' + p) || m[3] === p)) continue;
      files++;
      n += (m[1] === '-' ? 0 : Number(m[1])) + (m[2] === '-' ? 0 : Number(m[2]));
    }
    res.push({ hash, date, subject, files, lines: n });
  }
  return res;
}

/** 直近の修正コミットで変更されたファイル（同じ箇所の修正が続いていないかを見る） */
export function readFixFiles(root, sinceIso, ignore = [], { maxFiles = Infinity, excludeCommit = null } = {}) {
  const raw = tryGit(['log', '--no-merges', `--since=${sinceIso}`, '--name-only', '--format=%x1e%H%x1f%s'], root) || '';
  return raw.split('\x1e').filter((b) => b.trim()).map((b) => {
    const [head, ...lines] = b.split('\n');
    const [hash, subject] = head.split('\x1f');
    const all = lines.map((s) => s.trim()).filter(Boolean);
    return { hash, subject, total: all.length, files: all.filter((f) => !ignore.some((p) => f.startsWith(p) || f === p)) };
  }).filter((x) => isFixCommit(x.subject) && x.total <= maxFiles && !(excludeCommit && excludeCommit(x)))
    .map(({ subject, files }) => ({ subject, files }));
}

function prLeadTimes(root, commits) {
  const days = [];
  for (const c of commits) {
    if (c.parents.length < 2 || !prInfo(c)) continue;
    const firsts = (tryGit(['log', '--format=%aI', `${c.parents[0]}..${c.parents[1]}`], root) || '').split('\n').filter(Boolean);
    if (!firsts.length) continue;
    const first = Math.min(...firsts.map((t) => Date.parse(t)));
    days.push((Date.parse(c.date) - first) / 86_400_000);
  }
  return days;
}

function staleBranches(root, cfg, a, todayIso) {
  const base = findBase(root, cfg);
  if (!base || !base.startsWith('origin/')) return [];
  const unmerged = new Set((tryGit(['branch', '-r', '--no-merged', base], root) || '').split('\n').map((s) => s.trim()).filter(Boolean));
  const refs = (tryGit(['for-each-ref', '--format=%(refname:short)%09%(committerdate:iso-strict)', 'refs/remotes/origin'], root) || '').split('\n').filter(Boolean);
  const out = [];
  for (const line of refs) {
    const [name, date] = line.split('\t');
    if (!unmerged.has(name) || name === base || name.endsWith('/HEAD')) continue;
    const ageDays = Math.floor((Date.parse(todayIso) - Date.parse(date)) / 86_400_000);
    if (ageDays >= a.staleBranchDays) out.push({ name, ageDays });
  }
  return out.sort((x, y) => y.ageDays - x.ageDays);
}

export function analyzeRepo(root, opts = {}) {
  const cfg = loadConfig(root);
  const a = analysisConfig(cfg);
  const nowIso = opts.now || new Date().toISOString();
  const today = opts.today || dayKey(nowIso, cfg);
  // opts.excludeCommit({ hash, subject }) が true のコミットを数えない。省略するとキット・日報だけのコミットを除く（null なら何も除かない）
  const exclude = opts.excludeCommit === undefined ? defaultExcludeCommit(root) : opts.excludeCommit;
  const keep = (c) => !(exclude && exclude({ hash: c.hash, subject: c.subject || '' }));
  let commits = readCommits(root, 'HEAD', cfg).filter(keep);
  const entries = readEntries(root, cfg);
  const inRange = (d) => (!opts.since || d >= opts.since) && (!opts.until || d <= opts.until);
  commits = commits.filter((c) => inRange(dayKey(c.date, cfg)));
  const logOnly = exclude ? readLogOnlyEntries(root, cfg) : new Set();
  const memos = [];
  for (const [day, list] of entries) if (inRange(day)) for (const e of list) memos.push({ day, meta: e.meta, sections: extractSections(e.body), logOnly: logOnly.has(`${day}/${e.file}`) });

  const nonMerge = commits.filter((c) => c.parents.length <= 1);
  const times = nonMerge.map((c) => c.date);
  const dayCounts = new Map();
  for (const c of commits) { const d = dayKey(c.date, cfg); const v = dayCounts.get(d) || { commits: 0, memos: 0 }; v.commits++; dayCounts.set(d, v); }
  for (const m of memos) { const v = dayCounts.get(m.day) || { commits: 0, memos: 0 }; v.memos++; dayCounts.set(m.day, v); }
  const days = [...dayCounts.keys()].sort();
  const commitDays = days.filter((d) => dayCounts.get(d).commits > 0);
  // 記録率は、マージ以外のコミットがある日で数える（PR のマージだけの日は作業ではなく、メモを書かない日。仕様 4.3、v1.10.4）
  const memoDays = new Set(memos.map((m) => m.day));

  // 記録率は「日報の仕組みを入れた日」以降で数える（後から補った過去のメモで起点が早まらないように）
  let memoCoverage = null;
  if (memos.length) {
    const installed = (tryGit(['log', '--diff-filter=A', '--format=%aI', '--', 'tools/daily-log.mjs'], root) || '').split('\n').filter(Boolean).at(-1);
    const since = installed ? dayKey(installed, cfg) : [...memoDays].sort()[0];
    // 導入より前のコミットは記録の対象外（メモを書く仕組みがまだない。導入日の導入前のコミットも外す。v1.10.5）。件数は数えて示す
    const installedMs = installed ? Date.parse(installed) : null;
    const afterInstall = (c) => (installedMs === null ? dayKey(c.date, cfg) >= since : Date.parse(c.date) >= installedMs);
    const preInstallCommits = nonMerge.filter((c) => !afterInstall(c)).length;
    const targetDays = new Set(nonMerge.filter(afterInstall).map((c) => dayKey(c.date, cfg)));
    const target = [...targetDays].sort();
    const withMemo = target.filter((d) => memoDays.has(d)).length;
    memoCoverage = { since, commitDays: target.length, withMemo, ratio: target.length ? withMemo / target.length : 1, preInstallCommits };
  }
  const recentSince = addDays(today, -a.recentDays);
  const recentCommits = nonMerge.filter((c) => dayKey(c.date, cfg) >= recentSince);
  const lead = prLeadTimes(root, commits);
  const numstat = readNumstat(root, a.ignorePaths).filter((c) => inRange(dayKey(c.date, cfg)) && keep(c));
  const largeCommits = numstat.filter((c) => c.lines >= a.largeCommitLines || c.files >= a.largeCommitFiles)
    .map((c) => ({ day: dayKey(c.date, cfg), subject: c.subject, files: c.files, lines: c.lines }))
    .sort((x, y) => y.lines - x.lines);
  const latestMemo = [...memos].sort((x, y) => (x.day + (x.meta.time || '')).localeCompare(y.day + (y.meta.time || ''))).at(-1);
  const pcTasks = memos.filter((m) => m.day >= recentSince)
    .flatMap((m) => m.sections.next.filter((t) => /[（(]PC[）)]/.test(t)).map((text) => ({ day: m.day, text })));
  const pcUnique = [...new Map(pcTasks.map((t) => [normalizeItem(t.text), t])).values()];
  const lastActiveDay = days.at(-1) || null;
  const repetition = detectRepetition({
    memos, today, a, latestNext: latestMemo?.sections.next || [],
    commits: nonMerge.map((c) => ({ subject: c.subject, day: dayKey(c.date, cfg) })),
    fixFiles: readFixFiles(root, new Date(Date.parse(today + 'T00:00:00Z') - a.hotspotDays * 86_400_000).toISOString(), a.ignorePaths,
      { maxFiles: a.hotspotMaxFiles, excludeCommit: exclude || null }),
  });

  const metrics = {
    period: { from: days[0] || today, to: lastActiveDay || today, days: days.length ? daysBetween(days[0], lastActiveDay) + 1 : 0 },
    activeDays: days.length, commitDays: commitDays.length, memoOnlyDays: days.length - commitDays.length,
    commits: commits.length, prs: commits.filter(prInfo).length, memos: memos.length,
    sessions: (({ count, estimatedHours }) => ({ count, estimatedHours }))(buildSessions(times, a.sessionGapMinutes, a.sessionPadMinutes)),
    memoCoverage,
    lateNight: { ratio: lateNightRatio(times, cfg.tz, a.lateNightStartHour, a.lateNightEndHour), count: Math.round(lateNightRatio(times, cfg.tz, a.lateNightStartHour, a.lateNightEndHour) * times.length) },
    prLeadTime: { count: lead.length, medianDays: lead.length ? Math.round(median(lead) * 1000) / 1000 : null },
    staleBranches: staleBranches(root, cfg, a, nowIso),
    largeCommits,
    recent: { commits: recentCommits.length, fixRatio: recentCommits.length ? recentCommits.filter((c) => isFixCommit(c.subject)).length / recentCommits.length : 0 },
    pending: pendingItems(memos, today, a.pendingWindowDays),
    resolved: resolvedItems(memos, today, a.pendingWindowDays),
    feel: feelSummary(memos, today, a.recentDays),
    blockers: blockerSummary(memos, today, { recentDays: a.recentDays, windowDays: a.repeatWindowDays, minDays: a.blockerRepeatDays, threshold: a.similarity }),
    latestNext: { day: latestMemo?.day || null, items: latestMemo?.sections.next || [] },
    pcTasks: pcUnique,
    repetition,
    weekly: weeklySeries(dayCounts, today, 12),
    weekdays: weekdayCounts(days),
    hours: hourBuckets(times, cfg.tz),
    recentDecisions: memos.flatMap((m) => m.sections.decisions.map((text) => ({ day: m.day, text }))).sort((x, y) => y.day.localeCompare(x.day)).slice(0, 15),
    lastActiveDay, daysSinceActive: lastActiveDay ? daysBetween(lastActiveDay, today) : null,
  };
  return { name: path.basename(root), root, today, metrics, findings: detectFindings(metrics, a) };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseAnalyzeArgs(argv);
  if (args.help) {
    console.log('使い方: node tools/daily-log-analyze.mjs [リポジトリ...] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--out ファイル] [--json]');
    console.log('       node tools/daily-log-analyze.mjs --issue --out <本文のファイル> --title-out <件名のファイル>   # 週1回の Issue 用');
    return 0;
  }
  const roots = (args._.length ? args._ : [process.cwd()]).map((p) => repoRoot(path.resolve(p)));
  const results = roots.map((r) => analyzeRepo(r, { since: args.since, until: args.until, today: args.today }));
  const today = results[0]?.today || dayKey(new Date().toISOString(), DEFAULT_CONFIG);
  let text = args.json ? JSON.stringify(results.map(({ root, ...r }) => r), null, 2) + '\n' : renderReport(results, { today });
  if (args.issue) {
    text = issueBody(text, { today });
    if (args['title-out']) {
      fs.mkdirSync(path.dirname(path.resolve(args['title-out'])), { recursive: true });
      fs.writeFileSync(args['title-out'], issueTitle(today) + '\n');
    }
  }
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, text);
    console.log(`保存: ${args.out}`);
  } else process.stdout.write(text);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); } catch (e) { console.error(`エラー: ${e.message}`); process.exitCode = 1; }
}
