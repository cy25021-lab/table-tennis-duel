// =====================================================
//  gameRoom.js ― 1つの部屋の試合（サーバーが正解を持つ）
//
//  ・試合の計算（ボール・得点・サーブ権）はすべてここで行う
//  ・プレイヤーから届くのは「ラケットの状態」「サーブ」「当たりの申告」だけ
//    → おかしな値は直し、ありえない申告は受け付けない（得点を書き換える方法はない）
//  ・Socket.IO には依存しない（送る関数を外から渡す）ので、単体でテストできる
// =====================================================

const path = require("path");
const config = require("./config");
const Match = require(path.join(config.sharedDir, "match.js"));

const SNAPSHOT_EVERY = 2; // 何回の計算ごとに状態を送るか（60回/秒 ÷ 2 = 30回/秒）

// 数字でなければ def、範囲外なら範囲内に直す
function num(v, min, max, def) {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

class GameRoom {
  // send(event, data) … 部屋の2人に送る関数
  constructor(code, send, options) {
    options = options || {};
    this.code = code;
    this.send = send;
    this.now = options.now || (() => Date.now()); // テストで時間を進められるように
    this.match = new Match({
      firstServer: options.firstServer || 1,
      autoHit: false,   // 当たりはプレイヤーの申告を確かめて判定する
      history: true,    // 巻き戻しのために記録する
      graceTime: 0.4,   // 「返せなかった」の判定は0.4秒待つ
      startCountdown: 3, // 試合開始前に「3・2・1」
      random: options.random,
    });
    this.visual = { 1: null, "-1": null }; // 相手の画面でラケットを動かすための情報
    this.rematch = { 1: false, "-1": false };
    this.paused = false;
    this.tickCount = 0;
    this.inputCount = { 1: [], "-1": [] };
    this.rejected = 0; // 受け付けなかった申告の数（確認用）
  }

  // ----- ラケットの状態を受け取る -----
  setInput(side, d) {
    if (!d || typeof d !== "object") return;
    // 1秒に90回より多く送ってきたら無視する（送りすぎ対策）
    const now = this.now();
    const list = this.inputCount[side].filter(t => now - t < 1000);
    list.push(now);
    this.inputCount[side] = list;
    if (list.length > 90) return;

    const state = this.cleanRacket(side, d);
    this.match.setRacket(side, state);
    this.visual[side] = {
      lx: num(d.localX, -1, 1, 0),
      ly: num(d.localY, 0.7, 1.55, 1.02),
      swingId: Math.floor(num(d.swingId, 0, 1e9, 0)),
      power: num(d.power, 0, 1, 0.5),
    };
  }

  // ラケットの値を、その人が立つ側の「ありえる範囲」に直す
  cleanRacket(side, d) {
    const z = num(d.z, -2.1, 2.1, side * 1.73);
    return {
      x: num(d.x, -1.0, 1.0, 0),
      y: num(d.y, 0.7, 1.55, 1.02),
      z: side * Math.max(1.15, Math.min(2.0, side * z)), // 自分の側の、台のはし付近だけ
      vx: num(d.vx, -15, 15, 0),
      vy: num(d.vy, -15, 15, 0),
      vz: num(d.vz, -15, 15, 0),
      swinging: !!d.swinging,
      swingT: num(d.swingT, 0, 1, 0),
      power: num(d.power, 0, 1, 0),
    };
  }

  // ----- サーブ -----
  serve(side, d) {
    if (this.paused) return;
    this.match.requestServe(side, num(d && d.power, 0, 1, 0.5));
  }

  // ----- 当たりの申告 -----
  claimHit(side, d) {
    if (this.paused || !d) return { ok: false, reason: "paused" };
    const racket = this.cleanRacket(side, d.racket || {});
    const result = this.match.applyRemoteHit(side, racket, num(d.cx, -2, 2, 0), num(d.cy, 0, 3, 0), num(d.t, 0, 1e9, 0));
    if (!result.ok) this.rejected++;
    return result;
  }

  // ----- 再戦の希望 -----
  requestRematch(side) {
    if (this.match.phase !== "gameover") return;
    this.rematch[side] = true;
    this.send("game:events", [{ type: "rematch_request", side: side }]);
    if (this.rematch[1] && this.rematch[-1]) {
      this.rematch = { 1: false, "-1": false };
      this.match.rematch();
      this.send("game:events", [{ type: "rematch_start" }]);
    }
  }

  // ----- 相手の切断中は止める -----
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  // ----- 時間を進める（1秒に60回呼ばれる） -----
  update(dt) {
    if (!this.paused) this.match.update(dt);
    const events = this.match.takeEvents();
    if (events.length) this.send("game:events", events);
    this.tickCount++;
    if (this.tickCount % SNAPSHOT_EVERY === 0) this.send("game:state", this.snapshot());
  }

  snapshot() {
    const snap = this.match.snapshot();
    snap.st = this.now(); // サーバーの時刻（ミリ秒）
    snap.paused = this.paused;
    snap.rackets = { p1: this.visual[1], p2: this.visual[-1] };
    snap.rematch = [this.rematch[1], this.rematch[-1]];
    return snap;
  }
}

module.exports = { GameRoom };
