# 依頼文2: キットを使わずに、仕様から実装してもらう（汎用）

キットを置けない環境（別アカウント、社外のリポジトリなど）向けです。下の依頼文の後ろに、キットの `files/docs/specs/daily-log.md` の全文を貼り付けて渡します。実装が仕様どおりなら、日報の形式はキット版と同じになります。

---

下に貼る「日報（日毎ログ）の仕様」に従って、このリポジトリに日報の仕組みを実装してください。

- 実装するもの: `tools/daily-log.mjs`（generate / new-entry / check / transcripts）、`tools/daily-log.test.mjs`（node:test）、`.claude/hooks/daily-log-reminder.mjs`（Stop フック）、`.claude/skills/daily-log/SKILL.md`、`.github/workflows/daily-log.yml`、`docs/log/config.json`、`CLAUDE.md` への日報の区間（`<!-- daily-log:start -->`〜`<!-- daily-log:end -->`）
- 制約: 依存パッケージなし（Node.js 18 以上の標準機能のみ）。既存の `.claude/settings.json` と `CLAUDE.md` の内容は保持し、追記だけにする
- Stop フックは `stop_hook_active` が true のとき、または同じ HEAD で既に1回促したときは何もしない。判定できないときやエラー時も作業を止めない
- 日報の出力は決定的にする（生成時刻などを入れない）。同じ入力で2回生成しても差分が出ないことをテストする
- 作業日の区切り（`dayStartHour`）、マージとスカッシュのPR判別、ボットのコミットの除外をテストする
- 実装後に `generate --all` で過去の日報を作り、PRにする

（ここに docs/specs/daily-log.md の全文を貼る）
