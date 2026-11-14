# 日報キット 操作マニュアル（テキスト版）

- 対象: daily-log-kit（`install.mjs` の `KIT_VERSION` が今の版）
- 図入りの版: `docs/manual/index.html`（ダウンロードしてブラウザで開く）
- 仕様: `files/docs/specs/daily-log.md`

Claude Code・claude.ai・Git での作業と決定を、各リポジトリの `docs/log/` に日ごとに残し、作業の傾向と改善点を確かめるための道具一式。人が書くのは短い「日報メモ」だけで、日報そのものは自動で作られる。

## 1. 実行する場所は4つ

| 場所 | パス | そこでやること |
| --- | --- | --- |
| キットのフォルダ | `C:\AllGitRepository\daily-log-kit` | 新しい版の反映（`publish-kit.bat`）、各リポジトリへの配布（`install-all.ps1`）、複数リポジトリの分析 |
| 各リポジトリ | `C:\AllGitRepository\<リポジトリ>` | `git pull`、日報の手動生成、そのリポジトリの分析 |
| GitHub | github.com（ブラウザ） | PR の確認とマージ、Actions の結果の確認 |
| Web版 / claude.ai | Claude Code Web、claude.ai のチャット | 作業、日報メモ、「作業を分析して」、チャットの決定のメモ化 |

`publish-kit.bat` と `install-all.ps1` は、ダウンロードフォルダや各リポジトリの中では実行しない。キットのフォルダで実行する。

## 2. 全体像

```
Hamm-Coder/daily-log-kit（公開。キットの正本）
   │  install-all.ps1 が各リポジトリに PR を作る（導入・更新のときだけ）
   ▼
各リポジトリ
   セッション開始 → 引き継ぎ（次にやること・準備・効率化の候補）
   作業 → 日報メモ（docs/log/entries/）→ PR → マージ
   → GitHub Actions が日報（docs/log/YYYY-MM/）と一覧を作り直す
```

導入すると各リポジトリにファイルがコピーされ、その後はキットなしで動く。

## 3. 日報ができるタイミング

| タイミング | 仕組み | 起きること |
| --- | --- | --- |
| セッションを始めるとき | SessionStart フック | 次にやること・判断待ち・始める前の準備・効率化の候補を Claude に渡す |
| 応答の終わり | Stop フック | 日報メモがなければ1回だけ促す |
| PR を作る前 | `daily-log` Skill | 日報メモを書いて同じ PR に入れる |
| マージ | GitHub Actions | 日報と一覧を作り直す |
| チャットで決めた日の終わり | 依頼文4（`prompts/4-claude-ai-daily-wrapup.md`） | 日報メモにして Web版に渡す（頼む必要あり） |
| 週1回 | 分析ツール | 改善点・繰り返し・判断待ちの一覧。`config.json` に `"weeklyIssue": true` を書くと、毎週月曜の朝に Issue で届く |

作業日の区切りは朝4時（`docs/log/config.json` の `dayStartHour`）。0:00〜3:59 の作業は前日に数え、日報では「翌00:13」のように表示する。

## 4. 導入（初回）

1. **キットを GitHub に置く**（キットのフォルダ。済んでいれば不要）
   ```powershell
   Expand-Archive daily-log-kit-v<版>.zip -DestinationPath C:\AllGitRepository
   cd C:\AllGitRepository\daily-log-kit
   node --test
   git init -b main
   git add -A
   git commit -m "daily-log-kit v<版>"
   gh repo create Hamm-Coder/daily-log-kit --public --source . --push
   ```
2. **スクリプトの警告を外す**（初回だけ）: `Unblock-File .\install-all.ps1, .\pull-all.ps1, .\dashboard.ps1, .\publish-kit.ps1, .\publish-kit.bat`
3. **変更の確認**: `.\install-all.ps1 -Backfill`（何も変えない）
4. **1つだけ本番**: `.\install-all.ps1 -Repos RPGMZ_prototype -Backfill -Apply -CreatePR`
5. **GitHub で PR を確認してマージ**。Actions の `daily-log` が緑になれば完了
6. **各リポジトリで取り込む**: `cd C:\AllGitRepository\RPGMZ_prototype` → `git pull`
7. **残りにも入れる**: `.\install-all.ps1 -Backfill -Apply -CreatePR`（導入済みは「変更なし」になる）

## 5. 毎日の使い方

