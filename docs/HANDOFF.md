# 引き継ぎ資料（daily-log-kit）

- 作成日: 2026-11-13（最終更新: 2026-11-14）
- 対象: このキットの開発を Claude Code（Web版・PC版）で続けるための資料
- キットの版: `install.mjs` の `KIT_VERSION` を見る（最終更新の時点は v1.7.0）

## 1. このキットは何か

Claude Code を使う各リポジトリに、日報の仕組みを入れる道具一式。

```
Hamm-Coder/daily-log-kit（公開）          ← このリポジトリ。キットの正本。改良はここだけ
        │ install-all.ps1 / install.mjs（導入・更新のときだけ）
        ▼
各リポジトリ（RPGMZ_Prototype など）       ← files/ の中身がコピーされ、単独で動く
   作業 → 日報メモ（docs/log/entries/）→ PR → マージ → Actions が日報（docs/log/YYYY-MM/）を作り直す
```

- 人（または Claude）が書くのは「日報メモ」だけ。日報と一覧は Git の履歴とメモから自動生成
- 書き忘れは Stop フックが1回だけ促す
- 分析ツール（`tools/daily-log-analyze.mjs`）が、傾向・改善点・判断待ちを一覧にする

## 2. 利用者の環境

| 項目 | 内容 |
| --- | --- |
| OS / シェル | Windows、PowerShell（コマンドは PowerShell 前提で書く） |
| リポジトリの置き場所 | `C:\AllGitRepository\<リポジトリ>`。キットは `C:\AllGitRepository\daily-log-kit` |
| GitHub | `Hamm-Coder`。キットのリポジトリは公開 |
| 開発の主軸 | Claude Code Web。PC はテストとエディタが必要な作業 |
| タイムゾーン | 日本時間。作業日の区切りは朝4時（深夜作業が多いため） |

## 3. 経緯（日付は日本時間）

