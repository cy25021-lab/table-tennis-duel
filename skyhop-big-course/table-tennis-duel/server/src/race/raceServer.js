// =====================================================
//  race/raceServer.js ― SKY HOP RUN のオンライン対戦の通信（Socket.IO の「/race」）
//
//  卓球とは別の通り道（ネームスペース）を使うので、おたがいに影響しない
//  ・部屋の作成・参加・つなぎ直し・退出
//  ・ホストのスタート → 全員に同じ「スタート時刻」を知らせる（障害物の動きもこれでそろう）
//  ・走っている間：全員の位置を1秒に15回まとめて配る
//  ・落ちる床が落ち始めたこと、ゴール、結果発表を知らせる
// =====================================================

const { RaceRooms } = require("./raceRooms");

function setupRace(io) {
  const nsp = io.of("/race");
  const rooms = new RaceRooms();
  const roomKey = code => "race:" + code;

  const broadcastRoom = room => nsp.to(roomKey(room.code)).emit("room:update", rooms.publicRoom(room));

  const reply = (fn, data) => { if (typeof fn === "function") fn(data); };

  function youOf(result) {
    return { id: result.player.id, slot: result.player.slot, name: result.player.name, token: result.player.token };
  }

  // 短い時間に何度も参加を試す（コードの総当たり）を防ぐ
  function tooManyTries(socket) {
    const now = Date.now();
    socket.data.tries = (socket.data.tries || []).filter(t => now - t < 60000);
    socket.data.tries.push(now);
    return socket.data.tries.length > 15;
  }

  function leaveRoom(socket) {
    const room = rooms.roomOf(socket.id);
    if (!room) return;
    socket.leave(roomKey(room.code));
    const left = rooms.leave(socket.id);
    if (left) broadcastRoom(left);
  }

  nsp.on("connection", socket => {
    // 時刻合わせ（通信の往復時間を測るついでに、サーバーの時刻を返す）
    socket.on("ping:check", (clientTime, fn) => reply(fn, { clientTime: clientTime, serverTime: Date.now() }));

    socket.on("room:create", (data, fn) => {
      if (tooManyTries(socket)) return reply(fn, { ok: false, error: "too_many" });
      leaveRoom(socket);
      const result = rooms.create(socket.id, data && data.name);
      socket.join(roomKey(result.room.code));
      reply(fn, { ok: true, room: rooms.publicRoom(result.room), you: youOf(result) });
      broadcastRoom(result.room);
    });

    socket.on("room:join", (data, fn) => {
      if (tooManyTries(socket)) return reply(fn, { ok: false, error: "too_many" });
      const result = rooms.join(socket.id, data && data.code, data && data.name);
      if (!result.ok) return reply(fn, result);
      socket.join(roomKey(result.room.code));
      reply(fn, { ok: true, room: rooms.publicRoom(result.room), you: youOf(result) });
      broadcastRoom(result.room);
    });

    socket.on("room:rejoin", (data, fn) => {
      const result = rooms.rejoin(socket.id, data && data.code, data && data.token);
      if (!result.ok) return reply(fn, result);
      socket.join(roomKey(result.room.code));
      reply(fn, { ok: true, room: rooms.publicRoom(result.room), you: youOf(result) });
      broadcastRoom(result.room);
    });

    socket.on("room:leave", (data, fn) => {
      leaveRoom(socket);
      reply(fn, { ok: true });
    });

    // ホストがスタート
    socket.on("race:start", (data, fn) => {
      const result = rooms.start(socket.id);
      reply(fn, result.ok ? { ok: true } : result);
      if (result.ok) broadcastRoom(result.room); // startAt（スタート時刻）を含む
    });

    // 自分の位置など（1秒に15回くらい届く）
    socket.on("race:state", data => {
      rooms.updateState(socket.id, data);
    });

    // 落ちる床が落ち始めた → ほかの人にも知らせる
    socket.on("race:tile", data => {
      const room = rooms.roomOf(socket.id);
      if (!room || room.state !== "racing") return;
      const id = Math.floor(Number(data && data.id));
      if (Number.isInteger(id) && id >= 0 && id < 100) socket.to(roomKey(room.code)).emit("race:tile", { id: id });
    });

    // ゴール
    socket.on("race:finish", (data, fn) => {
      const result = rooms.finish(socket.id);
      reply(fn, result.ok ? { ok: true, ms: result.ms, rank: result.rank } : result);
      if (result.ok) {
        nsp.to(roomKey(result.room.code)).emit("race:finished", {
          id: result.player.id, name: result.player.name, ms: result.ms, rank: result.rank,
        });
        broadcastRoom(result.room);
      }
    });

    // 結果発表のあと、待合室に戻る（ホストのみ）
    socket.on("race:lobby", (data, fn) => {
      const result = rooms.backToLobby(socket.id);
      reply(fn, result.ok ? { ok: true } : result);
      if (result.ok) broadcastRoom(result.room);
    });

    socket.on("disconnect", () => {
      const room = rooms.disconnect(socket.id);
      if (room) broadcastRoom(room);
    });
  });

  // 1秒に15回：走っている部屋の全員の位置を配る
  setInterval(() => {
    for (const room of rooms.rooms.values()) {
      if (room.state === "racing" || room.state === "countdown") {
        nsp.to(roomKey(room.code)).emit("race:states", { t: Date.now(), list: rooms.states(room) });
      }
    }
  }, 1000 / 15);

  // 0.5秒ごとに：レース開始・結果発表・片づけ
  setInterval(() => {
    for (const room of rooms.tick()) {
      if (room.expired) nsp.to(roomKey(room.code)).emit("room:closed", { code: room.code });
      else broadcastRoom(room);
    }
  }, 500);

  return rooms;
}

module.exports = { setupRace };