| 場面 | やること |
| --- | --- |
| Claude Code で作業する日 | 始めは「前回の続きをして」で通じる（引き継ぎが自動で渡される）。最後に「日報を書いて」 |
| claude.ai で決めた日 | チャットの最後に依頼文4を貼り、出てきたメモを Web版に「日報メモとして追加して」 |
| PC で作業を始めるとき | 最初に `git pull`。Unity などのエディタは pull の後で開く |
| 週に1回 | Web版で「作業を分析して」 |

日報メモの見出しは「決めたこと／作ったもの・変えたもの／次にやること／未解決・判断待ち」。「決めたこと」はあなたが決めた・承認したことだけ。PC でしかできない作業には「（PC）」を付ける。

任意で「詰まったこと」（時間がかかったこと・止まったこと）と「手応え（1〜5）」も書ける。詰まったことは次のセッションの引き継ぎに出て、分析では同じことで何度も詰まっていないかを見る。手応えは自分の振り返りの目安で、評価には使わない（「今日の手応えは4」と Claude に言えば書いてくれる）。

判断待ちを決めたら、「決めたこと」に `解決: <判断待ちの項目> → <決めた内容>` と書く（例 `- 解決: ボスの名前 → ヴォルクに決定`）。判断待ちの一覧から外れ、分析では「解決した判断待ち」に出る。Claude に「ボスの名前はヴォルクに決めた。日報に書いて」と頼めば、この形で書く。

### 週1回の分析を Issue で受け取る（任意）

各リポジトリの `docs/log/config.json` に `"weeklyIssue": true` を足して PR にする（Web版に「週1回の分析を Issue にする設定を入れて」と頼めばよい）。マージすると、毎週月曜の朝（8:17ごろ）に「日報の分析（<月曜日> の週）」という Issue ができる。前の週の分析の Issue は自動で閉じる。試すときは、GitHub の Actions の画面で `daily-log-weekly` を選び「Run workflow」。止めるときは `false` に戻す。

## 6. セッション開始時の引き継ぎ

セッションを始めると、次の4つが Claude に渡される。

- **次にやること**: 最新の日報メモから。作業キューの番号（例 D4）があれば SPEC.md の完了条件と実行場所を添える。Web版では PC の作業に「この環境ではできない」と付く
- **前回詰まったこと**: 最新のメモの「詰まったこと」（書いたときだけ）
- **判断待ち**: 直近のメモから、最初に出た日と回数つき（`解決:` を書いたものは出ない）
- **始める前の準備**: `git pull` が要るか、未コミットの変更、`node_modules` がない、Git LFS がない、作業中のブランチ。次の作業に合う準備のルール
- **効率化の候補**: 準備作業や似た作業の繰り返し、繰り越し、修正の集中

準備のルールは各リポジトリの `docs/log/config.json` に書く。

```json
{
  "prep": [
    { "when": "テストプレイ", "steps": ["git pull してから RPG Maker MZ でプロジェクトを開く", "game/data を編集する作業は先にエディタを閉じる"] },
    { "when": "プラグイン管理", "steps": ["プラグイン管理で追加した CF_ プラグインを ON にして保存"] }
  ]
}
```

止めたいときは環境変数 `DAILY_LOG_SKIP=1`。

## 7. 新しい版の反映

### A. Claude Code で直接直す（推奨）

1. キットのリポジトリの Web版セッションで、直したい内容と「版を上げて PR にして」と頼む（手順は `CLAUDE.md`、依頼文は `prompts/5-claude-code-kit-improve.md`）
2. GitHub で `kit-ci` が緑なのを確認してマージ。`kit-release` がタグとリリースを作る
3. キットのフォルダで `git pull` → 8章の更新へ

### B. チャットで作った zip を使う（publish-kit）

1. zip をキットのフォルダに置く（ダウンロードフォルダでもよい。キットのフォルダが優先、版番号の一番大きいものを使う。置いた zip はコミットされない）
2. `publish-kit.bat` をダブルクリック（zip をドラッグ＆ドロップしてもよい）
3. 変更一覧を見て `y`。テストが失敗したときや `y` 以外は、元の状態に戻して止まる
4. zip にないファイルは消さずに残る（「注意: 次のファイルは zip にありませんが…」と表示される）。不要なら `git rm -r <パス>` → `git commit` → `git push`

| publish-kit が止まる表示 | 対処 |
| --- | --- |
| 未コミットの変更があります | `git status` を見て、コミットするか元に戻す |
| zip の版が現在の版より新しくありません | 最新の zip か確認する |
| テストが失敗したため…元の状態に戻しました | 表示されたテスト名を Claude に伝える |
| zip が見つかりません | zip をキットのフォルダに置くか、ドラッグ＆ドロップ |
| push に失敗しました | ネットワークを確認し、表示された1行を実行 |

