// =====================================================
//  race/raceRooms.js ― SKY HOP RUN（障害物レース）の部屋の管理
//
//  ・6桁のルームコード、最大8人
//  ・部屋を作った人が「ホスト」。ホストがスタートを押すとレース開始
//    （ホストが抜けたら、次に入った人がホストになる）
//  ・ゴールタイムはサーバーの時計で計る（ブラウザが送ったタイムは使わない）
//  ・Socket.IO に依存しないので、単体でテストできる
// =====================================================

const crypto = require("crypto");

const RACE = {
  maxPlayers: 8,
  minPlayers: 2,
  countdownMs: 3500,              // スタートを押してから走り出すまで（3・2・1・GO）
  minFinishMs: 20000,             // これより速いゴールはありえない（不正対策）
  finishWindowMs: 90000,          // 1位がゴールしてから、残りの人を待つ時間
  graceMs: 30000,                 // 切断してから席を残す時間
  idleTtlMs: 60 * 60 * 1000,      // 何も起きないまま1時間たった部屋は消す
  recentCodeMs: 10 * 60 * 1000,   // 消えた部屋のコードは10分は使わない
};

function cleanName(name) {
  const s = String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
  return s || "PLAYER";
}

class RaceRooms {
  constructor(options) {
    options = options || {};
    this.now = options.now || (() => Date.now());
    this.cfg = Object.assign({}, RACE, options.cfg || {});
    this.rooms = new Map();
    this.socketRoom = new Map();
    this.recentCodes = new Map();
  }

