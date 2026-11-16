# TABLE TENNIS DUEL

2人対戦型の3Dオンライン卓球ゲームです。

```
table-tennis-duel/
├── client/            … フロントエンド（ブラウザで動く画面）
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── shared/    … ブラウザとサーバーの両方で使う（物理演算・ルール・CPU）
│       ├── config.js  … どのサーバーにつなぐか
│       ├── network.js … サーバーとの通信（Socket.IO）
│       └── …          … 3D表示・操作・音など
├── package.json       … 公開サービス用（npm run build / npm start）
├── render.yaml        … Render の設定（まとめて設定する場合）
├── サーバー起動.bat   … Windows でダブルクリックしてサーバーを起動
├── server/            … バックエンド（Node.js + Express + Socket.IO）
│   ├── package.json
│   ├── .env.example   … 設定の見本（.env にコピーして使う）
│   └── src/
│       ├── index.js   … サーバーのスタート地点
│       ├── config.js  … 環境変数の読み込み
│       └── selftest.js… サーバーで試合の計算が動くかのテスト
└── README.md
```

## 自分のPCでサーバーを動かす

> **Windows のかんたんな方法**：`table-tennis-duel` フォルダの中の `サーバー起動.bat` をダブルクリックします。
> 初回は部品のインストールも自動で行います。黒い画面に「サーバーが起動しました」と出たら、http://localhost:3000 を開きます。
> （Node.js のインストールだけは、先に下の 1. で行ってください）

### 1. Node.js を入れる（最初の1回だけ）
1. https://nodejs.org/ja を開き、「LTS」と書かれた方をダウンロードしてインストールします。
2. ターミナル（Windows は「コマンドプロンプト」または「PowerShell」、Mac は「ターミナル」）を開き、次を入力して Enter を押します。
   ```
   node -v
   ```
   `v20.11.0` のように数字が出れば成功です（18 以上なら OK）。

### 2. 必要な部品をインストールする（最初の1回だけ）
ターミナルで `server` フォルダに移動して、インストールします。
```
cd （table-tennis-duel フォルダの場所）/server
npm install
```
> フォルダの場所が分からないときは、`cd ` と入力したあと（最後に空白）、`server` フォルダをターミナルにドラッグ＆ドロップすると場所が入ります。

### 3. サーバーを起動する
```
npm start
```
「サーバーが起動しました」と出たら成功です。止めるときは `Ctrl + C` を押します。

### 4. 動作確認
- ブラウザで http://localhost:3000 を開く → 右上が「● オンライン ping ○ms 接続中 1人」になれば接続成功
- もう1つタブを開いて同じURLを開く → 「接続中 2人」に増える
- http://localhost:3000/api/selftest を開く → `"ok": true` と出れば、サーバーで試合の計算が動いている
- サーバーを `Ctrl + C` で止める → 画面が「再接続中」になり、もう一度 `npm start` すると自動で「オンライン」に戻る

## 設定（環境変数）
`server/.env.example` を `server/.env` という名前でコピーして書き換えます。

| 名前 | 意味 | 例 |
|---|---|---|
| `PORT` | 待ち受けるポート番号 | `3000` |
| `CLIENT_ORIGIN` | 画面をどこから開くのを許可するか | `*`（開発中）、`https://example.netlify.app` |
| `SERVE_CLIENT` | 画面もこのサーバーから配信するか | `true` |
| `PUBLIC_SERVER_URL` | 画面に教えるサーバーのURL（空なら同じサーバー） | `https://xxx.onrender.com` |

画面を別のサービスに置く場合は、`client/js/config.js` の `SERVER_URL` にサーバーのURLを書いても設定できます。

## 同じPCで2人分を試す（STEP 5）
1. サーバーを起動して、ブラウザで http://localhost:3000 を2つのタブ（またはウィンドウ）で開く
2. 1つめのタブで名前を入れて「部屋を作る」→ 6桁のコードが出る
3. 2つめのタブで「部屋に参加」→ コードを入れて「参加する」
4. 両方のタブで「準備完了」を押すと試合開始
5. タブを切り替えながら、サーブ → 相手側で打ち返す、を試す
   （ブラウザは、表示していないタブの動きを止めることがあります。2つのウィンドウを並べると試しやすいです）

## オンライン対戦のしくみ（STEP 6）
- 試合の計算（ボール・得点・サーブ権）は、すべてサーバー（`server/src/gameRoom.js`）が行う
- ブラウザが送るのは「ラケットの状態」「サーブ」「当たった、という申告」だけ。得点を送る通信はない
- 当たりの申告は、サーバーがボールの記録を巻き戻して確かめる（通信の遅れがあっても打ち返せるように）
- ブラウザは、届いた状態を0.07秒遅らせて、なめらかにつないで表示する（補間）
- 切断すると試合は止まり、30秒以内に戻ればそのまま再開する

## インターネットに公開する（Render）

1. GitHub（https://github.com）でアカウントを作り、新しいリポジトリ（例：`table-tennis-duel`）を作る
2. 「uploading an existing file」から、このフォルダの中身をすべてドラッグ＆ドロップして「Commit changes」
   - `node_modules` フォルダはアップロードしない（ZIP から展開したフォルダなら入っていない）
3. Render（https://render.com）に GitHub アカウントでログイン →「New +」→「Web Service」→ リポジトリを選ぶ
4. 設定
   | 項目 | 入力する内容 |
   |---|---|
   | Language（Runtime） | Node |
   | Root Directory | （空のまま） |
   | Build Command | `npm run build` |
   | Start Command | `npm start` |
   | Instance Type | Free |
5. 「Deploy Web Service」→ 数分後に `https://〇〇.onrender.com` のURLができる
6. そのURLを2台のPCで開いて、部屋を作る・参加する

### 無料プランの注意
- 15分間だれも使わないとサーバーが眠り、次に開いたときに起動まで1分ほどかかる
- 眠ると部屋や試合の情報は消える（遊ぶ前に一度URLを開いて起こしておく）

## 公開後の確認（STEP 8）
- `https://〇〇.onrender.com/health` → `"ok": true`
- `https://〇〇.onrender.com/api/selftest` → `"ok": true`
- 別のネットワークの2台のPC（例：自宅のWi-Fiと、スマホのテザリング）で同じURLを開き、部屋を作る → 参加 → 準備完了 → 試合
