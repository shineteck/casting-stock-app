# 鋳造在庫コンソール

生産・出荷の日次入力から在庫・在庫日数・納期リスクを集計する Web アプリです。
画面は GitHub Pages、データは Google スプレッドシートに保存します。

```
GitHub Pages（画面）  ⇄  Apps Script（中継）  ⇄  Google スプレッドシート（データ）
```

## このリポジトリの中身（すべて GitHub 用）

| ファイル | 役割 |
|---|---|
| `index.html` | アプリ本体 |
| `config.js` | スプレッドシートの接続先 URL（`apiUrl`） |
| `sheets-adapter.js` | 画面とスプレッドシートの橋渡し・ログイン画面 |
| `manifest.webmanifest` / `sw.js` / `icons/` | アプリとしてインストールするための設定 |
| `.github/workflows/pages.yml` | GitHub Pages への自動公開 |

スプレッドシート側のプログラム（`Code.gs`）と合言葉は、セキュリティのためこのリポジトリには含めていません。

## 使い方

- 初回起動時にログイン画面が出るので、合言葉を入力します（端末ごとに一度だけ）
- 入力内容はスプレッドシートに自動保存され、他の人の入力は 30 秒ほどで反映されます
- ログアウト：開発者ツールのコンソールで `stkResetConnection()` を実行

## アプリとしてインストール

- PC（Chrome / Edge）：アドレスバー右端のインストールアイコン
- Android（Chrome）：メニュー →「アプリをインストール」
- iPhone（Safari）：共有ボタン →「ホーム画面に追加」

## 更新

ファイルを差し替えて push すると自動で再公開されます。確実に反映させたいときは `sw.js` の `CACHE` 名（`casting-stock-v3` → `v4`）も上げてください。
