# 依頼文5: Claude Code でキットを改良して、版を上げて PR にする

キットのリポジトリ（`Hamm-Coder/daily-log-kit`）の Claude Code（Web版・PC版）で、次をそのまま貼り付けます。`<直したい内容>` だけ書き換えます。

---

次を直して、版を上げて PR にしてください。

<直したい内容>

- 手順は CLAUDE.md の「版を上げて配る手順」のとおり（`node --test` → `node bump-version.mjs <版>` → README の変更履歴に1行 → PR）
- 版の上げ方: 不具合の修正は x.y.Z、機能の追加は x.Y.0、既存の日報メモに影響する変更は X.0.0
- 手順を変えたら `docs/MANUAL.md`・`docs/manual/index.html`・`files/docs/procedures/daily-log-kit.md` をそろえて直す
- PR を作ったら Actions の `kit-ci` の結果を確認し、失敗していたら原因を直す
- `SPEC.md` の状態と `docs/HANDOFF.md` の経緯を更新する
- 最後に、変えたこと・版・PR の URL・私が PC でやることを短くまとめる

---

## マージした後（利用者が PC で行う）

`kit-release` がタグ `v<版>` とリリースを作ったら、キットのフォルダで配ります。

```powershell
cd C:\AllGitRepository\daily-log-kit
git pull
.\install-all.ps1                    # 確認のみ
.\install-all.ps1 -Apply -CreatePR   # 導入済みの全リポジトリに「更新」のPR
```