| 日付 | 出来事 |
| --- | --- |
| 11/10 | RPGMZ_Prototype の活動ログを手作業で作成。11/03〜07 はコミットがなく、claude.ai の過去チャット検索で復元した。発言ごとの日時がないため一部は推定、曜日の誤りもあった → 仕組みで残す必要があると判断 |
| 11/10 | キット v1.0.0 を作成（生成ツール、Stop フック、Skill、Actions、導入スクリプト、一括導入、依頼文、RPGMZ 用の追加ファイル） |
| 11/10 | GitHub での運用に合わせ、版番号の一括変更、版ごとのブランチ名、古いキットの検知を追加 |
| 11/12 | 一括導入の対象からキット自身を除外、PR 作成後に手元の作業用ブランチを削除（v1.0.1）。利用者が GitHub に公開リポジトリを作り、v1.0.0 → v1.0.1 を反映 |
| 11/13 | RPGMZ_Prototype に導入（PR で 67 コミット・25 PR を確認、チャット分の日報メモ7件を追加）。ADR 0011 の採用を Web 版に依頼 |
| 11/13 | v1.1.0: ADR を最初から「採用」で自動作成（PR のマージ＝採用） |
| 11/13 | v1.1.1: `publish-kit.bat` / `.ps1`（zip の反映を1回の実行に） |
| 11/13 | v1.1.2: zip をキットのフォルダから優先して探す、版番号の最大を選ぶ、`.gitignore` で zip を除外 |
| 11/13 | Unity_CharacterTest で `git pull` が `ProjectVersion.txt`（未追跡）と衝突。退避して pull する手順で対応（キットの不具合ではない） |
| 11/13 | v1.2.0: 分析ツール、キットの決まりの検査、Windows の通しテストと CI、自動リリース、引き継ぎ資料、マニュアル。検査で `publish-kit.bat` の改行が LF になっていた不具合を発見し CRLF に修正 |
| 11/13 | v1.3.0: セッション開始時の引き継ぎ（次にやること＋作業キュー、判断待ち、始める前の準備、効率化の候補）と、繰り返しの判別（準備作業・似た作業・繰り越し・修正の集中）。ADR 0008 |
| 11/13 | v1.3.1: 各リポジトリに導入・更新・再適用・取り外しの手順（`docs/procedures/daily-log-kit.md`）を配る。マニュアルのテキスト版（`docs/MANUAL.md`）。仕様書11章の案内先の食い違いを修正。`extras/` を削除（RPGMZ_Prototype に反映済み） |
| 11/13 | v1.3.0 と v1.3.1 を publish-kit で GitHub に反映（タグ v1.3.0・v1.3.1）。これが Actions の初めての実行になり、`kit-ci` は3回、`kit-release` は2回、すべて失敗。リリースは1件もできなかった（この時点では気づいていない） |
| 11/14 | 開発を claude.ai のチャットから Claude Code に引き継ぎ。Actions のログから失敗の原因2件を特定し、SPEC の K1〜K5 に結果を記録。①テスト用の GitHub 役（bare リポジトリ）の既定ブランチが環境まかせで `git remote set-head origin --auto` が失敗 ②`publish-kit.bat` がリポジトリに LF で入っていた（v1.2.0 で手元だけ CRLF に直り、Windows の autocrlf がコミット時に LF へ戻していた） |
| 11/14 | v1.3.2: 上の2件を修正（bare リポジトリを `-b main` で作る。`.bat` を CRLF で保存し `.gitattributes` の `*.bat -text` で変換を止める。検査を1件追加）。キットの改良を頼む依頼文（`prompts/5-claude-code-kit-improve.md`）と、`CLAUDE.md` の「PR を作った後」の手順を追加。初めて PR 経由で反映する。PR の `kit-ci` は全ジョブ成功（SPEC K1 完了） |
| 11/14 | v1.3.2 の PR（#1）をマージ。`kit-release` が成功し、タグ v1.3.2 とリリース v1.3.2 ができた（SPEC K2 完了。リリースは初めて） |
| 11/14 | 利用者が claude.ai のチャットでの配布の結果をまとめ、SPEC の K3〜K5 に記録。RPGMZ_Prototype: `daily-log` Actions は成功（ボットのコミット e0755f6）、ADR 0011 は Web版で「採用」に変更済み、v1.3.1 の更新 PR は未マージ（差分は想定どおり）、マージ済みの `chore/daily-log-v1.0.1` ブランチが GitHub に残っている（削除と Automatically delete head branches の設定を案内済み）。automaticPromptsMaker にも `-CreatePR` を実行（PR の結果は未確認）。Unity_CharacterTest の導入状況は未確認。v1.3.0 の publish-kit で出た「zip にないファイル（extras/ の9件）を残す」は想定どおりの表示 |
| 11/14 | 利用者が PC から v1.3.2 を5リポジトリ（RPGMZ_Prototype、automaticPromptsMaker、promptBatchExportTool、MangaCreation_Sys_withGAS、A1111_SD_TokenCounter）に配布し、すべてマージ（SPEC K4・K5 完了）。キットのセッションにこの5つを追加して導入状況を確認し、RPGMZ_Prototype 以外の4つは既定のブランチが `claude/...` で main がなく、`daily-log` Actions が一度も動いていないことを発見（日報はキットの更新 PR のときにしか増えていなかった） |
| 11/14 | v1.3.3: `daily-log.yml` を「既定のブランチへの push」で動くように変更（名前を決め打ちしない。ほかのブランチでは skipped）。検査を1件追加。更新の PR 本文の言い回しを修正 |
| 11/14 | v1.3.3 をマージ・リリースし、利用者が5リポジトリに配布。既定のブランチが main 以外の4リポジトリで `daily-log` Actions が初めて動き、成功（SPEC K6 完了。K1〜K6 はすべて完了） |
| 11/14 | v1.4.0: `pull-all.ps1`（日報の仕組みを入れたリポジトリとキットをまとめて `git pull --ff-only`。入れていないリポジトリは対象外）。利用者の依頼（同じフォルダに管理対象でないリポジトリがある）による |
| 11/14 | v1.4.0 の PR が通しテストの修正より先にマージされ、main の `kit-ci` が一時的に失敗（`pull-all.ps1` 本体ではなくテストの準備の誤り）。修正の PR（#5）で緑に戻した。`pull-all.ps1` は Windows PowerShell 5.1 と 7 の通しテストで確認済み |
| 11/14 | SPEC M8: キットのセッションに RPGMZ_Prototype を追加し、`docs/log/config.json` に準備のルール（`prep`）5つを書いて PR（RPGMZ_Prototype #44）にした |
| 11/14 | v1.5.0: 判断待ちの解決の記法（「決めたこと」に `解決: <項目> → <決めた内容>`。仕様 4.1）。解決した判断待ちは分析と引き継ぎの一覧から外れ、分析に「解決した判断待ち」として出る。解決の後にまた書かれたら戻る（SPEC M2 完了） |
| 11/14 | 利用者が PC で `pull-all.ps1` を初めて実行。Unity_CharacterTest で、未追跡の `ProjectSettings/ProjectVersion.txt` と取り込むファイルがぶつかって失敗し、Windows PowerShell 5.1 が git のエラーを「発生場所…」付きで表示した。v1.5.1 で、同じ内容なら置き換え・違えば `.local` に退避して取り込むようにし、エラーの表示を本文だけにした |
| 11/14 | v1.6.0: 利用者の依頼で、`pull-all.ps1` が取り込む前に対象を一覧にし、注意を出して全部・選んだもの・やめるを選ばせるようにした（`-Yes` で確認なし） |
| 11/14 | v1.7.0: 週1回の分析を Issue にする `daily-log-weekly.yml`（`weeklyIssue: true` のリポジトリだけ。毎週月曜 8:17、同じ週は更新、前の週は閉じる。仕様 12.5）。偽の gh を使った手元の再現で、無効・作成・更新・古い週を閉じる・手動実行を確認（SPEC M3 完了） |
| 11/14 | v1.7.0 を5リポジトリに配布。RPGMZ_Prototype で `weeklyIssue` を有効にした（RPGMZ_Prototype #47）が、`daily-log-weekly.yml` が GitHub にワークフローとして登録されず Actions の一覧に出なかった（ほかの4リポジトリは登録済み。中身は同じで YAML も正しい）。ファイルにコメントを1行足す PR（#48）のマージで登録され、手動実行で Issue #49「日報の分析（2026-11-09 の週）」ができた（GitHub 上で初めて確認） |

