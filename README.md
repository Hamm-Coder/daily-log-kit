# daily-log-kit v1.10.4

Claude Code を使うリポジトリに「日報（日毎ログ）」の仕組みを入れるキット。チャット・Claude Code・Git の作業を `docs/log/` に日ごとにまとめ、作業の傾向・改善点・判断待ちを分析する。

| 読むもの | 内容 |
| --- | --- |
| `docs/MANUAL.md` | マニュアルのテキスト版（GitHub 上でそのまま読める） |
| `docs/manual/index.html` | 図入りのマニュアル（導入、毎日の使い方、更新、分析、トラブル対応）。ダウンロードしてブラウザで開く |
| `files/docs/specs/daily-log.md` | 日報の仕組みの仕様 |
| `docs/analysis.md` | 日報を情報分析に使えるかの検討と、改善の提案 |
| `CLAUDE.md` / `SPEC.md` / `docs/HANDOFF.md` | このキットを Claude Code で開発するための指示・作業キュー・引き継ぎ資料 |

## 中身

| パス | 役割 |
| --- | --- |
| `files/` | リポジトリにそのまま入るファイル（ツール、テスト、フック、Skill、Actions、仕様、手順、設定） |
| `install.mjs` | 1つのリポジトリに導入する。何度実行しても同じ結果。既存の設定は保持して追記だけ |
| `install-all.ps1` | `C:\AllGitRepository` 配下の複数リポジトリへ一括導入（既定は確認のみ） |
| `pull-all.ps1` | 日報の仕組みを入れたリポジトリとキットを一覧にし、全部・選んだもの・やめるを選んで `git pull` する（入れていないリポジトリは対象外。`-Yes` で確認なし） |
| `dashboard.ps1` / `dashboard.mjs` | 日報の仕組みを入れたリポジトリとキット本体の状態（これまでの作業・次にやること・判断待ち・改善点・直近24週のコミット）を1画面の HTML にしてブラウザで開く。作った `dashboard.html` はコミットしない |
| `files/tools/daily-log-analyze.mjs` | 分析ツール（各リポジトリに配られる）。傾向・改善点・判断待ちの一覧 |
| `files/tools/daily-log-brief.mjs` | セッション開始時の引き継ぎ（次にやること・判断待ち・準備・効率化の候補）。SessionStart フックが使う |
| `install.test.mjs`、`tests/` | テスト。`node --test` で全部（キットの決まりの検査を含む）。`tests/e2e.ps1` は Windows の通しテスト |
| `.github/workflows/` | キット自体の CI（`kit-ci.yml`）と自動リリース（`kit-release.yml`）。各リポジトリには配らない |
| `templates/adr-daily-log.md` | 導入時に作る ADR のひな形（状態: 採用。導入PRのマージで採用とする） |
| `publish-kit.bat` / `publish-kit.ps1` | 新しい版の zip をキットのリポジトリに反映（展開・上書き・テスト・コミット・タグ・push）。キットのフォルダで実行 |
| `bump-version.mjs` | キットの版番号を全ファイルで一括変更（`node bump-version.mjs 1.1.0`） |
| `prompts/` | Claude Code・claude.ai に貼る依頼文（導入、仕様からの実装、過去チャットからの補完、チャットの締め、キットの改良） |

必要なもの: Git、Node.js（22 と 24 で確認。18 以上で動く設計）。PRまで一括で作るなら GitHub CLI（`gh`）。

## 使い方は3通り（推奨は B）

| 方法 | 向いている場面 | 作業時間の目安 |
| --- | --- | --- |
| A. 1リポジトリずつ PC で `install.mjs` | 試しに1つ入れる | 1リポジトリ数分 |
| **B. `install-all.ps1` で一括** | 手元に複数のリポジトリがある | 全体で十数分（確認→本番の2回） |
| C. Claude Code Web に依頼文を貼る | PC が使えない、Web 版で完結したい | 1リポジトリ1セッション |

