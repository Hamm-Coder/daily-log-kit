// 実行: node --test install.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertBlock, hookCommand, mergeSettings, mergePackageScripts, isKitFile, CLAUDE_MD_BLOCK, nextAdrNumber, hasDailyLogAdr, renderAdr } from './install.mjs';

test('CLAUDE.md の区間は追加・置き換えのどちらでも1つだけ', () => {
  const once = upsertBlock('# プロジェクト\n本文\n', CLAUDE_MD_BLOCK);
  assert.equal(upsertBlock(once, CLAUDE_MD_BLOCK), once);
  const old = once.replace('## 日報', '## 日報（旧）');
  assert.equal(upsertBlock(old, CLAUDE_MD_BLOCK), once);
  assert.equal(upsertBlock('', CLAUDE_MD_BLOCK), CLAUDE_MD_BLOCK + '\n');
});

test('既存フックの書き方に合わせる', () => {
  assert.equal(hookCommand({ hooks: { PreToolUse: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs"' }] }] } }),
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/daily-log-reminder.mjs"');
  assert.equal(hookCommand({ hooks: { PostToolUse: [{ hooks: [{ command: 'node .claude/hooks/post-edit.mjs' }] }] } }),
    'node .claude/hooks/daily-log-reminder.mjs');
  assert.equal(hookCommand({}), 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/daily-log-reminder.mjs"');
});

test('settings.json は既存を保持し、Stop フックを1回だけ足す', () => {
  const cur = { permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } };
  const a = mergeSettings(cur);
  assert.equal(a.changed, true);
  assert.equal(a.settings.hooks.Stop.length, 2);
  assert.deepEqual(a.settings.permissions, cur.permissions);
  assert.equal(mergeSettings(a.settings).changed, false);
  assert.equal(cur.hooks.Stop.length, 1); // 元のオブジェクトは変えない
});

test('package.json の同名スクリプトは触らない', () => {
  const { pkg, added } = mergePackageScripts({ scripts: { log: 'echo mine' } });
  assert.equal(pkg.scripts.log, 'echo mine');
  assert.deepEqual(added, ['log:entry', 'test:log']);
});

test('キットのファイルの判別', () => {
  assert.equal(isKitFile('// daily-log-kit v1.0.0 — x'), true);
  assert.equal(isKitFile('# 自作の日報ツール'), false);
});

test('ADR の番号は最大+1、なければ 0001', () => {
  assert.equal(nextAdrNumber(['0001-a.md', '0010-b.md', 'README.md', 'template.md']), '0011');
  assert.equal(nextAdrNumber(['README.md']), '0001');
});

test('日報の ADR が既にあれば二重に作らない', () => {
  assert.equal(hasDailyLogAdr([{ name: '0011-daily-log.md', text: '' }]), true);
  assert.equal(hasDailyLogAdr([{ name: '0012-x.md', text: '# ADR 0012: 日報を残す' }]), true);
  assert.equal(hasDailyLogAdr([{ name: '0001-engine.md', text: '# ADR 0001: MZ を使う' }]), false);
});

test('ADR は最初から「採用」で、Actions なしの注記を切り替える', () => {
  const tpl = '# ADR {{NUMBER}}\n- 状態: 採用\n- 日付: {{DATE}}\nv{{VERSION}}\n- {{WORKFLOW_LINE}}';
  assert.equal(renderAdr(tpl, { number: '0012', date: '2026-11-13', version: '1.1.0', workflow: true }), '# ADR 0012\n- 状態: 採用\n- 日付: 2026-11-13\nv1.1.0\n- main への push で GitHub Actions が日報を作り直す');
  assert.match(renderAdr(tpl, { number: '0003', date: 'd', version: 'v', workflow: false }), /GitHub Actions を使わず/);
});
