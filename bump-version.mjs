#!/usr/bin/env node
// daily-log-kit v1.6.0 — キットの版番号をまとめて書き換える
//   node bump-version.mjs 1.1.0
// "daily-log-kit vX.Y.Z" の表記と KIT_VERSION を、キット内の全ファイルで置き換える（extras/、キット直下の docs/、.git/ は対象外）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next || '')) { console.log('使い方: node bump-version.mjs <X.Y.Z>'); process.exit(1); }
const cur = /KIT_VERSION = '([\d.]+)'/.exec(fs.readFileSync(path.join(root, 'install.mjs'), 'utf8'))[1];
if (cur === next) { console.log(`既に v${next} です`); process.exit(0); }

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  if (['.git', 'extras', 'node_modules'].includes(e.name)) return [];
  if (d === root && e.name === 'docs') return []; // キット直下の docs/ は履歴（引き継ぎ資料・ADR）なので書き換えない
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const esc = cur.replace(/\./g, '\\.');
const changed = [];
for (const f of walk(root)) {
  if (!/\.(mjs|md|yml|ps1|json)$/.test(f) || f.endsWith('install.test.mjs')) continue;
  const raw = fs.readFileSync(f);
  const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const t = raw.toString('utf8');
  const n = t.replace(new RegExp(`daily-log-kit v${esc}`, 'g'), `daily-log-kit v${next}`)
    .replace(new RegExp(`KIT_VERSION = '${esc}'`, 'g'), `KIT_VERSION = '${next}'`);
  if (n !== t) { fs.writeFileSync(f, n.startsWith('﻿') || !bom ? n : '﻿' + n); changed.push(path.relative(root, f)); }
}
console.log(`v${cur} → v${next}（${changed.length}ファイル）\n${changed.map((f) => `  ${f}`).join('\n')}`);
console.log('README.md の「変更履歴」に変更内容を1行書いてから、コミットとタグ付けをしてください。');