### A. 1つのリポジトリに入れる

```powershell
# キットを置いた場所（例）
cd C:\AllGitRepository\daily-log-kit
node --test install.test.mjs

cd C:\AllGitRepository\RPGMZ_prototype
git switch -c chore/daily-log
node ..\daily-log-kit\install.mjs . --dry-run     # 変更予定の確認
node ..\daily-log-kit\install.mjs . --backfill    # 導入＋過去の日報
node --test tools/daily-log.test.mjs tools/daily-log-analyze.test.mjs tools/daily-log-brief.test.mjs
git add -A
git commit -m "chore: 日報の仕組みを導入（daily-log-kit v1.10.4）"
git push -u origin chore/daily-log
gh pr create --fill
```

### B. 複数のリポジトリへ一括で入れる

```powershell
cd C:\AllGitRepository\daily-log-kit
# 初回だけ: スクリプトの実行を許可（このユーザーだけ）
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
Unblock-File .\install-all.ps1

# 1) 確認だけ（何も変えない）
.\install-all.ps1 -Backfill

# 2) 対象を絞って本番（ブランチ chore/daily-log にコミットし、PRを作る）
.\install-all.ps1 -Repos RPGMZ_prototype,yukkuri-scenario-tool -Backfill -Apply -CreatePR

# 3) GitHub の自分のリポジトリのうち、未クローンのものもクローンして全部
.\install-all.ps1 -Owner Hamm-Coder -Backfill -Apply -CreatePR
```

一括導入の安全策:

- 既定は確認のみ。`-Apply` を付けたときだけコミットする
- 作業中のフォルダには触れない。一時的な worktree で作業するので、未コミットの変更や今いるブランチはそのまま
- LFS の素材はダウンロードしない（`GIT_LFS_SKIP_SMUDGE=1`）
- main に直接 push しない。PR にするので、各リポジトリでマージ前に確認・取り消しができる
- `chore/daily-log` ブランチが既にあるリポジトリは飛ばす
- ブランチ保護がある main には Actions が push できないので、該当リポジトリだけ `-NoWorkflow` で入れる（仕様書9章）

### C. Claude Code Web に頼む

`prompts/1-claude-code-install.md` の依頼文を各リポジトリのセッションに貼る。キットを GitHub に公開で置いておく必要がある（「GitHub での運用」の節）。キットを使えない環境では `prompts/2-claude-code-implement-from-spec.md` を使う。

## GitHub での運用

### 全体像

```
Hamm-Coder/daily-log-kit（公開）   ← キットの正本。改良はここだけで行う
        │  導入・更新のときだけ使う（日々の作業では参照しない）
        ▼
各リポジトリ（RPGMZ_Prototype など）  ← キットの中身がコピーされ、単独で動く
        tools/daily-log.mjs, Stop フック, Skill, Actions, docs/log/
```

- 導入後、各リポジトリはキットのリポジトリに依存しない。Claude Code（Web・PC）も GitHub Actions も、各リポジトリ内のファイルだけで動く
- キットのリポジトリを使うのは「導入」「更新」の2つの場面だけ

### 公開リポジトリを推奨する理由

| 項目 | 公開（推奨） | 非公開 |
| --- | --- | --- |
| Web 版 Claude Code からのクローン | 設定なしで可（GitHub App 接続では公開リポジトリは常に読める） | Claude GitHub App をキットのリポジトリにも入れる必要がある |
| 中身の秘密性 | 秘密情報は含まない（ツールと手順だけ。日報本体は各リポジトリ側） | — |
| 費用 | 0円 | 0円 |

### 1. 置く（1回だけ、PC）

```powershell
cd C:\AllGitRepository\daily-log-kit
node --test
git init -b main
git add -A
git commit -m "daily-log-kit v1.10.4"
gh repo create Hamm-Coder/daily-log-kit --public --source . --push
git tag v1.0.0
git push origin v1.0.0
```