## 8. 各リポジトリへの配布・更新・再適用（install-all.ps1）

キットのフォルダで実行する。対象は `-Root`（既定 `C:\AllGitRepository`）直下の Git リポジトリで、キット自身は除外される。

```powershell
cd C:\AllGitRepository\daily-log-kit
git pull                              # キットを最新に（古いと警告して止まる）
.\install-all.ps1                     # 確認のみ
.\install-all.ps1 -Apply -CreatePR    # 各リポジトリに PR
```

その後、GitHub で各 PR をマージし、各リポジトリのフォルダで `git pull` する。まとめて行うなら `pull-all.ps1` を使う。

### まとめて git pull する（pull-all.ps1）

キットのフォルダで実行する。日報の仕組みを入れたリポジトリ（`tools/daily-log.mjs` がある）とキット自身だけを対象にし、同じフォルダにあるほかのリポジトリには何もしない。

```powershell
cd C:\AllGitRepository\daily-log-kit
.\pull-all.ps1                               # 一覧を出して、全部・選んだもの・やめるを選ぶ
.\pull-all.ps1 -Yes                          # 確認せずに全部
.\pull-all.ps1 -Exclude Unity_CharacterTest  # 1つ外す
.\pull-all.ps1 -Repos RPGMZ_prototype        # 名前で指定（確認しない）
```

実行すると、対象のリポジトリを番号つきで一覧にし、注意（取り込むのは今のブランチ、エディタは閉じる、など）を出してから、どれを取り込むかを聞く。

```
取り込む対象のリポジトリ（C:\AllGitRepository）:
  [1] A1111_SD_TokenCounter（ブランチ claude/festive-bell-dubjas）
  [2] daily-log-kit（ブランチ main）
  [3] RPGMZ_prototype（ブランチ main）
  対象外: GAS_LifeLogWebApps

どれを取り込みますか？
  A       … 全部
  番号    … 選んだものだけ（例 3、1,3,5、1-3。1つだけでもよい）
  Q/Enter … やめる（何もしない）
選択:
```

読めない入力や範囲外の番号は聞き直す（3回まで）。選ばなかったものは最後に「選ばなかったもの」として並ぶ。

| オプション | 意味 |
| --- | --- |
| （なし） | 日報の仕組みを入れたリポジトリとキットを一覧にし、どれを取り込むか聞く |
| `-Yes` | 確認せずに全部取り込む |
| `-Repos <名前,…>` | 指定したリポジトリだけ（日報の仕組みの有無は見ない。確認しない） |
| `-Exclude <名前,…>` | 指定したリポジトリを外す |
| `-All` | 直下の Git リポジトリを全部 |
| `-NoKit` | キット自身を外す |
| `-NoMoveUntracked` | 取り込むファイルと同じ名前の未追跡ファイルを退避せず、「失敗」と表示する |
| `-Root <フォルダ>` | 対象のフォルダ（既定 `C:\AllGitRepository`） |

- 早送りだけで取り込む（`git fetch` → `git merge --ff-only`）。手元と GitHub の履歴が分かれているリポジトリや、未コミットの変更が取り込むファイルと重なるリポジトリは「失敗」と表示して次へ進む（統合や上書きはしない）
- 取り込むファイルと同じ名前の未追跡ファイル（Unity が作る `ProjectSettings/ProjectVersion.txt` など）は、GitHub 側と同じ内容なら置き換え（「置き換え:」と表示）、違う内容なら `<ファイル名>.local` に退避してから取り込む（「退避:」と表示。消さない）。取り込みに失敗したら元に戻す。`.local` は中身を比べて、不要なら消す
- 取り込むのは今チェックアウトしているブランチだけ。ブランチは切り替えない
- 結果は1行ずつ「更新」「最新」「飛ばしました」「失敗」。対象にしなかったリポジトリは最後に「対象外」として並ぶ
- 導入の PR をマージしたばかりで一度も取り込んでいないリポジトリは、「対象外」になることがある。そのときは `-Repos` で名前を指定する

| オプション | 意味 |
| --- | --- |
| （なし） | 確認のみ。何も変えない |
| `-Apply` | ブランチ `chore/daily-log-v<版>` にコミットする |
| `-CreatePR` | push して PR を作る（GitHub CLI が必要）。手元の作業用ブランチは消す |
| `-Backfill` | 全履歴から過去の日報を作る（初回の導入で使う） |
| `-Repos A,B` | 対象を絞る |
| `-Owner Hamm-Coder` | GitHub にあって手元にないリポジトリをクローンしてから対象にする |
| `-NoWorkflow` | Actions を入れない（main にブランチ保護があるリポジトリ） |
| `-NoAdr` | 日報の ADR を作らない |

