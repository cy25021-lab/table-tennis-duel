// =====================================================
//  keepAlive.js ― 無料プランのサーバーが眠らないようにする
//
//  Render の無料プランは「15分間だれもアクセスしない」と眠ってしまう。
//  そこで、サーバー自身が10分ごとに自分の公開URLにアクセスして、起きたままにする。
//
//  ・Render では、公開URLが環境変数 RENDER_EXTERNAL_URL に自動で入る
//  ・別のサービスで使うときは、KEEP_ALIVE_URL に公開URLを設定する
//  ・止めたいときは KEEP_ALIVE=false にする
// =====================================================

const INTERVAL_MS = 10 * 60 * 1000; // 10分ごと（15分より短くする）

function startKeepAlive() {
  if (process.env.KEEP_ALIVE === "false") return;
  const base = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!base) return; // 自分のPCで動かしているときは何もしない
  if (typeof fetch !== "function") {
    console.log("[起きたまま機能] この Node.js では使えません（Node.js 18 以上が必要）");
    return;
  }

  const url = base.replace(/\/$/, "") + "/health";
  console.log(`[起きたまま機能] 10分ごとに ${url} にアクセスします`);
  setInterval(async () => {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "table-tennis-duel-keepalive" } });
      if (!res.ok) console.log(`[起きたまま機能] 返事がおかしい：${res.status}`);
    } catch (err) {
      console.log(`[起きたまま機能] アクセスできませんでした：${err.message}`);
    }
  }, INTERVAL_MS);
}

module.exports = { startKeepAlive };
