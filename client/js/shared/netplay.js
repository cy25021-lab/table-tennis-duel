// =====================================================
//  shared/netplay.js ― オンライン対戦のブラウザ側の仕組み（テストでも使えるように共通ファイル）
//
//  ・SnapshotBuffer：サーバーから届いた状態をためて、少し前の時刻の状態をなめらかにつなぐ（補間）
//  ・NetPlayer：自分のラケットの送信、サーブ、当たりの申告、相手のラケットの動かし方
// =====================================================

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./match.js"));
  else root.Netplay = factory(root.Match);
})(typeof self !== "undefined" ? self : this, function (Match) {
  const INTERP_DELAY = 70; // 何ミリ秒前の状態を表示するか（届く間隔のばらつきを吸収する）

  // -----------------------------------------------------
  //  状態をためて、指定した時刻の状態を計算する
  // -----------------------------------------------------
  class SnapshotBuffer {
    constructor() {
      this.list = [];
    }

    push(snap) {
      // 順番が入れ替わって届いたものは捨てる
      const last = this.list[this.list.length - 1];
      if (last && snap.st <= last.st) return;
      this.list.push(snap);
      while (this.list.length > 60) this.list.shift();
    }

    latest() {
      return this.list[this.list.length - 1] || null;
    }

    // serverTime（ミリ秒）のときの状態
    sample(serverTime) {
      const list = this.list;
      if (!list.length) return null;
      if (serverTime <= list[0].st) return this.fromSnap(list[0], list[0], 0);
      for (let i = list.length - 1; i >= 0; i--) {
        const a = list[i];
        if (a.st <= serverTime) {
          const b = list[i + 1];
          if (!b) {
            // 新しい状態がまだ届いていない → 速度を使って少しだけ先を予想する（最大0.1秒）
            const ahead = Math.min(0.1, (serverTime - a.st) / 1000);
            return this.fromSnap(a, a, 0, ahead);
          }
          const k = (serverTime - a.st) / (b.st - a.st);
          return this.fromSnap(a, b, k);
        }
      }
      return null;
    }

    fromSnap(a, b, k, ahead) {
      const lerp = (x, y) => x + (y - x) * k;
      // サーブの準備などでボールが瞬間移動したときは、補間しない
      const jump = Math.hypot(b.ball.p[0] - a.ball.p[0], b.ball.p[1] - a.ball.p[1], b.ball.p[2] - a.ball.p[2]) > 1.2;
      const src = jump && k > 0.5 ? b : a;
      const pos = jump
        ? { x: src.ball.p[0], y: src.ball.p[1], z: src.ball.p[2] }
        : { x: lerp(a.ball.p[0], b.ball.p[0]), y: lerp(a.ball.p[1], b.ball.p[1]), z: lerp(a.ball.p[2], b.ball.p[2]) };
      const v = b.ball.v;
      if (ahead) {
        pos.x += v[0] * ahead;
        pos.y += v[1] * ahead - 4.9 * ahead * ahead;
        pos.z += v[2] * ahead;
      }
      return {
        t: lerp(a.t, b.t) + (ahead || 0),  // 試合の時間（秒）
        pos: pos,
        vel: { x: v[0], y: v[1], z: v[2] },
        spin: { x: b.ball.w[0], y: b.ball.w[1], z: b.ball.w[2] },
        lastHitter: a.lastHitter,
        recvBounces: a.recvBounces,
        phase: a.phase,
      };
    }
  }

  // -----------------------------------------------------
  //  オンライン対戦の自分側の処理
  //   send(event, data) … サーバーに送る関数
  //   now()             … 自分のPCの時刻（ミリ秒）
  // -----------------------------------------------------
  class NetPlayer {
    constructor(side, send, now) {
      this.side = side;
      this.send = send;
      this.now = now || (() => Date.now());
      this.buffer = new SnapshotBuffer();
      this.clockOffset = null;   // サーバーの時刻 − 自分の時刻（ミリ秒）
      this.sendTimer = 0;
      this.prevSample = null;
      this.claimCooldown = 0;
      this.wasSwinging = false;
      this.swingId = 0;          // スイングするたびに1増える（相手の画面でスイングを再現するため）
      this.oppSwingId = null;
    }

    // 通信の往復時間を測ったときに、サーバーとの時刻のずれを更新する
    updateClock(serverTime, sentAt, receivedAt) {
      const rtt = receivedAt - sentAt;
      const offset = serverTime + rtt / 2 - receivedAt;
      this.clockOffset = this.clockOffset === null ? offset : this.clockOffset * 0.8 + offset * 0.2;
    }

    serverNow() {
      return this.now() + (this.clockOffset || 0);
    }

    // サーバーから状態が届いた
    onState(snap) {
      if (this.clockOffset === null) this.clockOffset = snap.st - this.now(); // 最初の目安
      this.buffer.push(snap);
    }

    // 表示する時刻の状態
    view() {
      return this.buffer.sample(this.serverNow() - INTERP_DELAY);
    }

    // 毎フレーム呼ぶ
    //  my：自分のラケットの状態 { x, y, z, vx, vy, vz, swinging, swingT, power, localX, localY }
    //  返す値：表示用の状態（ボールの位置など）
    update(dt, my) {
      const latest = this.buffer.latest();
      const view = this.view();

      // --- スイングを始めた瞬間 ---
      if (my.swinging && !this.wasSwinging) {
        this.swingId++;
        if (latest && latest.phase === "serve" && latest.server === this.side) {
          this.send("game:serve", { power: my.power });
        }
      }
      this.wasSwinging = my.swinging;

      // --- 自分のラケットの状態を送る（1秒に30回） ---
      this.sendTimer -= dt;
      if (this.sendTimer <= 0) {
        this.sendTimer = 1 / 30;
        this.send("game:input", Object.assign({ swingId: this.swingId }, my));
      }

      // --- 自分の画面でボールがラケットに当たったか調べて、当たったら申告する ---
      this.claimCooldown -= dt;
      if (view && this.prevSample && view.phase === "rally" && view.lastHitter === -this.side && this.claimCooldown <= 0) {
        const hit = Match.testHit(this.side, this.prevSample.pos, view.pos, view.vel.z, my, this.prevRacketZ);
        if (hit) {
          const t = this.prevSample.t + (view.t - this.prevSample.t) * hit.frac;
          this.send("game:hit", { t: t, cx: hit.x, cy: hit.y, racket: my });
          this.claimCooldown = 0.3;
        }
      }
      this.prevSample = view;
      this.prevRacketZ = my.z;
      return view;
    }

    // 相手のラケットを、届いた情報どおりに動かす（racket は Racket の見た目）
    driveOpponent(racketLike) {
      const latest = this.buffer.latest();
      if (!latest || !latest.rackets) return;
      const r = latest.rackets[this.side === 1 ? "p2" : "p1"];
      if (!r) return;
      racketLike.setTarget(r.lx, r.ly);
      if (this.oppSwingId !== null && r.swingId !== this.oppSwingId) racketLike.startSwing(r.power);
      this.oppSwingId = r.swingId;
    }
  }

  return { SnapshotBuffer, NetPlayer, INTERP_DELAY };
});