## 4. 確認済みの範囲

| 対象 | 状態 | 方法 |
| --- | --- | --- |
| 単体テスト・結合テスト（ツール・分析・引き継ぎ・導入・キットの決まり・フック） | 56件成功 | Node.js 22（Linux、Claude Code Web）。GitHub の Actions では v1.3.1 まで失敗（SPEC K1）、v1.3.2 で修正 |
| セッション開始時の引き継ぎ | 成功 | RPGMZ_Prototype に似せた履歴で、Web版として実行。PC作業の印、作業キューの行、準備のルール、繰り越しの検出を確認 |
| `install-all.ps1` / `publish-kit.ps1` の通し | 成功 | `tests/e2e.ps1` を PowerShell 7.4（Linux、robocopy は代替）で実行。GitHub は bare リポジトリで代用 |
| 分析ツール | 成功 | RPGMZ_Prototype に似せた履歴（46コミット、15 PR、深夜作業、放置ブランチ、大きな取り込み）と、1,500コミットの古い Android 風リポジトリ |
| RPGMZ_Prototype への導入 | PR の内容を利用者が確認（件数が Git 履歴と一致） | 実機 |
| Windows PowerShell 5.1 での `install-all.ps1`（確認のみ・本番）と分析ツール | 成功 | `kit-ci` の e2e-windows（v1.3.1、Windows PowerShell 5.1.26100）。通しテストの 1〜3 |
| Windows PowerShell 5.1 での `publish-kit.ps1`（実際の robocopy）、PowerShell 7 の通し | 成功 | v1.3.2 の PR の `kit-ci` の e2e-windows（v1.3.1 まではテストの不具合の巻き添えで失敗・未実行だった） |
| GitHub 上の Actions（kit-ci） | 成功（v1.3.2 の PR。unit 4通りと e2e-windows） | SPEC K1 |
| GitHub 上の Actions（kit-release） | 成功（v1.3.2 の PR のマージでタグとリリースを作成） | SPEC K2 |
| GitHub 上の Actions（各リポジトリの daily-log） | 成功（5リポジトリ。既定のブランチが main 以外の4つは v1.3.3 から） | 実機。SPEC K3・K6 |
| 週1回の Issue（`daily-log-weekly.yml`） | 成功（RPGMZ_Prototype の手動実行で Issue #49 を作成。件名・ラベル・本文を確認）。同じ週の更新と前の週を閉じる動きは、手元の再現だけで確認（GitHub 上は 11/16 の定期実行で確かめる） | 実機、手元の再現 |
| `pull-all.ps1` | 実機（Windows PowerShell 5.1）で6リポジトリの取り込みと対象外の判別に成功。未追跡ファイルとのぶつかりは v1.5.1 で対応（退避・置き換え・失敗時の復元・履歴の分かれ・エラー表示を通しテストに追加） | 実機、`kit-ci` の e2e-windows |
| `-CreatePR`（gh） | 成功（5リポジトリに導入と更新の PR。本文に版と ADR の説明あり）。PowerShell の版は未確認 | Windows の実機。SPEC K4 |
| `publish-kit.bat`（Windows PowerShell 5.1 の実機） | 成功（v1.3.0・v1.3.1 を反映） | 実機 |

