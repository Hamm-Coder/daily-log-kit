# 日報の運用

- 目的: 作業と決定を日ごとに `docs/log/` へ残し、次のセッションや次作で参照できるようにする
- 前提: daily-log-kit が導入済み（`tools/daily-log.mjs` がある）。Node.js 18 以上
- 仕様: `docs/specs/daily-log.md`（daily-log-kit v1.3.1）
- 導入・更新・再適用・取り外し: `docs/procedures/daily-log-kit.md`
- 更新日: 2026-11-10

## 手順

### 毎回（Claude Code）

1. セッションの最初に「日報からの引き継ぎ」（次にやること・判断待ち・準備・効率化の候補）が Claude に渡される。「前回の続きをして」と頼めばよい
1. 作業の最後に「日報を書いて」と頼む。頼み忘れても Stop フックが1回促す
2. Claude Code が `docs/log/entries/<日付>/` にメモを作り、作業ブランチにコミットする
3. PRをマージすると、GitHub Actions が日報（`docs/log/YYYY-MM/YYYY-MM-DD.md`）を作り直す

### 毎回（claude.ai のチャットで決めたとき）

1. チャットの最後に「今日の決定を日報メモの形式で出して」と頼む
2. 出力を Claude Code に渡し、「`--source chat` の日報メモとして追加して」と頼む

### PCで手動で見る・作り直す

```powershell
cd C:\AllGitRepository\<リポジトリ>
git pull
node tools/daily-log.mjs generate          # 直近14日
node tools/daily-log.mjs generate --all    # 全期間
start docs\log\README.md
```

### 週に1回（振り返り）

```powershell
cd C:\AllGitRepository\<リポジトリ>
git pull
node tools/daily-log-analyze.mjs
```

Web版 Claude Code なら「作業を分析して」と頼む。改善点・判断待ち・次にやることが一覧になる。

## 確認方法

- `node --test tools/daily-log.test.mjs tools/daily-log-analyze.test.mjs tools/daily-log-brief.test.mjs` が成功する
- GitHub の Actions タブで `daily-log` が成功している
- `docs/log/README.md` に、作業した日が並んでいる
