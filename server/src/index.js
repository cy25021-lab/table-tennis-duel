// =====================================================
//  index.js ― サーバーのスタート地点
//
//  ・Express：画面（client フォルダ）とAPIを配信する
//  ・Socket.IO：ブラウザとリアルタイムに通信する（WebSocket）
//
//  STEP 4：つながる・通信の速さ（ping）を測る・サーバーで試合の計算が動く
//  STEP 5：部屋（ルームコード）の作成・参加・準備完了
//  STEP 6：試合の同期（サーバーで試合を計算し、状態を2人に送る）
// =====================================================

const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const config = require("./config");
const { runSelfTest } = require("./selftest");
const { RoomManager } = require("./rooms");
const { GameRoom } = require("./gameRoom");
const { startKeepAlive } = require("./keepAlive");
const { setupRace } = require("./race/raceServer");

const rooms = new RoomManager();
const games = new Map(); // 部屋のコード → 試合（GameRoom）

const app = express();
app.set("trust proxy", true); // 公開サービスの中継（プロキシ）の後ろでも正しく動くように

// ----- 画面に「どのサーバーにつなぐか」を教える -----
//  client/index.html が最初に読み込む。環境変数 PUBLIC_SERVER_URL の値を渡す
app.get("/js/config.js", (req, res) => {
  res.type("application/javascript");
  res.set("Cache-Control", "no-store");
  res.send("window.TTD_CONFIG = " + JSON.stringify({ SERVER_URL: config.publicServerUrl }) + ";");
});

// ----- 動作確認用のAPI -----
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), online: io.engine.clientsCount, rooms: rooms.rooms.size, games: games.size, raceRooms: raceRooms.rooms.size });
});

app.get("/api/selftest", (req, res) => {
  res.json(runSelfTest());
});

// ----- 画面（client フォルダ）を配信 -----
if (config.serveClient) {
  app.use("/skyhop", express.static(config.skyhopDir)); // SKY HOP RUN は /skyhop/ で開く
  app.use(express.static(config.clientDir));
}

// ----- Socket.IO -----
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.clientOrigin },
  pingInterval: 10000, // 10秒ごとに生きているか確認
  pingTimeout: 8000,
});

// SKY HOP RUN（障害物レース）のオンライン対戦（通り道 /race）
const raceRooms = setupRace(io);

// 部屋のみんなに、部屋の最新の状態を送る
function broadcastRoom(room) {
  io.to("room:" + room.code).emit("room:update", rooms.publicRoom(room));
}

// 自分の情報（どちら側か・つなぎ直し用の合言葉）を含めた返事
function roomReply(result) {
  return {
    ok: true,
    room: rooms.publicRoom(result.room),
    you: { side: result.player.side, name: result.player.name, token: result.player.token },
  };
}

// 2人そろって準備完了 → 試合を作って、開始を知らせる
function startMatch(room) {
  const code = room.code;
  const game = new GameRoom(code, (event, data) => io.to("room:" + code).emit(event, data));
  games.set(code, game);
  io.to("room:" + code).emit("match:start", {
    code: code,
    players: rooms.publicRoom(room).players,
  });
  console.log(`[試合開始] 部屋 ${code}`);
}

// 部屋が試合中でなくなったら、試合を片づける（相手が退出したときなど）
function syncGame(room) {
  if (!room || room.state !== "playing") {
    if (room) games.delete(room.code);
    return;
  }
  const game = games.get(room.code);
  if (!game) return;
  const allConnected = room.players.length === 2 && room.players.every(p => p.connected);
  if (allConnected) game.resume();
  else game.pause(); // 切断中は試合を止めて待つ
}

// この接続の人が試合中なら、その試合と自分の側（1 or -1）を返す
function gameOf(socket) {
  const room = rooms.roomOf(socket.id);
  if (!room || room.state !== "playing") return null;
  const game = games.get(room.code);
  const player = room.players.find(p => p.socketId === socket.id);
  return game && player ? { game: game, side: player.side } : null;
}

// 短い時間に何度も参加を試す（コードの総当たり）を防ぐ
function tooManyTries(socket) {
  const now = Date.now();
  socket.data.tries = (socket.data.tries || []).filter(t => now - t < 60000);
  socket.data.tries.push(now);
  return socket.data.tries.length > 15; // 1分に15回まで
}