## 5. 設計の要点（詳細は `docs/decisions/`）

| ADR | 決定 |
| --- | --- |
| 0001 | 人が書くのはセッションごとのメモ、日報は自動生成（並行 PR で衝突しない、出力は決定的） |
| 0002 | 作業日は朝4時区切り（深夜作業を前日に含める） |
| 0003 | 配布は worktree で作業して PR にする（作業フォルダ・未コミットの変更に触れない） |
| 0004 | キットのリポジトリは公開（Web 版 Claude Code から設定なしで読める） |
| 0005 | 導入時の ADR は「採用」で作る（PR のマージ＝採用） |
| 0006 | 反映用は .bat（呼び出し1行）＋ .ps1（処理本体） |
| 0007 | 分析は傾向の目安に限り、成果の評価に使わない |
| 0008 | セッション開始時に日報から引き継ぎ、準備作業と繰り返しを示す |

## 6. 既知の制限

- Web 版 Claude Code の会話はリポジトリに残らない。日報メモに書かれた要約だけが残る
- claude.ai のチャットの決定は自動では入らない（依頼文4でその日の終わりにメモ化、依頼文3で過去分を補完）
- PC の Claude Code の会話記録（`transcripts`）は形式が非公式で、既定では30日で消える
- 作業時間はコミットの間隔からの推定で、コミットしない作業は入らない
- 判断待ちの「解決」は、「決めたこと」の `解決:` で判断する（v1.5.0）。書き忘れた項目は、新しいメモに書かれなくなれば期間を過ぎて消えるだけで、解決したかは分からない。`解決:` の項目と判断待ちの照合は文字の包含で、言い換えると一致しない
- 繰り返しの判別は文字の重なりによる推定。言い回しが大きく違う同じ作業は見逃し、同じ言葉を含む別の作業をまとめることがある（SPEC M7）

## 7. 次の一手（推奨順）

1. v1.4.0 の PR をマージし、PC のキットのフォルダで `git pull`。以後は `.\pull-all.ps1` でまとめて取り込める（各リポジトリへの配布は、次の版とまとめてよい）
2. マージ済みの `chore/daily-log-v…` ブランチを各リポジトリから消す（Automatically delete head branches の設定を勧める）
3. SPEC M8: RPGMZ_Prototype の PR #44 をマージし、PC で引き継ぎの「始める前の準備」の表示を確かめる
4. SPEC L1: Unity_CharacterTest などへの導入（導入状況の確認から）
5. v1.5.0 の PR をマージし、`.\install-all.ps1 -Repos <5つ> -Apply -CreatePR` で配る
6. 11/16（月）の定期実行で、RPGMZ_Prototype の Issue が新しい週の分析に置き換わり、#49 が閉じられるか確かめる

## 8. 新しいセッションでの始め方（Claude Code に貼る）

```
このリポジトリ（daily-log-kit）の開発を引き継いでください。CLAUDE.md、docs/HANDOFF.md、SPEC.md を読み、
今の状態と次にやること（SPEC の作業キュー）を3行で要約してから、私が指定した作業キューの項目に着手してください。
作業の終わりに SPEC.md の状態と docs/HANDOFF.md の経緯を更新してください。
```

改良を頼むだけなら `prompts/5-claude-code-kit-improve.md` の依頼文（「直して、版を上げて PR にして」）を使う。
