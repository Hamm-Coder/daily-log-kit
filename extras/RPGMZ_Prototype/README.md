# RPGMZ_Prototype 専用の追加ファイル

キットの導入（`install.mjs` または `install-all.ps1`）と同じPRに入れる。

| ファイル | 内容 |
| --- | --- |
| `docs/decisions/0011-daily-log.md` | 日報の仕組みを導入する ADR（状態: 提案。採用したら「採用」に直す） |
| `docs/log/entries/2026-10-31〜2026-11-08/` | `claude/ACTIVITY-LOG-2026-11.md` のチャット分を日報メモにしたもの（7件。推定の日付は本文に明記） |

```powershell
# 導入用ブランチ（chore/daily-log）を開いた状態で
Copy-Item -Recurse -Force ..\daily-log-kit\extras\RPGMZ_Prototype\docs .\
node tools/daily-log.mjs generate --all
git add -A
git commit -m "docs(log): 過去のチャット分の日報メモと ADR 0011"
```

SPEC.md の作業キューに入れる行は `prompts/1-claude-code-install.md` の末尾にある（E1。既存のキューの番号に合わせて振り直す）。