  generateCode() {
    for (let i = 0; i < 1000; i++) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      if (this.rooms.has(code)) continue;
      const at = this.recentCodes.get(code);
      if (at && this.now() - at < this.cfg.recentCodeMs) continue;
      return code;
    }
    throw new Error("ルームコードを作れませんでした");
  }

  // あいている一番小さい番号（スタート位置と色に使う）
  freeSlot(room) {
    for (let i = 0; i < this.cfg.maxPlayers; i++) {
      if (!room.players.some(p => p.slot === i)) return i;
    }
    return -1;
  }

  newPlayer(socketId, name, slot) {
    return {
      id: crypto.randomBytes(6).toString("hex"), // みんなに見せてもいい番号
      socketId: socketId,
      token: crypto.randomBytes(12).toString("hex"), // つなぎ直し用の合言葉（本人だけが知る）
      name: cleanName(name),
      slot: slot,
      connected: true,
      disconnectedAt: 0,
      finishMs: 0,       // ゴールタイム（ミリ秒）。0 = まだ
      state: null,       // 最後に届いた位置など
    };
  }

  create(socketId, name) {
    this.leave(socketId);
    const code = this.generateCode();
    const player = this.newPlayer(socketId, name, 0);
    const room = {
      code: code,
      state: "lobby",    // lobby（待合室）/ countdown / racing / results
      hostId: player.id,
      players: [player],
      startAt: 0,
      firstFinishAt: 0,
      lastActive: this.now(),
    };
    this.rooms.set(code, room);
    this.socketRoom.set(socketId, code);
    return { ok: true, room: room, player: player };
  }

  join(socketId, code, name) {
    code = String(code || "").trim();
    if (!/^\d{6}$/.test(code)) return { ok: false, error: "invalid_code" };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "not_found" };
    if (room.players.some(p => p.socketId === socketId)) return { ok: false, error: "already_in_room" };
    if (room.players.length >= this.cfg.maxPlayers) return { ok: false, error: "full" };
    if (room.state !== "lobby") return { ok: false, error: "racing" }; // レース中は入れない
    this.leave(socketId);
    const player = this.newPlayer(socketId, name, this.freeSlot(room));
    room.players.push(player);
    room.lastActive = this.now();
    this.socketRoom.set(socketId, code);
    return { ok: true, room: room, player: player };
  }

  rejoin(socketId, code, token) {
    const room = this.rooms.get(String(code || ""));
    if (!room) return { ok: false, error: "not_found" };
    const player = room.players.find(p => p.token === token);
    if (!player) return { ok: false, error: "not_found" };
    if (player.socketId !== socketId) this.socketRoom.delete(player.socketId);
    player.socketId = socketId;
    player.connected = true;
    player.disconnectedAt = 0;
    this.socketRoom.set(socketId, room.code);
    return { ok: true, room: room, player: player };
  }

  // ----- ホストがスタート -----
  start(socketId) {
    const room = this.roomOf(socketId);
    if (!room) return { ok: false, error: "not_in_room" };
    const player = this.playerOf(socketId);
    if (player.id !== room.hostId) return { ok: false, error: "not_host" };
    if (room.state !== "lobby") return { ok: false, error: "not_lobby" };
    const active = room.players.filter(p => p.connected);
    if (active.length < this.cfg.minPlayers) return { ok: false, error: "not_enough" };
    room.state = "countdown";
    room.startAt = this.now() + this.cfg.countdownMs;
    room.firstFinishAt = 0;
    room.players.forEach(p => { p.finishMs = 0; p.state = null; });
    room.lastActive = this.now();
    return { ok: true, room: room };
  }

  // ----- 位置などを受け取る（中身は直してから保存） -----
  updateState(socketId, s) {
    const room = this.roomOf(socketId);
    if (!room || (room.state !== "racing" && room.state !== "countdown")) return null;
    const player = this.playerOf(socketId);
    if (!s || typeof s !== "object") return null;
    const n = (v, lo, hi) => {
      v = Number(v);
      return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;
    };
    const arr = (a, lo, hi) => (Array.isArray(a) ? [n(a[0], lo, hi), n(a[1], lo, hi), n(a[2], lo, hi)] : [0, 0, 0]);
    player.state = {
      p: arr(s.p, -400, 400),
      v: arr(s.v, -60, 60),
      f: n(s.f, -100, 100),
      g: !!s.g,
      st: !!s.st,   // はじき飛ばされ中
      cp: Math.floor(n(s.cp, 0, 10)),
      t: this.now(),
    };
    room.lastActive = this.now();
    return room;
  }

  // ----- ゴール（タイムはサーバーの時計で計る） -----
  finish(socketId) {
    const room = this.roomOf(socketId);
    if (!room || room.state !== "racing") return { ok: false, error: "not_racing" };
    const player = this.playerOf(socketId);
    if (player.finishMs) return { ok: false, error: "already" };
    const ms = this.now() - room.startAt;
    if (ms < this.cfg.minFinishMs) return { ok: false, error: "too_fast" };
    // 最後に届いた位置がゴールの近くでなければ受け付けない
    if (!player.state || player.state.p[2] > -205) return { ok: false, error: "not_at_goal" };
    player.finishMs = ms;
    if (!room.firstFinishAt) room.firstFinishAt = this.now();
    const rank = room.players.filter(p => p.finishMs).length;
    return { ok: true, room: room, player: player, ms: ms, rank: rank };
  }

  // ----- レース後、待合室に戻る（ホストのみ） -----
  backToLobby(socketId) {
    const room = this.roomOf(socketId);
    if (!room) return { ok: false, error: "not_in_room" };
    if (this.playerOf(socketId).id !== room.hostId) return { ok: false, error: "not_host" };
    if (room.state !== "results") return { ok: false, error: "not_results" };
    room.state = "lobby";
    room.players.forEach(p => { p.finishMs = 0; p.state = null; });
    return { ok: true, room: room };
  }

  leave(socketId) {
    const room = this.roomOf(socketId);
    if (!room) return null;
    room.players = room.players.filter(p => p.socketId !== socketId);
    this.socketRoom.delete(socketId);
    return this.afterRemoved(room);
  }

  disconnect(socketId) {
    const room = this.roomOf(socketId);
    if (!room) return null;
    const player = this.playerOf(socketId);
    player.connected = false;
    player.disconnectedAt = this.now();
    return room;
  }

  afterRemoved(room) {
    if (room.players.length === 0) {
      this.removeRoom(room.code);
      return null;
    }
    // ホストがいなくなったら、残っている人の先頭をホストにする
    if (!room.players.some(p => p.id === room.hostId)) room.hostId = room.players[0].id;
    room.lastActive = this.now();
    return room;
  }

  removeRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.players.forEach(p => this.socketRoom.delete(p.socketId));
    this.rooms.delete(code);
    this.recentCodes.set(code, this.now());
  }

  roomOf(socketId) {
    const code = this.socketRoom.get(socketId);
    return code ? this.rooms.get(code) || null : null;
  }

  playerOf(socketId) {
    const room = this.roomOf(socketId);
    return room ? room.players.find(p => p.socketId === socketId) : null;
  }

  // ----- 定期的に呼ぶ：状態の進行・片づけ。変化があった部屋を返す -----
  tick() {
    const now = this.now();
    const changed = [];
    for (const room of Array.from(this.rooms.values())) {
      let didChange = false;
      // 戻ってこなかった人を外す
      const gone = room.players.filter(p => !p.connected && now - p.disconnectedAt > this.cfg.graceMs);
      if (gone.length) {
        gone.forEach(p => this.socketRoom.delete(p.socketId));
        room.players = room.players.filter(p => !gone.includes(p));
        if (!this.afterRemoved(room)) continue; // 部屋が空になって消えた
        didChange = true;
      }
      // カウントダウンが終わったら走り出す
      if (room.state === "countdown" && now >= room.startAt) {
        room.state = "racing";
        didChange = true;
      }
      // 全員ゴール、または1位から一定時間たったら結果発表
      if (room.state === "racing") {
        const racing = room.players.filter(p => p.connected || p.finishMs);
        const allDone = racing.length > 0 && racing.every(p => p.finishMs);
        const timeUp = room.firstFinishAt && now - room.firstFinishAt > this.cfg.finishWindowMs;
        if (allDone || timeUp) {
          room.state = "results";
          didChange = true;
        }
      }
      // ずっと何もない部屋は消す
      if (now - room.lastActive > this.cfg.idleTtlMs) {
        changed.push(Object.assign({}, room, { expired: true }));
        this.removeRoom(room.code);
        continue;
      }
      if (didChange) changed.push(room);
    }
    for (const [code, at] of this.recentCodes) {
      if (now - at > this.cfg.recentCodeMs) this.recentCodes.delete(code);
    }
    return changed;
  }

  // ----- みんなに見せる形（合言葉や接続IDは入れない） -----
  publicRoom(room) {
    return {
      code: room.code,
      state: room.state,
      hostId: room.hostId,
      startAt: room.startAt,
      expired: !!room.expired,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        connected: p.connected,
        finishMs: p.finishMs,
      })),
    };
  }

  // レース中の全員の位置（まとめて送る）
  states(room) {
    const list = [];
    for (const p of room.players) {
      if (p.state) list.push(Object.assign({ id: p.id }, p.state));
    }
    return list;
  }
}

module.exports = { RaceRooms, RACE, cleanName };
