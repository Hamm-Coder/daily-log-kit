# SPEC: daily-log-kit の作業キュー

- 更新日: 2026-11-14
- 正本の優先順位: この SPEC.md と `docs/decisions/` → `docs/HANDOFF.md` → 会話の合意
- 状態: 未着手 / 作業中 / 完了 / 保留

## 目的

Claude Code・claude.ai・Git での作業と決定を、各リポジトリの `docs/log/` に日ごとに残し、振り返り・再開・判断待ちの棚卸しに使えるようにする。導入と更新は数分、毎日の手間はほぼ0を保つ。

## 作業キュー

### K: 動作の確認（実機・本物の GitHub）

| ID | 作業 | 完了条件 | 実行場所 | 状態 | 結果（2026-11-14 時点） |
| --- | --- | --- | --- | --- | --- |
| K1 | `kit-ci.yml` の初回実行を確認する | GitHub の Actions で unit（4通り）と e2e-windows（5.1 と 7）がすべて緑。失敗したらログから原因を直す | Web（Actions のログを読む） | 完了（v1.3.2） | main への push で3回実行（v1.3.0、extras の削除、v1.3.1）、3回とも失敗。原因は2件で、どちらも v1.3.2 で修正: ①`tests/hooks.test.mjs` の GitHub 役（bare リポジトリ）の既定ブランチが環境まかせで、`git remote set-head origin --auto` が失敗（全 OS）。②`publish-kit.bat` が LF で保存されていた（Linux だけ失敗。Windows は autocrlf で CRLF になり通っていた）。e2e-windows は 1〜3（`install-all.ps1`、分析）が Windows PowerShell 5.1 と実物の robocopy で成功、4（`publish-kit.ps1`）だけ①の巻き添えで失敗（publish-kit が中で `node --test` を実行するため）。PowerShell 7 の通しは 5.1 の失敗で未実行。v1.3.2 の PR（#1）の kit-ci で、unit 4通りと e2e-windows（Windows PowerShell 5.1 と PowerShell 7 の通し、publish-kit と実物の robocopy を含む）がすべて成功 |
| K2 | `kit-release.yml` の初回実行を確認する | 版を上げた PR のマージでタグとリリースができる | Web | 作業中 | 2回実行（v1.3.0、v1.3.1 の push）、2回とも「テスト」の手順で失敗（K1 と同じ原因）。タグ v1.3.0・v1.3.1 は publish-kit が作ったもので、リリースは0件。v1.3.2 の PR をマージして、タグ v1.3.2 とリリースができれば完了（PR 経由は今回が初めて） |
| K3 | RPGMZ_Prototype の `daily-log` Actions の結果を確認する | マージ後にボットの「docs(log): 日報を更新」コミットがあり、`docs/log/README.md` に 11/13 の行がある | Web | 未着手 | 未確認。キットのリポジトリのセッションからは RPGMZ_Prototype を読めない。RPGMZ_Prototype のセッションで確認するか、利用者が Actions の画面を見る |
| K4 | `install-all.ps1 -CreatePR` の実地確認 | 1リポジトリで PR が作られ、PR 本文に版と ADR の説明が入る | PC | 未着手 | キットのリポジトリには結果の記録がない。実行済みなら結果（PR ができたか、本文の内容）を利用者から聞いて記録する |
| K5 | 利用者の環境の版をそろえる | キットのリポジトリのタグが最新の版まであり、`publish-kit` またはこの SPEC の手順で反映済み | PC | 作業中 | GitHub 側は確認済み: main の先頭が v1.3.1 で、タグ v1.3.1 と同じコミット。タグは v1.0.0、v1.0.1、v1.1.2、v1.3.0、v1.3.1 の5つ（v1.1.0、v1.1.1、v1.2.0 は単独で push されておらず、タグがない。実害なし）。PC のキットのフォルダは未確認。v1.3.2 のマージ後に `git pull` して完了 |

### L: 展開

| ID | 作業 | 完了条件 | 実行場所 | 状態 |
| --- | --- | --- | --- | --- |
| L1 | Unity_CharacterTest など他のリポジトリへ導入する | `.\install-all.ps1 -Backfill` の確認後、対象を選んで PR をマージ | PC | 未着手 |
| L2 | 昔のリポジトリ（Android/Kotlin など）の過去の日報だけを作る | `node <キット>\files\tools\daily-log.mjs generate --all` で `docs/log/` を作る（導入はしない） | PC | 未着手 |
| L3 | チャットだけの日の補完 | 各 claude.ai プロジェクトで `prompts/3-claude-ai-chat-backfill.md` を使い、日報メモを追加 | claude.ai → Web | 未着手 |

### M: 分析の活用（`docs/analysis.md` の提案）

| ID | 作業 | 効果 | 費用・作業量 | 状態 |
| --- | --- | --- | --- | --- |
| M1 | SessionStart フックで「次にやること・判断待ち・始める前の準備・効率化の候補」を Claude に渡す（ADR 0008） | 再開時に毎回説明しなくてよくなる。PC作業の取り違えと、繰り返しの手作業が見える | 0円・小 | 完了（v1.3.0） |
| M2 | 判断待ちの解決を書く記法（「決めたこと」に `解決: <項目>`）と、分析での除外 | 判断待ち一覧の精度が上がる | 0円・小 | 未着手 |
| M3 | 週1回の分析を Actions で Issue にする（任意の設定で有効化） | 見に行かなくても改善点が届く | 0円（Actions 数十秒/週）・小 | 未着手 |
| M4 | 日報メモに任意の「手応え（1〜5）」「詰まったこと」を足し、分析に入れる | 量だけでなく満足度・詰まりの傾向がわかる（SPACE の Satisfaction・Efficiency） | 0円・小 | 未着手 |
| M5 | 複数リポジトリのダッシュボード（`--json` を読む HTML 1枚） | プロジェクト間の比較が一目でわかる | 0円・中 | 保留（M1〜M3 の後） |
| M6 | PC の会話記録から日報メモの下書きを作る（`transcripts` → `new-entry`） | PC作業の記録漏れが減る | 0円・中。記録の形式が非公式で壊れやすい | 保留 |
| M7 | 繰り返しの判別のしきい値を実際のデータで見直す | 誤検出と見逃しが減る | 0円・小（1か月運用した後に `analysis` の設定を調整） | 未着手 |
| M8 | RPGMZ_Prototype の `docs/log/config.json` に準備のルール（`prep`）を書く | テストプレイやプラグイン登録の前に必要な手順が毎回出る | 0円・小（仕様 13.1 の例をもとに） | 未着手 |
| M9 | PC の会話記録から「同じ依頼の繰り返し」を見つけ、Skill の候補にする | 繰り返しの判別に、コミットにならない作業も入る | 0円・中。M6 と同じく形式が非公式 | 保留 |

## 未決事項

| ID | 決めること | 選択肢 | 期限 |
| --- | --- | --- | --- |
| Q1 | キットのリポジトリ自体に日報の仕組みを入れるか | 入れない（現状。キット直下の docs/ と混ざる） / 入れる（`docs/log/` だけ使う） | M1 の前 |
| Q2 | 分析のしきい値を自分の作業に合わせて変えるか | 既定のまま / `config.json` の `analysis` で調整 | 1か月運用した後 |
| Q3 | Node.js の要件の表記 | 「18以上で動く設計、22・24で確認」のまま / 「22以上」に上げる | K1 の後 |