各リポジトリで、GitHub の Settings > General > Pull Requests の **Automatically delete head branches** をオンにしておくと、マージ済みの導入ブランチが自動で消えて整理しやすい（必須ではない。一括導入は版ごとに別のブランチ名を使う）。

### 2. 既存のリポジトリに入れる（初回）

PC から一括（推奨）。実行する場所はキットのフォルダ。対象は `-Root`（既定 `C:\AllGitRepository`）直下の Git リポジトリで、キット自身は除外される:

```powershell
cd C:\AllGitRepository\daily-log-kit
.\install-all.ps1 -Backfill                                  # 確認のみ
.\install-all.ps1 -Backfill -Apply -CreatePR                 # 全リポジトリにPR
```

GitHub で各PRの差分（特に `docs/log/` の過去の日報）を見てマージする。マージ直後に Actions の `daily-log` が動き、成功すれば導入完了。

Web 版だけで入れる場合は、各リポジトリのセッションに `prompts/1-claude-code-install.md` を貼る。

### 3. 毎日（何もしなくてよい）

| 場面 | 起きること |
| --- | --- |
| Claude Code で作業 | 最後に日報メモを書いて同じPRに入れる（CLAUDE.md の指示と Stop フック） |
| PRをマージ | Actions が日報と一覧を作り直してコミット |
| PC で作業を始める | `git pull`（ボットの日報コミットを取り込む）。まとめて行うならキットのフォルダで `.\pull-all.ps1` |

### 4. 新しいリポジトリを作ったとき

- PC: `.\install-all.ps1 -Repos <新しいリポジトリ> -Apply -CreatePR`
- Web: セッションで「`https://github.com/Hamm-Coder/daily-log-kit` の install.mjs で日報の仕組みを導入してPRにして」と頼む

### 5. 新しい版の zip を受け取ったとき（publish-kit）

**実行する場所: キットのフォルダ `C:\AllGitRepository\daily-log-kit` の直下にある `publish-kit.bat`。** 各リポジトリやダウンロードフォルダでは実行しない。

| 方法 | 使う zip |
| --- | --- |
| zip をキットのフォルダに置いて `publish-kit.bat` をダブルクリック | ①キットのフォルダ ②ダウンロードフォルダ の順に探し、版番号が最大の `daily-log-kit-v*.zip`（キットのフォルダの zip は `.gitignore` でコミットされない） |
| zip を `publish-kit.bat` にドラッグ＆ドロップ | その zip |
| PowerShell で `.\publish-kit.ps1 -Zip <パス> [-Yes]` | 指定した zip（`-Yes` で確認を省略） |

処理: 事前確認（未コミットの変更なし・GitHub と同期）→ zip を一時フォルダに展開 → 版番号の確認（今より新しく未公開か）→ 上書きコピー → テスト（失敗なら元に戻す）→ 変更一覧の表示と確認 → コミット・タグ・push → 一時フォルダの削除。

途中で止まった場合、キットのフォルダは上書き前の状態に戻る（push の失敗だけは、コミットとタグが手元に残るので表示された1行を実行する）。

### 6. キットを改良して配る（Claude Code で直接直す。推奨）

1. キットのリポジトリ（`Hamm-Coder/daily-log-kit`）で Claude Code Web のセッションを開き、直したい内容と「版を上げてPRにして」を頼む（手順は `CLAUDE.md` にある。依頼文は `prompts/5-claude-code-kit-improve.md`）
2. PR の差分を見てマージする。`kit-release.yml` がテストを通してから、タグ `v<版>` とリリースを自動で作る
3. PC で配る:

```powershell
cd C:\AllGitRepository\daily-log-kit
git pull
.\install-all.ps1                    # 確認のみ
.\install-all.ps1 -Apply -CreatePR   # 導入済みの全リポジトリに「更新」のPR
```

チャットで作った zip を使う場合は「5. 新しい版の zip を受け取ったとき」（publish-kit）。PC で手作業で直す場合は、`node --test` → `node bump-version.mjs <版>` → 変更履歴に1行 → コミット → push（タグは `kit-release.yml` が作る）。

