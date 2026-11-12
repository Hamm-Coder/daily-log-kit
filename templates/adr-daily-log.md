# ADR {{NUMBER}}: 日報の仕組み（daily-log-kit）を導入する

- 状態: 採用
- 日付: {{DATE}}
- 関連: `docs/specs/daily-log.md`、`docs/procedures/daily-log.md`
- 備考: daily-log-kit v{{VERSION}} の導入PRで自動作成。このPRのマージをもって採用とする

## 背景

チャット（claude.ai）、Claude Code（Web版・PC版）、Git での作業と決定が別々の場所に残り、後から「いつ何を決めたか」をたどるのに手間がかかる。特に、コミットのない日（チャットだけで設定や方針を決めた日）の記録が残らない。Web版 Claude Code の会話もリポジトリには残らない。

## 選択肢

| 案 | 内容 | 費用 | 手間 | 保守性 |
| --- | --- | --- | --- | --- |
| A 手書きの日報 | 毎日 `docs/log/日付.md` を書く | 0円 | 毎日5〜10分 | 書き忘れやすい。並行するPRで衝突する |
| **B daily-log-kit** | セッションごとのメモ＋Git履歴から日報を自動生成。Stop フックで書き忘れを防ぎ、Actions で作り直す | 0円（Actions は1回1分未満） | 導入数分、以後はほぼ0 | キットを別リポジトリで版管理し、一括で更新できる |
| C 外部サービス | Notion などに集約 | 無料〜有料 | 連携の設定が必要 | リポジトリと二重管理になる |

## 決定

案Bを採用する。

- 日報メモは `docs/log/entries/<日付>/` にセッションごとに書く
- 日報 `docs/log/YYYY-MM/YYYY-MM-DD.md` と一覧 `docs/log/README.md` は自動生成し、手で編集しない
- 作業日の区切りと除外条件は `docs/log/config.json` で設定する
- {{WORKFLOW_LINE}}

## 影響

- `CLAUDE.md` に日報の区間が加わり、Claude Code はPRを作る前に日報メモを書く
- Stop フックが1本増える。作業の差分があってメモがないときに1回だけ促す（作業は止めない）
- main にボットのコミット「docs(log): 日報を更新」が入る。PC では作業前に `git pull` が必要

## 見直す条件

- main にブランチ保護を入れる場合（Actions を外し、PR内での生成だけにする）
- 日報メモの書き忘れが続く、または記録の手間が作業時間を圧迫する場合
