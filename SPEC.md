# SPEC: daily-log-kit の作業キュー

- 更新日: 2026-11-18
- 正本の優先順位: この SPEC.md と `docs/decisions/` → `docs/HANDOFF.md` → 会話の合意
- 状態: 未着手 / 作業中 / 完了 / 保留

## 目的

Claude Code・claude.ai・Git での作業と決定を、各リポジトリの `docs/log/` に日ごとに残し、振り返り・再開・判断待ちの棚卸しに使えるようにする。導入と更新は数分、毎日の手間はほぼ0を保つ。

## 作業キュー

### K: 動作の確認（実機・本物の GitHub）

| ID | 作業 | 完了条件 | 実行場所 | 状態 | 結果（2026-11-14 時点。K3〜K5 は利用者が claude.ai のチャットでまとめた報告による） |
| --- | --- | --- | --- | --- | --- |
| K1 | `kit-ci.yml` の初回実行を確認する | GitHub の Actions で unit（4通り）と e2e-windows（5.1 と 7）がすべて緑。失敗したらログから原因を直す | Web（Actions のログを読む） | 完了（v1.3.2） | main への push で3回実行（v1.3.0、extras の削除、v1.3.1）、3回とも失敗。原因は2件で、どちらも v1.3.2 で修正: ①`tests/hooks.test.mjs` の GitHub 役（bare リポジトリ）の既定ブランチが環境まかせで、`git remote set-head origin --auto` が失敗（全 OS）。②`publish-kit.bat` が LF で保存されていた（Linux だけ失敗。Windows は autocrlf で CRLF になり通っていた）。e2e-windows は 1〜3（`install-all.ps1`、分析）が Windows PowerShell 5.1 と実物の robocopy で成功、4（`publish-kit.ps1`）だけ①の巻き添えで失敗（publish-kit が中で `node --test` を実行するため）。PowerShell 7 の通しは 5.1 の失敗で未実行。v1.3.2 の PR（#1）の kit-ci で、unit 4通りと e2e-windows（Windows PowerShell 5.1 と PowerShell 7 の通し、publish-kit と実物の robocopy を含む）がすべて成功 |
| K2 | `kit-release.yml` の初回実行を確認する | 版を上げた PR のマージでタグとリリースができる | Web | 完了（v1.3.2） | 2回実行（v1.3.0、v1.3.1 の push）、2回とも「テスト」の手順で失敗（K1 と同じ原因）。タグ v1.3.0・v1.3.1 は publish-kit が作ったもので、リリースは0件。v1.3.2 の PR（#1）のマージで `kit-release` が成功し、タグ v1.3.2 とリリース v1.3.2 ができた（PR 経由の初回）。v1.3.0・v1.3.1 のリリースはないまま（実害なし） |
| K3 | RPGMZ_Prototype の `daily-log` Actions の結果を確認する | マージ後にボットの「docs(log): 日報を更新」コミットがあり、`docs/log/README.md` に 11/13 の行がある | Web | 完了 | 成功。v1.0.1 の導入 PR のマージ後、ボットのコミット e0755f6「docs(log): 日報を更新 [skip ci]」（2026-11-13 00:34 JST）がある。`docs/log/README.md` の 11/13 の行は未報告。**11/14 追記**: RPGMZ_Prototype は v1.3.1・v1.3.2 の更新 PR のマージ後も成功（4回実行）。一方、既定のブランチが `claude/...` の4リポジトリ（automaticPromptsMaker、promptBatchExportTool、MangaCreation_Sys_withGAS、A1111_SD_TokenCounter）では一度も動いていなかった（ワークフローが main・master への push だけを対象にしていたため）。v1.3.3 で修正。配布後に4リポジトリで動くことの確認が残り（K6） |
| K4 | `install-all.ps1 -CreatePR` の実地確認 | 1リポジトリで PR が作られ、PR 本文に版と ADR の説明が入る | PC | 完了 | Windows の実機で成功。RPGMZ_Prototype に `chore/daily-log-v1.0.1`（マージ済み）と `chore/daily-log-v1.3.1`（未マージ）の PR ができた。v1.3.1 の PR の差分は想定どおり（`docs/decisions` と `docs/log/entries` は変更なし、ADR の二重作成なし、`settings.json` は SessionStart フックの追加だけで既存の PreToolUse・PostToolUse・Stop は保持）。automaticPromptsMaker にも `-Repos automaticPromptsMaker -Backfill -Apply -CreatePR` で実行（PR の結果は未確認）。残り: PR 本文に版と ADR の説明が入っているかの確認、使った PowerShell の版の確認。**11/14 追記**: automaticPromptsMaker の PR 3本（導入 v1.1.2、更新 v1.3.1・v1.3.2。すべてマージ済み）の本文に、版と ADR の説明が入っていることを確認。更新のときの言い回し（「v1.3.2 を更新します」）は v1.3.3 で修正。使った PowerShell の版は未確認のまま |
| K5 | 利用者の環境の版をそろえる | キットのリポジトリのタグが最新の版まであり、`publish-kit` またはこの SPEC の手順で反映済み | PC | 完了 | GitHub 側: 11/12 に公開リポジトリを作り v1.0.0 を push、v1.0.1 は robocopy の手順、v1.3.0・v1.3.1 は `publish-kit.bat`（Windows PowerShell 5.1 を呼ぶ）で反映、v1.3.2 は PR のマージで反映。main の先頭はタグ v1.3.2 の版。タグは v1.0.0、v1.0.1、v1.1.2、v1.3.0、v1.3.1、v1.3.2（v1.1.0、v1.1.1、v1.2.0 は単独で push されておらずタグがない。実害なし）。`extras/` は GitHub 上で削除済み。残り: PC のキットのフォルダで `git pull`（v1.3.2 にする）。RPGMZ_Prototype の main のツールは v1.0.1 のまま（v1.3.1 の PR が未マージ）。**11/14 追記**: 利用者が PC から v1.3.2 を5リポジトリに配布し、すべてマージ済み（GitHub 上で5つとも v1.3.2、未マージの PR なし）。PC のキットのフォルダは v1.3.2 |
| K6 | 既定のブランチが main 以外のリポジトリで `daily-log` Actions が動くことを確認する | v1.3.3 の配布後、4リポジトリ（K3 の追記）で、既定のブランチへのマージの後にボットの「docs(log): 日報を更新」コミットがある | Web（このキットのセッションにリポジトリを追加して確認） | 完了 | v1.3.3 を5リポジトリに配布し、すべてマージ。既定のブランチが `claude/...` の4リポジトリで、マージの後に `daily-log` Actions が初めて動き、成功した（PR のブランチへの push は skipped）。RPGMZ_Prototype（main）も成功 |

