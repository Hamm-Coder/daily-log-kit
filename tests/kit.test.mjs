// daily-log-kit v1.3.1 — キット自体の決まりの検査（node --test で他のテストと一緒に動く）
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

test('依存パッケージを使わない（node: の標準モジュールと相対パスだけ）', () => {
  const bad = [];
  for (const f of all.filter((p) => p.endsWith('.mjs'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import .* from '([^']+)';/gm)) if (!/^(node:|\.)/.test(m[1])) bad.push(`${rel(f)}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});
