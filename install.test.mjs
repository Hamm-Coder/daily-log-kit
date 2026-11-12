// 実行: node --test install.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertBlock, hookCommand, mergeSettings, mergePackageScripts, isKitFile, CLAUDE_MD_BLOCK } from './install.mjs';

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
