// daily-log-kit v1.10.0 — キット自体の決まりの検査（node --test で他のテストと一緒に動く）
// 版番号の書き換え漏れ、変更履歴の書き忘れ、文字コード、配布ファイルの印を確認する
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = /KIT_VERSION = '([\d.]+)'/.exec(fs.readFileSync(path.join(ROOT, 'install.mjs'), 'utf8'))[1];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  if (['.git', 'node_modules'].includes(e.name)) return [];
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const all = walk(ROOT).filter((p) => !/\.zip$/.test(p));

test('版番号の表記がすべて KIT_VERSION と同じ（bump-version.mjs の漏れがない）', () => {
  const wrong = [];
  for (const f of all) {
    const r = rel(f);
    // extras/ と docs/（履歴の記録）、install.test.mjs（旧版番号をわざと使う例）は対象外。bump-version.mjs と同じ範囲
    if (r.startsWith('extras/') || r.startsWith('docs/') || r === 'install.test.mjs' || !/\.(mjs|md|yml|ps1|json)$/.test(r)) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/daily-log-kit v(\d+\.\d+\.\d+)/g)) if (m[1] !== VERSION) wrong.push(`${r}: v${m[1]}`);
  }
  assert.deepEqual(wrong, [], `KIT_VERSION は ${VERSION}`);
});

test('README の変更履歴に今の版がある', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, new RegExp(`^\\| ${VERSION.replace(/\./g, '\\.')} \\| \\d{4}-\\d{2}-\\d{2} \\| .+ \\|$`, 'm'), `README.md の「変更履歴」に ${VERSION} の行を追加してください`);
});

test('配布するファイルに版の印がある（更新時に上書きできる）', () => {
  const missing = all.map(rel).filter((r) => r.startsWith('files/') && r !== 'files/docs/log/config.json')
    .filter((r) => !/daily-log-kit v\d/.test(fs.readFileSync(path.join(ROOT, r), 'utf8').slice(0, 600)));
  assert.deepEqual(missing, [], '先頭600文字以内に「daily-log-kit v<版>」を書いてください');
});

test('日本語を含む .ps1 は BOM 付き UTF-8（Windows PowerShell 5.1 で文字化けしない）', () => {
  const bad = all.filter((f) => f.endsWith('.ps1')).filter((f) => {
    const b = fs.readFileSync(f);
    const hasBom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
    return !hasBom && /[^\x00-\x7f]/.test(b.toString('utf8'));
  }).map(rel);
  assert.deepEqual(bad, []);
});

test('.bat は英数字のみで改行は CRLF、処理は1行（実行中の上書きに強い）', () => {
  for (const f of all.filter((p) => p.endsWith('.bat'))) {
    const t = fs.readFileSync(f, 'latin1');
    assert.doesNotMatch(t, /[^\x00-\x7f]/, `${rel(f)} に英数字以外の文字`);
    assert.doesNotMatch(t, /[^\r]\n/, `${rel(f)} の改行が CRLF でない`);
    const cmds = t.split('\r\n').filter((l) => l.trim() && !/^(@echo off|rem\b)/i.test(l.trim()));
    assert.equal(cmds.length, 1, `${rel(f)} の処理は ( ... & exit /b ) の1行にまとめる`);
    assert.match(cmds[0], /^\(.*exit \/b\)$/);
  }
});

test('.gitattributes で .bat の改行の変換を止めている（Linux の CI や GitHub の zip でも CRLF のまま）', () => {
  const attrs = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
  assert.match(attrs, /^\*\.bat\s+-text\s*$/m, '.gitattributes に「*.bat -text」を書いてください');
});

test('配る daily-log.yml は既定のブランチの名前を決め打ちしない（main がないリポジトリでも日報が更新される）', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'files/.github/workflows/daily-log.yml'), 'utf8');
  assert.doesNotMatch(yml, /branches:\s*\[\s*main/, 'push の対象を main・master に限らない');
  assert.match(yml, /if: .*github\.ref_name == github\.event\.repository\.default_branch/, '既定のブランチのときだけ動かす条件を書く');
});

test('install-all.ps1 と pull-all.ps1 は GitHub の既定のブランチを毎回確かめ直す（手元の origin/HEAD は clone したときのまま）', () => {
  const inst = fs.readFileSync(path.join(ROOT, 'install-all.ps1'), 'utf8');
  assert.match(inst, /^\s*& git -C \$repo remote set-head origin --auto/m, 'install-all.ps1 は条件なしで git remote set-head origin --auto を実行する');
  assert.doesNotMatch(inst, /if \(-not \$headRef\) \{ & git -C \$repo remote set-head/, 'origin/HEAD がないときだけ確かめる書き方に戻さない');
  const pull = fs.readFileSync(path.join(ROOT, 'pull-all.ps1'), 'utf8');
  assert.match(pull, /'remote', 'set-head', 'origin', '--auto'/, 'pull-all.ps1 も確かめ直す');
  for (const f of ['pull-all.ps1', 'dashboard.ps1']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /'origin\/HEAD', 'origin\/main', 'origin\/master'/, `${f} は origin/HEAD が使えないとき main・master も見る`);
  }
});

test('日報メモを書かないとき（日報メモだけの PR のマージの確認など）を、Skill・CLAUDE.md の区間・仕様に書いている（仕様 4.3）', async () => {
  const skill = fs.readFileSync(path.join(ROOT, 'files/.claude/skills/daily-log/SKILL.md'), 'utf8');
  assert.match(skill, /書かないとき/, 'Skill に「書かないとき」');
  assert.match(skill, /日報メモだけの PR/, 'Skill に日報メモだけの PR のマージ');
  const { CLAUDE_MD_BLOCK } = await import('../install.mjs');
  assert.match(CLAUDE_MD_BLOCK, /日報メモだけの PR のマージの確認/, 'CLAUDE.md の区間にも書く（Skill を読まずに書き始める場合のため）');
  assert.match(CLAUDE_MD_BLOCK, /PR #N をマージした/);
  const spec = fs.readFileSync(path.join(ROOT, 'files/docs/specs/daily-log.md'), 'utf8');
  assert.match(spec, /^### 4\.3 日報メモを書かないとき/m);
});

test('週1回の Issue のワークフローは既定で無効（config.json の weeklyIssue を見る）で、権限は最小限', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'files/.github/workflows/daily-log-weekly.yml'), 'utf8');
  assert.match(yml, /schedule:/);
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /weeklyIssueEnabled/, '設定で有効にしたときだけ動かす');
  assert.match(yml, /permissions:\r?\n\s+contents: read\r?\n\s+issues: write/, '権限は contents: read と issues: write だけ');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'files/docs/log/config.json'), 'utf8'));
  assert.equal(cfg.weeklyIssue, false, '新しく入れたリポジトリでも既定は無効');
});

test('依存パッケージを使わない（node: の標準モジュールと相対パスだけ）', () => {
  const bad = [];
  for (const f of all.filter((p) => p.endsWith('.mjs'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import .* from '([^']+)';/gm)) if (!/^(node:|\.)/.test(m[1])) bad.push(`${rel(f)}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});
