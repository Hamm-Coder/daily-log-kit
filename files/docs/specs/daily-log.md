# 日報（日毎ログ）の仕様

- キット: daily-log-kit v1.0.1（どのリポジトリでも同じ内容。作品・製品ごとの差は `docs/log/config.json` だけで吸収する）
- 更新日: 2026-11-10

## 1. 目的

チャット（claude.ai）、Claude Code（Web版・デスクトップ版）、Git の作業を、日ごとに1ファイルへ集める。「いつ・何を決め・何を作り・次に何をするか」を、後から人もAIも同じ場所で読めるようにする。

## 2. 仕組みの全体

| 層 | 誰が書くか | 置き場所 | 中身 |
| --- | --- | --- | --- |
| 日報メモ | Claude Code（Skill）、人 | `docs/log/entries/YYYY-MM-DD/HHMM-件名.md` | 決めたこと・作ったもの・次にやること・未解決 |
| 日報 | `tools/daily-log.mjs`（自動） | `docs/log/YYYY-MM/YYYY-MM-DD.md` | その日の日報メモ＋PR＋コミット |
| 一覧 | `tools/daily-log.mjs`（自動） | `docs/log/README.md` | 日ごとの件数と日報へのリンク |

- メモはセッションごとに別ファイルにする。並行するPRが同じファイルを編集しないので、マージで衝突しない
- 日報と一覧は Git の履歴とメモから毎回作り直す（決定的な出力。同じ入力なら同じ内容）

### 作られるタイミング

| タイミング | 仕組み | 何が起きるか |
| --- | --- | --- |
| Claude Code が応答を終えるとき | Stop フック `.claude/hooks/daily-log-reminder.mjs` | 作業の差分があるのに日報メモがなければ、同じ HEAD につき1回だけ記録を促す |
| セッションの終わり・PR作成前 | Skill `.claude/skills/daily-log/SKILL.md` | 日報メモを書き、日報を作り直してコミット |
| main への push（PRのマージ） | GitHub Actions `.github/workflows/daily-log.yml` | 直近14日分の日報と一覧を作り直し、変更があればボットがコミット |
| 導入直後に1回 | `generate --all` | 全履歴から過去の日報を作る |

## 3. 作業日の区切り

- タイムゾーンは `tz`（既定 `Asia/Tokyo`）
- `dayStartHour`（既定 4）より前の時刻は前日に数える。深夜0〜4時の作業を前日の続きとして1日にまとめるため。表示では「翌00:13」のように示す
- 0 にすると暦日どおりになる

## 4. 日報メモの形式

```markdown
---
date: 2026-11-09
time: "02:27"
source: claude-code-web   # claude-code-web / claude-code / chat / pr / manual
branch: feat/last-resort
title: 奥の手の設計確定
---
## 決めたこと
- （ユーザーが決めた・承認したことだけ）
## 作ったもの・変えたもの
- （ファイル、作業キュー番号、ADR、PR）
## 次にやること
- （PCでしかできない作業には「（PC）」）
## 未解決・判断待ち
- （判断待ち、未確認の情報）
```

- 中身のない見出しは日報に出ない
- Claude の提案で未承認のものを「決めたこと」に書かない
- 秘密情報（トークン、パスワード）と個人情報は書かない。日報は Git に残り、公開リポジトリなら誰でも読める

## 5. 日報の形式（自動生成）

1. 見出し `# YYYY-MM-DD（曜）`
2. 集計表: コミット数（うちマージ）、時間帯、PR数、日報メモ数
3. `## 日報メモ`: メモを時刻順に（見出しは2段下げる）
4. `## PR`: マージコミット（`Merge pull request #N`）とスカッシュ（`題名 (#N)`）から、番号と題名
5. `## コミット`: マージ以外の全コミット（時刻、短いハッシュ、件名）

