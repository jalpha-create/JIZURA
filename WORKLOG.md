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

## 2026-09-24 起動ファイルと参考フォークの調査

- `JIZURA起動.cmd` を追加。ダブルクリックで `build.py` → `python -m http.server 8770 --bind 127.0.0.1`（最小化ウィンドウ）→ ブラウザ表示。ポートが使用中ならサーバー起動を省略。サーバー停止は最小化された「JIZURA server」ウィンドウを閉じる。
  - 待機は `timeout.exe` ではなく `ping -n 3`（入力のない環境で timeout がエラーになるため）。本文は ASCII＋CRLF。
- 優先順位（ユーザー指定）: ①複数画面比の一括書き出し → ⑤案のお気に入り保存 → ⑦自分用演出パック → ④縦型SNSセーフエリア → ②ブランドキット → ③タイトル/CTAカード。
- 参考: `hirazisora/JIZURA`（MIT・upstream から37コミット先行／2コミット遅れ）。追加機能は画像・動画の背景/前景レイヤー、クロマキー、行ごとの歌詞表示エリア、タイムライン境界のドラッグ編集、アンドゥ/リドゥ、空カット挿入、Jev（TypeSafe API に歌詞を送る外部AI選定・要APIキー）。
  - `git fetch https://github.com/hirazisora/JIZURA.git main:refs/remotes/hirazi/main` で取得済み。試しにマージすると衝突は src/09_render.js・11_export.js・12_ui.js・app/* と生成物（index.html・CEP zip）。upstream 側の差分は計100行程度で、解消は現実的。

## 2026-09-24 hirazi fork の取り込みと改名

- ユーザー判断で `hirazisora/JIZURA` を丸ごとマージ（ブランチ `merge/hirazi`）。衝突は両方の機能を残す形で解消（詳細はマージコミット）。
  - 取り込んだ機能: 画像・動画の背景／前景レイヤー、クロマキー、行ごとの歌詞表示エリア、タイムライン境界ドラッグ、アンドゥ／リドゥ、空カット、Jev（β）。
  - 独自修正: 透過PNGの前景／後景書き出しで、前景素材を後景レイヤーに描かない（`src/09_render.js`）。
  - 確認: `node dev/media_test.js` `lyric_test.js` `jev_test.js`、`python dev/jev_server_test.py` すべて成功。ブラウザで16:9/9:16/1:1 × 通常・透過・後景・前景の計360フレームを描画して例外なし。日英の画面でコンソールエラーなし。
- 表記を「jAlpha edition」に変更。公開URL・Jev の接続元を `https://jalpha-create.github.io` に変更。「利用について」には自分の版＋取り込み元（hirazi fork）＋オリジナルのクレジットを併記（MIT の表示条件）。
- Jev は外部サービス（TypeSafe API）に歌詞を送る。キーを設定して `jev_server.py` を起動しない限り動かない。
- upstream（852wa）の更新を取り込むときは、hirazi 版で大きく変わった `src/12_ui.js` `src/09_render.js` `app/body.html` が衝突しやすい。
