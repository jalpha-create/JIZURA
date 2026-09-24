# WORKLOG — JIZURA（jalpha-create フォーク）

## 2026-09-24 フォークと開発環境の用意

- `852wa/JIZURA` を `E:\jcreate_app\JIZURA` にクローンし、`jalpha-create/JIZURA` にフォーク。
  - remote: `origin` = 自分のフォーク / `upstream` = 元リポジトリ（push は `DISABLED` にして誤送信を防止）。
  - 元の更新の取り込み: `git fetch upstream && git merge upstream/main`
- `python build.py` の出力がコミット済みの `index.html` / `en/index.html` と一致することを確認（ビルドの再現性あり）。
- `.gitignore` を追加（`__pycache__/` `dev/www/` `out/` `build/` `.claude/` など）。
- ローカル確認は `.claude/launch.json`（`python -m http.server 8765`、リポジトリ直下）。
- 方針（ユーザー回答）: 演出部品を増やす／制作フローを便利に／自分の案件（広告・縦型ショート・MV）向けに特化。自分の GitHub で公開する。
- 改造の原則: 新しい演出は `src/11p_<pack>.js` の追加で行い、元の本体ファイルはなるべく触らない（upstream の更新を取り込みやすくするため）。手順は `docs/EXPRESSION_PACKS.md`。
