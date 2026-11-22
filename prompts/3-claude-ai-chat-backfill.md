# 依頼文3: claude.ai のプロジェクトで、過去チャットから日報メモを作る

前提: 設定で「チャットの検索と参照」がオン。プロジェクト内のチャットでは、そのプロジェクトの会話だけが検索対象です。リポジトリごとに、対応する claude.ai のプロジェクトで実行します。

---

過去チャットを検索して、YYYY-MM-DD〜YYYY-MM-DD の決定事項を、リポジトリ `<owner>/<repo>` の日報メモの形式で作ってください。

- 形式: `docs/log/entries/<日付>/<HHMM>-chat-<件名の英字>.md`。frontmatter は date、time、source: chat、branch: chat、title。本文は「決めたこと／作ったもの・変えたもの／次にやること／未解決・判断待ち」の4見出し
- 「決めたこと」には私（ユーザー）の発言で決まった・承認したことだけを書く。あなたの提案で私が採否を言っていないものは「未解決・判断待ち」に入れる
- 以前のメモの判断待ちを後のチャットで決めた場合は、その日のメモの「決めたこと」に `解決: <判断待ちの項目> → <決めた内容>` と書く
- チャットには発言ごとの日時がないので、設定書の更新日・版番号・チャットの最終更新日から日付を推定し、推定したメモには本文の先頭に「（日付は推定: 根拠）」と書く
- コミットの一覧は書かない（Git から自動で入る）
- リポジトリにすでに日報メモがある日・作業（Claude Code で記録済みのもの）は書かない
- できたファイルを1つの zip にまとめて渡す。zip は、リポジトリ直下に展開すると `docs/log/entries/` に入る構成にする

---

受け取った zip は、次のどちらかでリポジトリに入れます。どちらも、コミットするのは日報メモ（`docs/log/entries/`）だけです。自動生成の日報（`docs/log/YYYY-MM/`、`docs/log/README.md`）は PR に含めず、マージの後に Actions が作り直します（仕様 4.4。含めると、続けてマージしたときに衝突します）。

- **Claude Code（Web版・PC）に頼む**: 「この zip を展開して、docs/log/entries のファイルだけを日報メモとしてコミットし、PR にして（自動生成の日報は含めない）」と渡す
- **PC の PowerShell で行う**（1行ずつ。`main` は既定のブランチの名前にする）:

```powershell
cd C:\AllGitRepository\<リポジトリ>
git switch main
git pull
git switch -c docs/chat-backfill
Expand-Archive <zip のパス> -DestinationPath . -Force
git add docs/log/entries
git commit -m "docs(log): claude.ai のチャットの決定を日報メモに追加"
git push -u origin docs/chat-backfill
gh pr create --fill
git switch main
```

PR のマージを記録する日報メモは作りません（仕様 4.3）。
