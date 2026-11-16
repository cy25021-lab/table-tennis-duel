// =====================================================
//  rooms.js ― 部屋（ルームコード）の管理
//
//  ・6桁の数字のルームコードを発行する（使用中・最近使ったコードとは重ならない）
//  ・参加：コードが正しいか、満員でないかを調べる
//  ・準備完了：2人ともそろったら試合開始
//  ・退出・切断：相手を待機状態に戻す。切断は少しの間だけ席を残して、戻ってこられるようにする
//  ・古い部屋は自動で片づける
//
//  Socket.IO には関係しない「ふつうの JavaScript」なので、単体でテストできる
// =====================================================

const crypto = require("crypto");

const LIMITS = {
  graceMs: 30 * 1000,          // 切断してから席を残しておく時間（この間なら戻れる）
  waitingTtlMs: 15 * 60 * 1000, // 相手が来ないまま、この時間たった部屋は消す
  idleTtlMs: 2 * 60 * 60 * 1000, // 何も操作がないまま、この時間たった部屋は消す
  recentCodeMs: 10 * 60 * 1000, // 消えた部屋のコードは、この時間は再利用しない
};

// 名前を安全な形にする（前後の空白を消して、最大12文字）
function cleanName(name) {
  const s = String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
  return s || "PLAYER";
}

class RoomManager {
  constructor(options) {
    options = options || {};
    this.now = options.now || (() => Date.now()); // テストで時間を進められるように
    this.limits = Object.assign({}, LIMITS, options.limits || {});
    this.rooms = new Map();       // コード → 部屋
    this.socketRoom = new Map();  // 接続ID → コード
    this.recentCodes = new Map(); // 最近消えたコード → 消えた時刻
  }