- 安全のための動き: 作業フォルダ・未コミットの変更・今のブランチに触れない（一時的な worktree で作業）。LFS の素材はダウンロードしない。main に直接 push しない
- 更新で変わるのは、キットのファイル（先頭に `daily-log-kit v` の印があるもの）、`CLAUDE.md` の日報の区間、`.claude/settings.json` のフック。日報メモ、生成済みの日報、`docs/log/config.json` は変わらない
- **再適用**（キットのファイルを消した・壊した、設定からフックを消した）: 同じコマンドで、足りない分を戻す PR ができる。同じ版のブランチが GitHub に残っていると飛ばされるので、マージ済みのブランチは消しておく（各リポジトリの Settings で Automatically delete head branches をオンにすると自動で消える）

### 1つのリポジトリだけ（PC で直接）

```powershell
cd C:\AllGitRepository\<リポジトリ>
git switch -c chore/daily-log
node C:\AllGitRepository\daily-log-kit\install.mjs . --dry-run
node C:\AllGitRepository\daily-log-kit\install.mjs .            # 初回は --backfill も
git add -A
git commit -m "chore: 日報の仕組みを更新"
git push -u origin chore/daily-log
gh pr create --fill
```

### 昔のリポジトリの過去の日報だけ作る

```powershell
cd C:\AllGitRepository\<リポジトリ>
node C:\AllGitRepository\daily-log-kit\files\tools\daily-log.mjs generate --all
```


### 全部のリポジトリを1画面で見る（dashboard.ps1）

キットのフォルダで実行する。日報の仕組みを入れたリポジトリとキット本体の状態を、1枚の HTML（`dashboard.html`）にしてブラウザで開く。手元の状態から作るので、先に `pull-all.ps1` で取り込んでおく。

```powershell
cd C:\AllGitRepository\daily-log-kit
.\pull-all.ps1 -Yes
.\dashboard.ps1
```

| 画面の部分 | 内容 |
| --- | --- |
| 上の要約 | 判断待ち、PC でしかできない作業、作業がない期間（30日以上・60日以上・100日以上の3段階）、日報メモの件数 |
| 一覧 | 1リポジトリ1行。最後の作業（日付と内容）、コミット数（直近24週／全期間）、次にやること・判断待ち・日報メモの件数、注意の改善点、直近24週のグラフ |
| 詳細 | これまでの作業（README.md の冒頭、HANDOFF.md または CHANGELOG.md の抜粋、最近のコミット5件）、次にやること、判断待ち、詰まったことと手応え、改善点（大きなコミットはここだけ）、最近の決定、直近24週のグラフ（4週ごとの日付つき） |

| オプション | 意味 |
| --- | --- |
| （なし） | 日報の仕組みを入れたリポジトリとキット本体 |
| `-Repos` / `-Exclude` / `-All` / `-NoKit` / `-Root` | 対象の選び方（`pull-all.ps1` と同じ） |
| `-Out <ファイル>` | 保存先（既定はキットのフォルダの `dashboard.html`） |
| `-NoOpen` | 作った後にブラウザで開かない |

- キット本体以外では、キットの更新・日報の自動更新・日報メモ・日報の設定のコミットを、作業として数えない（最後の作業、コミット数、グラフ、改善点のすべて）。判断は、件名（「日報の仕組み」「daily-log」「docs(log)」）と、変えたファイルがキットのファイルだけかどうかで行う
- 「これまでの作業」は決まった規則で抜き出したもので、要約ではない
- 数値は傾向の目安で、リポジトリ同士の優劣や成果の評価には使わない
- `dashboard.html` には非公開のリポジトリの内容が入る。`.gitignore` で除外してあるので、コミットや共有はしない
## 9. 分析

| 対象 | 場所 | コマンド |
| --- | --- | --- |
| 1つのリポジトリ | 各リポジトリ | `node tools/daily-log-analyze.mjs`（保存は `--out docs/log/analysis/<日付>.md`） |
| 複数を比べる | キットのフォルダ | `node files\tools\daily-log-analyze.mjs C:\AllGitRepository\A C:\AllGitRepository\B` |

Web版なら「作業を分析して」。数値は自分の作業の傾向をつかむ目安で、成果や生産性の評価には使わない。

