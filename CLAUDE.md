# daily-log-kit（キットのリポジトリ）

Claude Code を使う各リポジトリに「日報（日毎ログ）」の仕組みを配るキット。ここはキットそのものを開発・配布するリポジトリで、日報を書く場所ではない。

## 最初に読むもの

1. `docs/HANDOFF.md` … これまでの経緯、今の状態、確認済みの範囲、残っている作業
2. `SPEC.md` … 作業キュー（次にやること）と未決事項
3. `files/docs/specs/daily-log.md` … 日報の仕組みの仕様（各リポジトリに配られる正本）
4. `docs/decisions/` … このキットの設計の決定（ADR）

## 構成（どこに何があるか）

| パス | 役割 | 各リポジトリに配るか |
| --- | --- | --- |
| `files/` | 各リポジトリにそのままコピーされるファイル（生成・分析・引き継ぎのツール、テスト、Stop と SessionStart のフック、Skill、Actions、仕様、手順、設定） | 配る |
| `install.mjs` | 1リポジトリへの導入・更新。既存の設定は保持して追記だけ | 配らない |
| `install-all.ps1` | `C:\AllGitRepository` 配下へ一括導入（worktree で作業し PR にする） | 配らない |
| `publish-kit.bat` / `publish-kit.ps1` | 新しい版の zip をこのリポジトリへ反映（チャットで作った zip を使う場合） | 配らない |
| `bump-version.mjs` | 版番号の一括変更 | 配らない |
| `templates/` | 導入時に作る ADR のひな形 | 配らない（中身から ADR を作る） |
| `prompts/` | Claude Code・claude.ai に貼る依頼文 | 配らない |
| `tests/` | キットの決まりの検査（`kit.test.mjs`）と Windows の通しテスト（`e2e.ps1`） | 配らない |
| `.github/workflows/` | キット自体の CI（`kit-ci.yml`）と自動リリース（`kit-release.yml`） | 配らない |
| `docs/` | このキットの引き継ぎ資料、ADR、分析の検討、マニュアル | 配らない |

`files/docs/` は各リポジトリに配る文書、キット直下の `docs/` はキット自体の文書。混同しない。

## 開発の決まり

- 依存パッケージを使わない（Node.js の標準モジュールだけ）。動作確認は Node.js 22 と 24
- PowerShell のスクリプトは Windows PowerShell 5.1 でも動く書き方にする（`??`、三項演算子、`-AsHashtable` などの 7 専用の構文を使わない）。日本語を含む `.ps1` は BOM 付き UTF-8
- `.bat` は英数字のみ、改行は CRLF、処理は `( ... & exit /b )` の1行（実行中に自分が上書きされても誤動作しない）
- `files/` のファイルは先頭600文字以内に `daily-log-kit v<版>` の印を書く（更新時に上書きしてよいファイルの目印。`files/docs/log/config.json` だけは例外で、既存の設定を残す）
- 日報の出力は決定的にする（生成時刻を入れない。同じ入力なら同じ内容）
- 各リポジトリの作業フォルダ・未コミットの変更・今のブランチに触れない。変更は必ず PR にする
- 数値の分析は「傾向をつかむ目安」。成果や生産性の評価に使う表現をしない（`files/docs/specs/daily-log.md` 12.4）

## 検査

```bash
node --test          # 全テスト（ツール、分析、導入、キットの決まり）。必ず通してからコミット
```

PowerShell の通しテスト（PCの Windows で試すとき）:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\e2e.ps1
```

`kit-ci.yml` が push と PR のたびに、Linux・Windows の単体テストと、Windows PowerShell 5.1・PowerShell 7 の通しテストを実行する。

## 版を上げて配る手順（Claude Code で直接直すとき）

1. 作業ブランチで修正し、`node --test` を通す
2. `node bump-version.mjs <新しい版>`（不具合の修正は x.y.Z、機能の追加は x.Y.0、日報メモの形式を変えるなど既存のメモに影響する変更は X.0.0）
3. `README.md` の「変更履歴」の表の先頭に1行追加する（`tests/kit.test.mjs` が確認する）
4. PR を作る。マージすると `kit-release.yml` がタグ `v<版>` とリリースを作る
5. 利用者が PC で `.\install-all.ps1 -Apply -CreatePR` を実行し、各リポジトリに更新の PR を配る

## 作業の終わりに

この作業自体の記録は `SPEC.md` の作業キューの状態更新と、`docs/HANDOFF.md` の「経緯」への1行追加で行う（このリポジトリには日報の仕組みを入れていない）。
