---
name: daily-log
description: セッションの終わり、PRを作る前、または日報を書いて・過去の日報を作ってと頼まれたときに使う。決めたこと・作ったもの・次にやることを docs/log/entries に記録し、日報を生成する。
---

# 日報の記録（daily-log-kit v1.0.0）

仕様は `docs/specs/daily-log.md`。生成される `docs/log/YYYY-MM/YYYY-MM-DD.md` と `docs/log/README.md` は手で編集しない。人が書くのは `docs/log/entries/` のメモだけ。

## A. セッションの終わりに日報メモを書く（通常）

1. `node tools/daily-log.mjs new-entry --title "<作業の短い件名>"` を実行する。表示されたパスのファイルが雛形
   - Web版では `--source claude-code-web` が自動で入る。チャットの内容を写すときは `--source chat`
2. 雛形の4つの見出しを埋める。各項目は1行1件、主語と対象を具体的に書く
   - **決めたこと**: ユーザーが決めた・承認したことだけ。Claude の提案で未承認のものは「未解決・判断待ち」へ
   - **作ったもの・変えたもの**: ファイル、作業キューの番号（例 D5）、ADR 番号、PR 番号
   - **次にやること**: 次のセッションで最初にやること。PCでしかできない作業は「（PC）」と付ける
   - **未解決・判断待ち**: ユーザーの判断が必要なこと、未確認の情報
3. 書かないこと: トークン・パスワード・個人情報、コミット一覧の写し（自動で入る）
4. `node tools/daily-log.mjs generate` で日報を作り直し、出力を確認する
5. `git add docs/log` して「docs(log): 日報メモ」でコミットする。作業ブランチと同じPRに含める

## B. 過去の日報をまとめて作る（導入直後に1回）

1. 履歴が全部あるか確認する: `git rev-parse --is-shallow-repository` が `true` なら `git fetch --unshallow`
2. `node tools/daily-log.mjs generate --all` で、全コミットから日別の日報と一覧を作る
3. 決めたことの補完（任意）
   - マージ済みPRの説明文: `gh pr list --state merged --limit 200 --json number,title,body,mergedAt` があれば、PRごとの要点を、マージ日の日報メモ（`--source pr`）にまとめる
   - PCの Claude Code の会話記録: `node tools/daily-log.mjs transcripts --since YYYY-MM-DD` の出力を材料に、日ごとの日報メモ（`--source claude-code`）を書く。出力そのものはコミットしない
   - claude.ai のチャット: ユーザーが渡したメモを `--source chat` として該当日に置く
   - 過去の日付のメモは `new-entry --date YYYY-MM-DD` で作る。日付が推定なら本文に「（日付は推定）」と書く
4. もう一度 `generate --all` を実行し、「docs(log): 過去の日報を作成」でコミットする

## 確認

- `node --test tools/daily-log.test.mjs` が通る
- `docs/log/README.md` の一覧に、作業した日が並んでいる