- 更新されるのはキットのファイル（先頭付近に `daily-log-kit v` の印があるもの）と CLAUDE.md の日報の区間だけ。日報メモ、生成済みの日報、`docs/log/config.json` は変わらない
- 手元のキットが GitHub より古いと、一括導入は警告して止まる（古い版を配らないため）
- 版番号の付け方: 不具合の修正は 1.0.1、機能の追加は 1.1.0、日報メモの形式を変えるなど既存のメモに影響する変更は 2.0.0

## 変更履歴

| 版 | 日付 | 内容 |
| --- | --- | --- |
| 1.10.4 | 2026-11-23 | ダッシュボードの「日報メモの書き忘れ」の誤った表示を直す。① PR のマージだけの日を記録率に数えない（GoogleFlowCharacterMakingTools）② 日報メモの日付のずれを防ぐ（MangaCreation_Sys_withGAS で、`new-entry` を使わず手で作ったメモ7件が、UTC の日付で前の日のフォルダに入っていた）: 引き継ぎに「今日の作業日」を毎回出す、Skill に `new-entry` を必須と明記、Stop フックが `date:` の見出しがない・フォルダと日付が違うメモを1回知らせる（`check` の終了コード 5）。仕様 4.5 を追加 |
| 1.10.3 | 2026-11-22 | PR を続けてマージすると、`daily-log` Actions が失敗する不具合を修正（RPGMZ_Prototype で #81・#85・#86・#87 を1分以内にマージしたときに発生）。各回は起動したときのコミットから日報を作るため、先に別の回が日報を push していると `git pull --rebase` が自動生成の日報どうしで衝突し、やり直しても衝突の状態のまま失敗していた。push の前に最新の既定のブランチに合わせて（`fetch` と `reset --hard`）日報を作り直すようにした。古いワークフローで失敗し、新しいもので通る検査を追加 |
| 1.10.2 | 2026-11-21 | 既定のブランチを取り込んだ（merge）作業ブランチで、`check`（Stop フック）が取り込んだ分のファイルまで作業ブランチの変更と数えていた不具合を修正。分岐点からの差分のうち、既定のブランチと中身が同じものは除く（lifelog_with_GAS #4 の衝突を解決したときに、自動生成の日報の誤った知らせとして見つかった） |
| 1.10.1 | 2026-11-21 | PR を続けてマージすると、自動生成の日報（`docs/log/YYYY-MM/`、`docs/log/README.md`）で衝突する不具合を修正（RPGMZ_Prototype #74 で発生）。Skill が日報を作り直して `docs/log` ごとコミットしていたため、PR に自動生成のファイルが入っていた。PR に入れるのは日報メモ（`docs/log/entries/`）だけにし（仕様 4.4）、作業ブランチで自動生成の日報が変わっていたら Stop フックが1回知らせて、既定のブランチの内容に戻すコマンドを示す（`check` の終了コード 4） |
| 1.10.0 | 2026-11-18 | 日報メモだけの PR をマージするたびに、その記録のためにまたメモと PR を作る循環を止める。Skill・`CLAUDE.md` の日報の区間・仕様（4.3）に「日報メモを書かないとき」（日報メモだけの PR のマージの確認、Actions の結果の確認、質問への回答だけ）と「『PR #N をマージした』はメモに書かない（日報に自動で載る）」を追加。分析と引き継ぎは、日報の仕組み自身のコミット（キットの導入・更新、日報の自動更新、日報メモ、日報の設定、日報メモだけの PR のマージ）を作業・PR・記録率・繰り返しに数えない。日報メモだけの PR で入ったメモは「似た作業」「次にやることの繰り越し」に数えない。判定はダッシュボードと共通（`files/tools/daily-log-analyze.mjs` に移した） |
| 1.9.1 | 2026-11-16 | GitHub で既定のブランチを変えた後（例: `claude/...` から main へ）、更新の PR が古いブランチ向けに作られる不具合を修正。`install-all.ps1` と `pull-all.ps1` が実行のたびに GitHub の既定のブランチを確かめ直す（手元の `origin/HEAD` は clone したときのままで、`git fetch` では変わらないため）。変わっていたら表示する。古いブランチを消した後でも、`install-all.ps1` が失敗せず、`pull-all.ps1` と `dashboard.ps1` が対象から外さない |
| 1.9.0 | 2026-11-14 | `dashboard.ps1`（`dashboard.mjs`）を追加: 日報の仕組みを入れたリポジトリとキット本体を1画面の HTML で見る（要約・一覧・詳細。キット本体以外はキット・日報のコミットを除いて数える）。分析ツール: `excludeCommit` の指定でコミットを除けるようにし、15ファイルを超えるファイルをまとめて直したコミット（版の更新など）を「同じファイルの修正の集中」に数えないようにした |
| 1.8.0 | 2026-11-14 | 日報メモに任意の見出し「詰まったこと」「手応え（1〜5）」を追加（仕様 4.2）。分析に手応えの平均（直近・週ごと）と詰まったことの一覧、改善点 low-feel・repeated-blocker を追加。セッション開始時の引き継ぎに「前回詰まったこと」。日報メモの雛形・Skill・依頼文4を更新。どちらも任意で、既存のメモはそのまま使える |
| 1.7.0 | 2026-11-14 | 週1回の分析を Issue にする（`.github/workflows/daily-log-weekly.yml`。`docs/log/config.json` に `"weeklyIssue": true` を書いたリポジトリだけ。毎週月曜の朝、同じ週なら更新し、前の週の分析の Issue は閉じる。仕様 12.5）。分析ツールに `--issue` を追加 |
| 1.6.0 | 2026-11-14 | `pull-all.ps1` が取り込む前に対象を番号つきで一覧にし、注意を出して「全部（A）」「番号で選ぶ（1つ・複数・範囲）」「やめる（Q/Enter）」を聞くようにした。`-Yes` で確認なしに全部、`-Repos` 指定時は確認しない。各リポジトリに配るファイルの動作は変わらない |
| 1.5.1 | 2026-11-14 | `pull-all.ps1` の修正: 取り込むファイルと同じ名前の未追跡ファイル（Unity の `ProjectSettings/ProjectVersion.txt` など）で止まらないようにした（同じ内容なら置き換え、違えば `.local` に退避。`-NoMoveUntracked` で従来どおり止める）。Windows PowerShell 5.1 で git のエラーが「発生場所…」付きで表示されるのを、本文だけの表示にした。各リポジトリに配るファイルの動作は変わらない |
| 1.5.0 | 2026-11-14 | 判断待ちの解決の記法（「決めたこと」に `解決: <項目> → <決めた内容>`）。解決した判断待ちは分析とセッション開始時の引き継ぎの一覧から外れ、分析には「解決した判断待ち」として出る（仕様 4.1）。日報メモの雛形・Skill・依頼文に書き方を追記。既存のメモはそのまま使える |
| 1.4.0 | 2026-11-14 | `pull-all.ps1` を追加（日報の仕組みを入れたリポジトリとキットを、まとめて `git pull --ff-only`。入れていないリポジトリは対象外。`-Repos`・`-Exclude`・`-All`・`-NoKit`）。各リポジトリに配るファイルは手順書の1行だけ変更 |
| 1.3.3 | 2026-11-14 | 既定のブランチが main・master 以外のリポジトリで、日報が自動で更新されなかった不具合を修正（`daily-log.yml` を「既定のブランチへの push」で動くように変更。ほかのブランチへの push は skipped と表示される）。更新の PR 本文の言い回しを修正（「v<版> に更新します」） |
| 1.3.2 | 2026-11-14 | キットの CI と自動リリースが初回から失敗していた不具合を修正（テスト用の GitHub 役リポジトリの既定ブランチを main に固定。`publish-kit.bat` を CRLF で保存し、`.gitattributes` で改行の変換を止める）。キットの改良を頼む依頼文（`prompts/5-claude-code-kit-improve.md`）を追加。各リポジトリに配るファイルの動作は変わらない |
| 1.3.1 | 2026-11-13 | 各リポジトリに導入・更新・再適用・取り外しの手順（`docs/procedures/daily-log-kit.md`）を配る。マニュアルのテキスト版（`docs/MANUAL.md`）。仕様書11章の案内先の食い違いを修正 |
| 1.3.0 | 2026-11-13 | セッション開始時の引き継ぎ（次にやること＋作業キュー、判断待ち、始める前の準備、効率化の候補）。繰り返しの判別（準備作業・似た作業・繰り越し・修正の集中）を分析にも追加。準備のルール（config.json の prep） |
| 1.2.0 | 2026-11-13 | 分析ツール（傾向・改善点・判断待ち、複数リポジトリ対応）。キットの決まりの検査、Windows の通しテストと CI、自動リリース。引き継ぎ資料（CLAUDE.md・SPEC.md・HANDOFF.md・ADR）とマニュアル。`publish-kit.bat` の改行を CRLF に修正。`extras/` を削除 |
| 1.1.2 | 2026-11-13 | `publish-kit` の zip をキットのフォルダから優先して探す（次にダウンロードフォルダ）。版番号が最大の zip を使う。`.gitignore` で zip をコミット対象から除外 |
| 1.1.1 | 2026-11-13 | `publish-kit.bat` / `publish-kit.ps1` を追加（新しい版の zip を GitHub に反映する作業を1回の実行にまとめる） |
| 1.1.0 | 2026-11-13 | `docs/decisions/` があるリポジトリに、日報の ADR を「採用」で自動作成（既にあれば作らない。`--no-adr` / `-NoAdr` で無効） |
| 1.0.1 | 2026-11-12 | 一括導入でキット自身を対象から除外。PR作成後に手元の作業用ブランチを削除 |
| 1.0.0 | 2026-11-10 | 最初の版 |

