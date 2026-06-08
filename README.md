# Vidlever

あらゆる HTML5 `<video>` をキーボードで操作する Chrome 拡張（Manifest V3）。再生/一時停止・シーク・再生速度・ミュート・フルスクリーン・PiP・ループを、サイトを問わず統一のキーバインドで制御する。設定は `chrome.storage.sync` で複数マシン間に同期される。

> 個人利用向けの **unpacked 拡張** として配布する。Chrome Web Store には公開しない。

## 特徴

- **どの動画でも動く** — `<all_urls>` / `all_frames` で全フレームに content script を注入。埋め込み iframe や Shadow DOM 内の動画にも対応。
- **入力中は無効** — `<input>` / `<textarea>` / `contenteditable` にフォーカスがあるときはキーを横取りしない（フォーカスガード）。
- **賢い動画選定** — ページに複数の動画があるとき、再生中 → 最大レンダリング面積 → DOM 順で対象を 1 つ選ぶ。
- **HUD オーバーレイ** — 動画左上に速度/ミュート/ループ状態を常時表示。操作時は 1.5 秒の一時オーバーレイ。
- **フル設定可能** — オプションページでキーの再割り当て、複製、並べ替え（重複キーの優先順位）、速度の上下限/丸め桁数、HUD の見た目を編集。設定の Import / Export / Reset も可能。

## デフォルトキーバインド

| キー | アクション | 内容 |
|---|---|---|
| `Space` | playPause | 再生 / 一時停止 |
| `x` | skipForward | 10 秒進む |
| `z` | skipBackward | 10 秒戻る |
| `d` | speedDelta | 速度 +0.1 |
| `s` | speedDelta | 速度 −0.1 |
| `r` | speedSet | 速度を 1.0 にリセット |
| `f` | fullscreenToggle | フルスクリーン切り替え |

`muteToggle` / `pipToggle` / `seekToStart` / `seekToEnd` / `loopToggle` の 5 アクションは**初期状態では未割り当て**。必要に応じてオプションページで追加する。

### 全アクション一覧（11 種）

| アクション | パラメータ | 内容 |
|---|---|---|
| `playPause` | — | 再生 / 一時停止 |
| `skipForward` | `seconds` | 指定秒だけ進む |
| `skipBackward` | `seconds` | 指定秒だけ戻る |
| `speedDelta` | `delta` | 再生速度を相対変更（clamp + 丸め） |
| `speedSet` | `rate` | 再生速度を絶対値に設定 |
| `muteToggle` | — | ミュート切り替え |
| `fullscreenToggle` | — | フルスクリーン切り替え |
| `pipToggle` | — | Picture-in-Picture 切り替え |
| `seekToStart` | — | 先頭へシーク |
| `seekToEnd` | — | 末尾へシーク |
| `loopToggle` | — | ループ切り替え |

再生速度は設定の上下限（デフォルト `0.25`〜`4.0`）で clamp し、小数桁数（デフォルト 2 桁）で丸める。

## インストール（unpacked）

```bash
pnpm install
pnpm build        # dist/ を生成
```

1. Chrome で `chrome://extensions/` を開く
2. 右上の **Developer mode** を ON
3. **Load unpacked** をクリックし、`dist/` を選択
4. 動画のあるページで上表のキーを試す

更新するときは `pnpm build` を再実行し、拡張カードのリロードアイコンを押す。

## 開発

```bash
pnpm dev          # Vite dev（HMR）
pnpm test         # Vitest（単体テスト）
pnpm typecheck    # tsc --noEmit
pnpm lint         # Biome check
pnpm format       # Biome check --write
```

技術スタック: Vite + `vite-plugin-web-extension` / TypeScript（strict）/ Preact（オプションページ）/ Biome / Vitest + happy-dom。

設計の正本は [`docs/design/overview.md`](docs/design/overview.md)。

## 設定

ツールバーの拡張アイコン経由、または `chrome://extensions/` の拡張詳細からオプションページを開く。

- **バインディング編集** — キャプチャでキー割り当て、enable/disable、複製、削除、ドラッグ並べ替え
- **速度設定** — min / max / 丸め桁数（1 または 2）
- **HUD 設定** — 表示 ON/OFF、通常時/ホバー時の不透明度、一時オーバーレイの表示時間
- **Import / Export / Reset** — `vidlever-settings.json` で設定を入出力。Import 時はスキーマ検証を通してから書き込む

## 鍵管理ポリシー（重要）

2 台以上のマシンで `chrome.storage.sync` を同じ拡張として同期させるには、**Extension ID を一致させる**必要がある。ID は `manifest.json` の `key` フィールド（公開鍵）から導出される。

### 一度だけの鍵生成

```bash
# 2048-bit RSA 秘密鍵を生成 — このファイルは絶対に秘密にする
openssl genrsa -out vidlever-key.pem 2048

# Chrome の `key` フィールドが期待する形式（DER → Base64）で公開鍵を導出
openssl rsa -in vidlever-key.pem -pubout -outform DER | openssl base64 -A
```

出力された Base64 文字列を `manifest.json`（`src/manifest.json`）の `key` に設定する。

### ポリシー

- `vidlever-key.pem` は**秘密鍵**。`.gitignore`（`*.pem`）で除外済みで、**絶対にコミットしない**。
- パスワードマネージャ（1Password / Bitwarden 等）か暗号化ストレージにバックアップする。
- `manifest.json` にコミットされる `key` は**公開鍵**なので共有して問題ない。秘密鍵は拡張のロード/実行には不要で、公開鍵を再導出したいときだけ使う。

### 2 台目のマシンで使う

1. リポジトリを clone する
2. `vidlever-key.pem` をプロジェクト直下にコピーする（ビルド出力の外側）
3. `manifest.json` の `key`（公開鍵）はコミット済みなので、`pnpm build` → unpacked ロードで同じ Extension ID になり、設定が同期される

`.pem` を紛失した場合は、再生成して新しい Extension ID を受け入れ、設定を手動で再同期する（旧インストールがまだ読める間に Export しておくとよい）。

## ライセンス

UNLICENSED（個人利用）。