  // ----- 重ならない6桁のコードを作る -----
  generateCode() {
    for (let i = 0; i < 1000; i++) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      if (this.rooms.has(code)) continue;
      const removedAt = this.recentCodes.get(code);
      if (removedAt && this.now() - removedAt < this.limits.recentCodeMs) continue;
      return code;
    }
    throw new Error("ルームコードを作れませんでした");
  }

  // ----- 部屋を作る -----
  create(socketId, name) {
    this.leave(socketId); // 別の部屋にいたら、先に出る
    const code = this.generateCode();
    const player = this.newPlayer(socketId, name, 1);
    const room = {
      code: code,
      state: "waiting", // waiting（相手待ち）/ lobby（2人そろって準備中）/ playing（試合中）
      players: [player],
      createdAt: this.now(),
      lastActive: this.now(),
    };
    this.rooms.set(code, room);
    this.socketRoom.set(socketId, code);
    return { ok: true, room: room, player: player };
  }

  newPlayer(socketId, name, side) {
    return {
      socketId: socketId,
      name: cleanName(name),
      side: side,           // 1 = プレイヤー1, -1 = プレイヤー2
      ready: false,
      connected: true,
      disconnectedAt: 0,
      token: crypto.randomBytes(12).toString("hex"), // つなぎ直しのときの本人確認
    };
  }

  // ----- 部屋に参加する -----
  join(socketId, code, name) {
    code = String(code || "").trim();
    if (!/^\d{6}$/.test(code)) return { ok: false, error: "invalid_code" };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "not_found" };
    if (room.players.some(p => p.socketId === socketId)) return { ok: false, error: "already_in_room" };
    if (room.players.length >= 2) return { ok: false, error: "full" };

    this.leave(socketId);
    const usedSide = room.players[0].side;
    const player = this.newPlayer(socketId, name, -usedSide);
    room.players.push(player);
    room.state = "lobby";
    room.lastActive = this.now();
    room.players.forEach(p => { p.ready = false; });
    this.socketRoom.set(socketId, code);
    return { ok: true, room: room, player: player };
  }

  // ----- 切断したあと、同じ席に戻る -----
  rejoin(socketId, code, token) {
    const room = this.rooms.get(String(code || ""));
    if (!room) return { ok: false, error: "not_found" };
    const player = room.players.find(p => p.token === token);
    if (!player) return { ok: false, error: "not_found" };
    if (player.socketId !== socketId) this.socketRoom.delete(player.socketId);
    player.socketId = socketId;
    player.connected = true;
    player.disconnectedAt = 0;
    room.lastActive = this.now();
    this.socketRoom.set(socketId, room.code);
    return { ok: true, room: room, player: player };
  }

  // ----- 準備完了 / 取り消し -----
  //  2人とも準備完了になったら { start: true } を返す
  setReady(socketId, ready) {
    const room = this.roomOf(socketId);
    if (!room) return { ok: false, error: "not_in_room" };
    if (room.state !== "lobby") return { ok: false, error: "not_ready_state" };
    const player = room.players.find(p => p.socketId === socketId);
    player.ready = !!ready;
    room.lastActive = this.now();
    const start = room.players.length === 2 && room.players.every(p => p.ready && p.connected);
    if (start) room.state = "playing";
    return { ok: true, room: room, start: start };
  }

  // ----- 試合が終わったあと、もう一度準備画面へ -----
  backToLobby(code) {
    const room = this.rooms.get(code);
    if (!room) return null;
    room.state = room.players.length === 2 ? "lobby" : "waiting";
    room.players.forEach(p => { p.ready = false; });
    return room;
  }

  // ----- 部屋から出る -----
  //  残った人がいれば、その部屋を返す（相手待ちに戻る）
  leave(socketId) {
    const room = this.roomOf(socketId);
    if (!room) return null;
    room.players = room.players.filter(p => p.socketId !== socketId);
    this.socketRoom.delete(socketId);
    return this.afterPlayerRemoved(room);
  }

  afterPlayerRemoved(room) {
    if (room.players.length === 0) {
      this.removeRoom(room.code);
      return null;
    }
    // 残った人は相手待ちに戻る（作った人が抜けても、残った人がその部屋を引き継ぐ）
    room.state = "waiting";
    room.players.forEach(p => { p.ready = false; });
    room.lastActive = this.now();
    room.waitingSince = this.now();
    return room;
  }

  // ----- 接続が切れた（すぐには席を消さない） -----
  disconnect(socketId) {
    const room = this.roomOf(socketId);
    if (!room) return null;
    const player = room.players.find(p => p.socketId === socketId);
    player.connected = false;
    player.disconnectedAt = this.now();
    player.ready = false;
    return room;
  }

  roomOf(socketId) {
    const code = this.socketRoom.get(socketId);
    return code ? this.rooms.get(code) || null : null;
  }

  removeRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.players.forEach(p => this.socketRoom.delete(p.socketId));
    this.rooms.delete(code);
    this.recentCodes.set(code, this.now());
  }

  // ----- 定期的に呼ぶ：戻ってこなかった人・古い部屋を片づける -----
  //  変化があった部屋のリストを返す（残っている人に知らせるため）
  cleanup() {
    const now = this.now();
    const changed = [];
    for (const room of Array.from(this.rooms.values())) {
      // 切断したまま戻らなかった人を席から外す
      const gone = room.players.filter(p => !p.connected && now - p.disconnectedAt > this.limits.graceMs);
      if (gone.length) {
        gone.forEach(p => this.socketRoom.delete(p.socketId));
        room.players = room.players.filter(p => !gone.includes(p));
        const left = this.afterPlayerRemoved(room);
        if (left) changed.push(left);
        continue;
      }
      // 相手が来ないまま長く待っている部屋・ずっと操作がない部屋は消す
      const waitingTooLong = room.state === "waiting" && now - (room.waitingSince || room.createdAt) > this.limits.waitingTtlMs;
      const idleTooLong = now - room.lastActive > this.limits.idleTtlMs;
      if (waitingTooLong || idleTooLong) {
        changed.push(Object.assign({}, room, { expired: true }));
        this.removeRoom(room.code);
      }
    }
    for (const [code, at] of this.recentCodes) {
      if (now - at > this.limits.recentCodeMs) this.recentCodes.delete(code);
    }
    return changed;
  }

  // ----- 画面に送る形（合言葉 token などの秘密は入れない） -----
  publicRoom(room) {
    return {
      code: room.code,
      state: room.state,
      expired: !!room.expired,
      players: room.players.map(p => ({
        name: p.name,
        side: p.side,
        ready: p.ready,
        connected: p.connected,
      })),
    };
  }
}

module.exports = { RoomManager, cleanName, LIMITS };
