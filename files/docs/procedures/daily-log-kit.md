# 日報キットの導入・更新・再適用・取り外し

- 目的: このリポジトリの日報の仕組み（daily-log-kit v1.10.1）を、新しい版に更新する・壊れたときに戻す・外す
- 前提: キットのリポジトリ `Hamm-Coder/daily-log-kit` を `C:\AllGitRepository\daily-log-kit` にクローン済み。Git、Node.js、GitHub CLI（`gh`）
- 詳しいマニュアル: https://github.com/Hamm-Coder/daily-log-kit/blob/main/docs/MANUAL.md
- 毎日の使い方: `docs/procedures/daily-log.md`、仕様: `docs/specs/daily-log.md`
- 更新日: 2026-11-16

## 全体の流れ

| 順番 | 場所 | 作業 |
| --- | --- | --- |
| 1 | `C:\AllGitRepository\daily-log-kit` | `git pull` → `.\install-all.ps1`（確認）→ `.\install-all.ps1 -Apply -CreatePR`。スクリプトが push と PR 作成まで行う |
| 2 | GitHub | このリポジトリの PR（`chore/daily-log-v<版>`）を確認してマージ |
| 3 | このリポジトリのフォルダ | `git pull`（複数のリポジトリをまとめて取り込むなら、キットのフォルダで `.\pull-all.ps1`） |

このリポジトリのフォルダで push する必要はない。

## 更新（キットの新しい版を入れる）

更新の PR をマージしたこと（と、日報メモだけの PR をマージしたこと）は、日報メモに書かない。PR は日報に自動で載る（`docs/specs/daily-log.md` 4.3）。

```powershell
cd C:\AllGitRepository\daily-log-kit
git pull
.\install-all.ps1 -Repos <このリポジトリのフォルダ名>
.\install-all.ps1 -Repos <このリポジトリのフォルダ名> -Apply -CreatePR
```

変わるのは、キットのファイル（先頭に `daily-log-kit v` の印があるもの）、`CLAUDE.md` の日報の区間、`.claude/settings.json` のフック。日報メモ、生成済みの日報、`docs/log/config.json` は変わらない。

GitHub で既定のブランチを変えた後（例: `claude/...` から main へ）も、同じコマンドでよい。`install-all.ps1` と `pull-all.ps1` が実行のたびに GitHub の既定のブランチを確かめ直すので、PR は新しい既定のブランチ向けに作られる（変わっていたら「既定のブランチが … に変わっていました」と表示する）。日報の自動更新（`daily-log` Actions）も新しい既定のブランチで動く。PC の作業フォルダを新しいブランチに移すのは手で行う（`git switch main` → `git pull`）。

## 再適用（キットのファイルを消した・壊した、フックを設定から消した）

更新と同じコマンドを実行する。足りない分を戻す PR ができる。

- 同じ版のブランチが GitHub に残っていると「既にあります」で飛ばされる。マージ済みなら GitHub でそのブランチを消してから実行する
- キットのファイルを自分で直している場合、再適用でキットの内容に戻る。残したい変更はキットのリポジトリ側に入れる

## Web版 Claude Code で更新する場合

このリポジトリのセッションで次を頼む。

```
https://github.com/Hamm-Coder/daily-log-kit を /tmp/daily-log-kit に git clone --depth 1 し、
node /tmp/daily-log-kit/install.mjs . で日報の仕組みを最新版に更新してください。
テストが通ることを確認し、「chore: 日報の仕組みを更新」で PR にしてください。日報メモと docs/log/config.json は変更しないでください。
```

## 取り外し

次を削除し、PR にする。`docs/log/`（日報とメモ）は残してよい。

- `tools/daily-log*.mjs`
- `.claude/hooks/daily-log-reminder.mjs`、`.claude/hooks/daily-log-session-start.mjs`、`.claude/skills/daily-log/`
- `.github/workflows/daily-log.yml`、`.github/workflows/daily-log-weekly.yml`
- `docs/specs/daily-log.md`、`docs/procedures/daily-log.md`、このファイル
- `.claude/settings.json` の Stop と SessionStart の日報のフック（`daily-log` を含む行）
- `CLAUDE.md` の `<!-- daily-log:start` から `<!-- daily-log:end -->` まで

## 確認方法

- `node --test tools/daily-log.test.mjs tools/daily-log-analyze.test.mjs tools/daily-log-brief.test.mjs` が成功する
- マージ後、GitHub の Actions で `daily-log` が成功している
- 新しいセッションの最初に「日報からの引き継ぎ」が渡される（日報メモがある場合）
