// =====================================================
//  config.js ― 環境変数（.env）から設定を読み込む
// =====================================================

const path = require("path");

// .env ファイルがあれば読み込む（なくても動く）
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch (err) {
  // dotenv が入っていなくても、環境変数だけで動くようにする
}

const origins = (process.env.CLIENT_ORIGIN || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  // "*" ならどこからでも接続OK。それ以外は許可したURLだけ
  clientOrigin: origins.includes("*") ? "*" : origins,
  serveClient: process.env.SERVE_CLIENT !== "false",
  publicServerUrl: process.env.PUBLIC_SERVER_URL || "",
  clientDir: path.join(__dirname, "..", "..", "client"),
  sharedDir: path.join(__dirname, "..", "..", "client", "js", "shared"),
};
