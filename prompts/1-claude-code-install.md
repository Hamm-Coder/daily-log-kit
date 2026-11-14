# 依頼文1: Claude Code（Web版）で1つのリポジトリに導入する

キットを GitHub の公開リポジトリ `Hamm-Coder/daily-log-kit` に置いた前提です（README「GitHub での運用」参照）。各リポジトリの Claude Code Web で、次をそのまま貼り付けます。

---

日報の仕組み（daily-log-kit）をこのリポジトリに導入してください。

1. `https://github.com/Hamm-Coder/daily-log-kit` を作業フォルダの外（例 `/tmp/daily-log-kit`）に `git clone --depth 1` する。読めない場合は作業を止めて、キットの zip をアップロードするよう私に伝える
2. このリポジトリが浅いクローンなら `git fetch --unshallow` で全履歴を取る
3. `node /tmp/daily-log-kit/install.mjs . --dry-run` で変更予定を表示し、続けて `node /tmp/daily-log-kit/install.mjs . --backfill` で導入と過去の日報の生成を行う
   - main にブランチ保護があるリポジトリなら `--no-workflow` を付ける
   - 「スキップ（キット以外の同名ファイル）」が出たら、上書きせずに私に知らせる
4. `node --test tools/daily-log.test.mjs tools/daily-log-analyze.test.mjs tools/daily-log-brief.test.mjs` が通ることを確認する。既存のテストや検査（`npm test` など）があれば、それも通ることを確認する
5. `daily-log` Skill の手順Bに従い、マージ済みPRの説明文（`gh` が使えれば）から、PRごとの要点を日報メモ（`--source pr`）にまとめる。日付はマージ日。使えなければこの手順は飛ばし、その旨を報告する
6. もう一度 `node tools/daily-log.mjs generate --all` を実行し、「chore: 日報の仕組みを導入（daily-log-kit v1.4.0）」としてコミットし、PRを作る
7. 最後に、この作業自体の日報メモを `daily-log` Skill の手順Aで書いて同じPRに含める

報告には、導入したファイル、生成された日報の日数、スキップしたものを含めてください。

---

## SPEC.md の作業キューに入れる場合

| ID | 作業 | 成果物 | 完了条件 | 実行場所 |
| --- | --- | --- | --- | --- |
| E1 | 日報の仕組み（daily-log-kit v1.4.0）の導入と過去の日報の生成 | `tools/daily-log.mjs`、`docs/log/`、Stop フック、`daily-log` Skill、`.github/workflows/daily-log.yml` | `node --test tools/daily-log.test.mjs` が成功。`docs/log/README.md` に過去の作業日が並ぶ。PRマージ後に Actions の daily-log が成功 | Web |

## 更新だけを頼む場合（短い版）

導入済みのリポジトリで、キットの新しい版を取り込むときに貼ります。

---

`https://github.com/Hamm-Coder/daily-log-kit` を `/tmp/daily-log-kit` に `git clone --depth 1` し、`node /tmp/daily-log-kit/install.mjs .` で日報の仕組みを最新版に更新してください。`node --test tools/daily-log.test.mjs` が通ることを確認し、「chore: 日報の仕組みを更新（daily-log-kit v<版>）」でPRにしてください。日報メモと `docs/log/config.json` は変更しないでください。