### L: 展開

| ID | 作業 | 完了条件 | 実行場所 | 状態 |
| --- | --- | --- | --- | --- |
| L1 | Unity_CharacterTest など他のリポジトリへ導入する | `.\install-all.ps1 -Backfill` の確認後、対象を選んで PR をマージ | PC | 作業中（11/15: GoogleFlowCharacterMakingTools に v1.9.0 を導入し、Actions・日報・ファイルの一致を確認。Unity_CharacterTest の版と Actions は未確認。11/17: lifelog_with_GAS に v1.9.1 を導入しマージ、Actions 成功。利用者の決定: 保管用を含め、追加するリポジトリには同じように導入する） |
| L2 | 昔のリポジトリ（Android/Kotlin など）の過去の日報だけを作る | `node <キット>\files\tools\daily-log.mjs generate --all` で `docs/log/` を作る（導入はしない） | PC | 未着手 |
| L3 | チャットだけの日の補完 | 各 claude.ai プロジェクトで `prompts/3-claude-ai-chat-backfill.md` を使い、日報メモを追加 | claude.ai → Web | 未着手 |

### M: 分析の活用（`docs/analysis.md` の提案）

| ID | 作業 | 効果 | 費用・作業量 | 状態 |
| --- | --- | --- | --- | --- |
| M1 | SessionStart フックで「次にやること・判断待ち・始める前の準備・効率化の候補」を Claude に渡す（ADR 0008） | 再開時に毎回説明しなくてよくなる。PC作業の取り違えと、繰り返しの手作業が見える | 0円・小 | 完了（v1.3.0） |
| M2 | 判断待ちの解決を書く記法（「決めたこと」に `解決: <項目>`）と、分析での除外 | 判断待ち一覧の精度が上がる | 0円・小 | 完了（v1.5.0） |
| M3 | 週1回の分析を Actions で Issue にする（任意の設定で有効化） | 見に行かなくても改善点が届く | 0円（Actions 数十秒/週）・小 | 完了（v1.7.0。RPGMZ_Prototype で有効にし、GitHub 上の手動実行で Issue #49 ができることを確認。11/16（月）の定期実行で Issue #55 を作り、前の週の #49 を閉じることも確認。各リポジトリで `"weeklyIssue": true` を書いて有効にする） |
| M4 | 日報メモに任意の「手応え（1〜5）」「詰まったこと」を足し、分析に入れる | 量だけでなく満足度・詰まりの傾向がわかる（SPACE の Satisfaction・Efficiency） | 0円・小 | 完了（v1.8.0。仕様 4.2） |
| M5 | 複数リポジトリのダッシュボード（`--json` を読む HTML 1枚） | プロジェクト間の比較が一目でわかる | 0円・中 | 完了（v1.9.0。`dashboard.ps1`。Claude による「これまでの作業」の要約は無期限保留） |
| M6 | PC の会話記録から日報メモの下書きを作る（`transcripts` → `new-entry`） | PC作業の記録漏れが減る | 0円・中。記録の形式が非公式で壊れやすい | 保留 |
| M7 | 繰り返しの判別のしきい値を実際のデータで見直す | 誤検出と見逃しが減る | 0円・小（1か月運用した後に `analysis` の設定を調整） | 未着手 |
| M8 | RPGMZ_Prototype の `docs/log/config.json` に準備のルール（`prep`）を書く | テストプレイやプラグイン登録の前に必要な手順が毎回出る | 0円・小（仕様 13.1 の例をもとに） | 完了（RPGMZ_Prototype #44 で5つのルールを追加、#51 でテストプレイとプラグイン登録の手順に実行場所・ツール・コマンドを書き足した。PC の Claude Code アプリでの受け取りは次のテストプレイのときに確かめる） |
| M9 | PC の会話記録から「同じ依頼の繰り返し」を見つけ、Skill の候補にする | 繰り返しの判別に、コミットにならない作業も入る | 0円・中。M6 と同じく形式が非公式 | 保留 |

## 未決事項

| ID | 決めること | 選択肢 | 期限 |
| --- | --- | --- | --- |
| Q1 | キットのリポジトリ自体に日報の仕組みを入れるか | 入れない（現状。キット直下の docs/ と混ざる） / 入れる（`docs/log/` だけ使う） | M1 の前 |
| Q2 | 分析のしきい値を自分の作業に合わせて変えるか | 既定のまま / `config.json` の `analysis` で調整 | 1か月運用した後 |
| Q3 | Node.js の要件の表記 | 「18以上で動く設計、22・24で確認」のまま / 「22以上」に上げる | K1 の後 |