## 過去の分の作り方

| 情報源 | 方法 |
| --- | --- |
| Git のコミット・PRマージ | `--backfill`（`generate --all`）で全自動 |
| マージ済みPRの説明文 | 依頼文1の手順5（Claude Code が `gh` で読んで要約） |
| PC の Claude Code の会話記録 | `node tools/daily-log.mjs transcripts --since 2026-10-01` の出力を Claude Code に要約させる。記録は既定で30日で消えるので、残すなら `~/.claude/settings.json` に `"cleanupPeriodDays": 365`（0 は記録自体が止まる不具合の報告があるので使わない） |
| Web 版 Claude Code のセッション | 会話はリポジトリに残らない。コミットとPR説明文から復元される |
| claude.ai のチャット | 依頼文3（過去チャット検索 → 日報メモの zip） |

## 取り除くとき

`tools/daily-log*.mjs`、`.claude/hooks/daily-log-reminder.mjs`、`.claude/skills/daily-log/`、`.github/workflows/daily-log.yml`、`.github/workflows/daily-log-weekly.yml`、`docs/specs/daily-log.md`、`docs/procedures/daily-log.md` を削除し、`.claude/settings.json` の Stop フック1件と `CLAUDE.md` の日報の区間を消す。`docs/log/` は残してよい。

## 確認済みの範囲

最新の状況は `docs/HANDOFF.md` の「確認済みの範囲」を見る。要点:

- 単体テストとキットの決まりの検査: `node --test` で39件成功（Node.js 22）
- 一括導入と反映の通しテスト（`tests/e2e.ps1`）: PowerShell 7.4 で成功。Windows PowerShell 5.1 と実際の robocopy は `kit-ci.yml` で確認する
- GitHub 上の Actions と `-CreatePR` は、最初の実行で確認する（`SPEC.md` の K1〜K4）