io.on("connection", socket => {
  console.log(`[接続] ${socket.id}（いまの接続数：${io.engine.clientsCount}）`);
  const reply = (fn, data) => { if (typeof fn === "function") fn(data); };

  // あいさつ：名前を受け取って、接続IDとサーバーの時刻を返す
  socket.on("hello", (data, fn) => {
    const name = String((data && data.name) || "PLAYER").slice(0, 12);
    socket.data.name = name;
    reply(fn, { id: socket.id, name: name, serverTime: Date.now() });
  });

  // 通信の速さを測る：届いたらすぐ返事をする（往復の時間 = ping）
  socket.on("ping:check", (clientTime, fn) => {
    reply(fn, { clientTime: clientTime, serverTime: Date.now() });
  });

  // ----- 部屋を作る -----
  socket.on("room:create", (data, fn) => {
    if (tooManyTries(socket)) return reply(fn, { ok: false, error: "too_many" });
    leaveCurrentRoom(socket);
    const result = rooms.create(socket.id, data && data.name);
    socket.join("room:" + result.room.code);
    reply(fn, roomReply(result));
    broadcastRoom(result.room);
    console.log(`[部屋作成] ${result.room.code}（${result.player.name}）`);
  });

  // ----- 部屋に参加する -----
  socket.on("room:join", (data, fn) => {
    if (tooManyTries(socket)) return reply(fn, { ok: false, error: "too_many" });
    const code = data && data.code;
    const current = rooms.roomOf(socket.id);
    if (current && current.code !== code) leaveCurrentRoom(socket);
    const result = rooms.join(socket.id, code, data && data.name);
    if (!result.ok) return reply(fn, result);
    socket.join("room:" + result.room.code);
    reply(fn, roomReply(result));
    broadcastRoom(result.room);
    console.log(`[参加] ${result.room.code}（${result.player.name}）`);
  });

  // ----- 切断したあと、同じ部屋・同じ席に戻る -----
  socket.on("room:rejoin", (data, fn) => {
    const result = rooms.rejoin(socket.id, data && data.code, data && data.token);
    if (!result.ok) return reply(fn, result);
    socket.join("room:" + result.room.code);
    reply(fn, roomReply(result));
    broadcastRoom(result.room);
    syncGame(result.room); // 試合中なら再開する（試合の状態はサーバーに残っている）
  });

  // ----- 準備完了 / 取り消し -----
  socket.on("room:ready", (data, fn) => {
    const result = rooms.setReady(socket.id, data && data.ready);
    if (!result.ok) return reply(fn, result);
    reply(fn, { ok: true });
    broadcastRoom(result.room);
    if (result.start) startMatch(result.room);
  });

  // ----- 部屋から出る -----
  socket.on("room:leave", (data, fn) => {
    leaveCurrentRoom(socket);
    reply(fn, { ok: true });
  });

  // ----- 試合中の通信 -----
  socket.on("game:input", data => {
    const g = gameOf(socket);
    if (g) g.game.setInput(g.side, data);
  });
  socket.on("game:serve", data => {
    const g = gameOf(socket);
    if (g) g.game.serve(g.side, data);
  });
  socket.on("game:hit", data => {
    const g = gameOf(socket);
    if (g) g.game.claimHit(g.side, data);
  });
  socket.on("game:rematch", () => {
    const g = gameOf(socket);
    if (g) g.game.requestRematch(g.side);
  });

  socket.on("disconnect", reason => {
    console.log(`[切断] ${socket.id}（理由：${reason}）`);
    const room = rooms.disconnect(socket.id);
    if (room) {
      broadcastRoom(room); // 相手に「接続が切れた」と知らせる（30秒は席を残す）
      syncGame(room);      // 試合中なら止める
    }
  });
});

function leaveCurrentRoom(socket) {
  const current = rooms.roomOf(socket.id);
  if (!current) return;
  socket.leave("room:" + current.code);
  const code = current.code;
  const left = rooms.leave(socket.id);
  games.delete(code); // 試合は終わり
  if (left) broadcastRoom(left); // 残った人は相手待ちに戻る
}

// 5秒ごとに、戻ってこなかった人や古い部屋を片づける
setInterval(() => {
  for (const room of rooms.cleanup()) {
    syncGame(room);
    if (room.expired) games.delete(room.code);
    if (room.expired) {
      io.to("room:" + room.code).emit("room:closed", { code: room.code, reason: "expired" });
      io.in("room:" + room.code).socketsLeave("room:" + room.code);
    } else {
      broadcastRoom(room);
    }
  }
}, 5000);

// ----- 試合の計算：1秒に60回 -----
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  for (const game of games.values()) game.update(dt);
}, 1000 / 60);

// 接続している人数を2秒ごとにみんなに知らせる
setInterval(() => {
  io.emit("server:stats", { online: io.engine.clientsCount, serverTime: Date.now() });
}, 2000);

server.listen(config.port, () => {
  console.log("==============================================");
  console.log(" TABLE TENNIS DUEL サーバーが起動しました");
  console.log(` ブラウザで開く：http://localhost:${config.port}`);
  console.log(` 動作確認：     http://localhost:${config.port}/api/selftest`);
  console.log("==============================================");
  startKeepAlive(); // 公開サービス（Render）では、眠らないように自分にアクセスし続ける
});