| 改善点 | 出る条件（既定） | 次にやること |
| --- | --- | --- |
| 日報メモの書き忘れ | 導入後、コミットのあった日のメモが80%未満 | Stop フックの設定を確認 |
| 深夜のコミットが多い | 0〜4時が25%以上 | 深夜の PR は翌朝見直してからマージ |
| PR がマージまで長い | 中央値3日超 | PR を作業キュー1項目に絞る |
| 放置されたブランチ | 未マージで14日以上更新なし | 削除するか PR にする |
| 大きなコミット（情報） | 1000行または50ファイル以上 | 素材の取り込みなら不要 |
| 修正の割合が高い | 直近14日で30%以上 | テストや検査を作業キューに追加 |
| 判断待ちの繰り越し | 2回以上のメモに出て7日以上 | 次のチャットで決めるか期限を決める |
| PC作業がたまっている | 「（PC）」が5件以上 | PC作業の日を決める |
| 作業がない（情報） | 14日以上 | 最新メモの「次にやること」から再開 |
| 準備作業の繰り返し（提案） | 同じ種類の準備作業が3日以上 | スクリプトか Skill にまとめる |
| 似た作業の繰り返し（提案） | 似た作業が3日以上 | Skill か npm スクリプトにまとめる |
| 繰り越し | 同じ「次にやること」が3回以上のメモに残る | 着手できない理由を確かめる |
| 修正の集中 | 同じファイルの修正が30日で3回以上 | テストか検査を追加 |

しきい値は `docs/log/config.json` の `"analysis": { ... }` で変えられる。

## 10. 困ったとき

| 症状 | 対処 |
| --- | --- |
| `git pull` で「untracked working tree files would be overwritten」 | `.\pull-all.ps1` なら自動で退避して取り込む（v1.5.1 から）。手で行うときは、エディタを閉じ、表示されたファイルを別名に退避（`Move-Item <file> <file>.local`）してから `git pull`。中身を比べて不要なら消す。`git stash -u` や `git clean` は使わない |
| install-all で「リモートに chore/daily-log-v… が既にあります」 | 同じ版の PR が未マージ。マージするか閉じる。マージ済みならそのブランチを GitHub で消す |
| install-all で「キットが GitHub より N コミット古いです」 | キットのフォルダで `git pull` |
| Actions の一覧に `daily-log-weekly`（や `daily-log`）が出ない | GitHub がワークフローを登録し損ねている。そのファイルにコメントを1行足す PR を作ってマージすると、読み直されて一覧に出る（RPGMZ_Prototype で実際に起きた） |
| robocopy の終了コードが 1 や 3 | 成功（0〜7 は成功、8 以上が失敗） |
| Actions の daily-log が失敗する | ログを見る。「push に失敗」なら main のブランチ保護が原因。そのリポジトリはワークフローを消し、PR の中で `node tools/daily-log.mjs generate` する |
| .ps1 で「デジタル署名されていません」 | `Unblock-File <ファイル>`。`publish-kit.bat` はそのまま動く |
| 深夜の作業が前日として出る | 仕様（朝4時区切り）。暦日にするなら `dayStartHour` を `0` に |

## 11. ファイル早見表

キットのリポジトリ:

```
daily-log-kit/
├─ CLAUDE.md / SPEC.md / README.md
├─ files/              各リポジトリに配る中身
├─ install.mjs         1リポジトリに導入・更新
├─ install-all.ps1     一括で導入・更新・再適用
├─ pull-all.ps1        まとめて git pull（日報の仕組みを入れたリポジトリだけ）
├─ dashboard.ps1       複数リポジトリのダッシュボード（dashboard.mjs・dashboard-template.html）
├─ publish-kit.bat/.ps1  zip の反映
├─ bump-version.mjs    版番号の一括変更
├─ templates/  prompts/  tests/  .github/workflows/
└─ docs/               HANDOFF.md、MANUAL.md（このファイル）、analysis.md、decisions/、manual/
```

導入後の各リポジトリ:

```
<リポジトリ>/
├─ CLAUDE.md                        末尾に日報の区間
├─ tools/daily-log.mjs              日報の生成
├─ tools/daily-log-analyze.mjs      分析
├─ tools/daily-log-brief.mjs        セッション開始時の引き継ぎ
├─ .claude/settings.json            Stop と SessionStart のフック
├─ .claude/hooks/  .claude/skills/daily-log/
├─ .github/workflows/daily-log.yml
├─ .github/workflows/daily-log-weekly.yml   （週1回の分析を Issue に。既定は無効）
└─ docs/
   ├─ specs/daily-log.md            仕様
   ├─ procedures/daily-log.md       毎日・週1回の運用
   ├─ procedures/daily-log-kit.md   導入・更新・再適用・取り外し
   ├─ decisions/NNNN-daily-log.md
   └─ log/  README.md、config.json、entries/、YYYY-MM/
```