除外するコミット: 作者が `excludeAuthors`（既定はボット）、件名が `excludeSubjectPattern`（既定はボットの「日報を更新」）に合うもの。

## 6. 設定 `docs/log/config.json`

| キー | 既定値 | 意味 |
| --- | --- | --- |
| `tz` | `Asia/Tokyo` | 集計のタイムゾーン |
| `dayStartHour` | `4` | 作業日の始まりの時刻 |
| `logDir` / `entriesDir` | `docs/log` / `docs/log/entries` | 出力先とメモの置き場所 |
| `baseBranch` | 空（自動） | フックの比較先。空なら origin/HEAD → origin/main → main → master |
| `excludeAuthors` | `["github-actions[bot]"]` | 除外する作者 |
| `excludeSubjectPattern` | `^docs\(log\): 日報を更新` | 除外する件名（正規表現） |
| `defaultDays` | `14` | `generate` で作り直す日数 |

導入スクリプトは既存の設定ファイルを上書きしない。

## 7. コマンド

| コマンド | 用途 |
| --- | --- |
| `node tools/daily-log.mjs generate` | 直近14日の日報と一覧を作り直す |
| `node tools/daily-log.mjs generate --all` | 全期間を作り直す（導入直後、設定変更後） |
| `node tools/daily-log.mjs generate --since 2026-11-01 --until 2026-11-10` | 期間を指定 |
| `node tools/daily-log.mjs generate --dry-run` | 書き込まずに変更予定だけ表示 |
| `node tools/daily-log.mjs new-entry --title 件名 [--date D] [--source S]` | 日報メモの雛形を作る |
| `node tools/daily-log.mjs check` | 日報メモの有無を判定（0=OK、3=なし）。フックが使う |
| `node tools/daily-log.mjs transcripts --since D` | PCの Claude Code の会話記録から、このリポジトリでの依頼文を日別に出す（材料。コミットしない） |
| `node --test tools/daily-log.test.mjs` | 単体テスト |

## 8. 過去の分の作り方（バックフィル）

| 情報源 | 取り込み方 | 自動化 |
| --- | --- | --- |
| Git のコミット・PRマージ | `generate --all` | 全自動 |
| マージ済みPRの説明文 | `gh pr list --state merged --json ...` を Claude Code が要約し、マージ日のメモ（`source: pr`）にする | 半自動（Skill の手順B） |
| PCの Claude Code の会話記録 | `transcripts` の出力を要約してメモにする | 半自動。記録の形式は非公式で、既定では30日で削除される |
| Web版 Claude Code のセッション | 会話はリポジトリに残らない。コミットとPR説明文から復元する | 自動部分のみ |
| claude.ai のチャット | 過去チャット検索で拾った内容をメモ（`source: chat`）にする | 半自動（依頼文あり） |

PCの会話記録を残したい場合は、ユーザー設定 `~/.claude/settings.json` の `cleanupPeriodDays` を大きくする（例 365）。0 にすると記録自体が書かれない不具合が報告されているので、0 は使わない。

## 9. ブランチ保護があるとき

GitHub Actions のボットが main に push できない場合は、次のどちらかにする。

1. ワークフローを削除し、日報の生成を Skill の手順（PRの中で `generate` してコミット）だけにする（推奨。設定変更が不要）
2. ルールセットでボットの push を許可する

## 10. 制約と注意

- 依存パッケージなし。Node.js 18 以上
- `git log` は既定でチェックアウト中のブランチ（HEAD）を読む。Actions では main
- 浅いクローンでは古い日が欠ける。ツールが警告を出す
- 日報ファイルの手修正は次の生成で消える。直したい内容はメモに書く
- Stop フックは判定できないときとエラー時に何もしない（作業を止めない）

## 11. 他のリポジトリへの導入

`daily-log-kit` の `install.mjs`（1リポジトリ）または `install-all.ps1`（一括）を使う。手順は `docs/procedures/daily-log.md`。
