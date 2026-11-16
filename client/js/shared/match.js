// =====================================================
//  shared/match.js ― 試合の進行と審判（ブラウザとサーバーの両方で使う）
//
//  ・サーブ → ラリー → 得点 の流れ
//  ・ラケットに当たったか、どこへ飛ばすか
//  ・ルール：11点先取・2点差・2本ごとにサーブ交代（10-10以降は1本ごと）
//
//  プレイヤーは side で区別する：1 = プレイヤー1（z プラス側）, -1 = プレイヤー2
// =====================================================

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./physics.js"));
  else root.Match = factory(root.Physics);
})(typeof self !== "undefined" ? self : this, function (Physics) {
  const C = Physics.C;
  const SERVE_Z = C.TABLE_L / 2 + 0.12; // サーブを打つ場所（台のはしから12cm後ろ）
  const POINT_PAUSE = 1.8;              // 得点のあと、次のサーブまでの時間（秒）
  const RACKET_REACH = 0.15;            // ラケットの中心からこの距離まで当たる（少し大きめ＝やさしめ）

  // 標準正規分布の乱数（打球のブレに使う）
  function gaussian(random) {
    const u = Math.max(1e-6, random());
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  class Match {
    // options:
    //   firstServer … 最初にサーブする人（1 or -1）
    //   autoHit     … true：サーバー（またはこのブラウザ）がラケットの位置から当たりを判定する（練習モード）
    //                 false：プレイヤーの「当たった」という申告を確かめて判定する（オンライン対戦）
    //   history     … 巻き戻しのために、少し前までのボールの状態を記録する（オンライン対戦）
    //   graceTime   … 「返せなかった」の判定を少し待つ時間（通信の遅れで当たりの申告が遅れて届くため）
    constructor(options) {
      options = options || {};
      this.random = options.random || Math.random;
      this.firstServer = options.firstServer || 1;
      this.autoHit = options.autoHit !== false;
      this.recordHistory = !!options.history;
      this.graceTime = options.graceTime || 0;
      this.startCountdown = options.startCountdown || 0; // 試合開始前の「3・2・1」の秒数
      this.rackets = {};
      this.reset();
    }

    // ----- 試合を最初から -----
    reset() {
      this.score = { 1: 0, "-1": 0 };
      this.winner = 0;
      this.events = [];
      this.time = 0;
      this.accum = 0;
      this.ball = Physics.newBall();
      this.countdown = this.startCountdown;
      this.newPoint();
    }

    // 再戦（最初のサーブは前の試合と交代）
    rematch() {
      this.firstServer = -this.firstServer;
      this.reset();
    }

    // ----- 今サーブを打つのはどちらか -----
    currentServer() {
      const a = this.score[1];
      const b = this.score[-1];
      const total = a + b;
      if (a >= 10 && b >= 10) {
        return total % 2 === 0 ? this.firstServer : -this.firstServer; // 10-10以降は1本ごと
      }
      return Math.floor(total / 2) % 2 === 0 ? this.firstServer : -this.firstServer; // 2本ごと
    }

    // ----- 次のポイントの準備 -----
    newPoint() {
      this.phase = "serve";      // serve（サーブ待ち）/ rally / point（得点直後）/ gameover
      this.server = this.currentServer();
      this.lastHitter = 0;       // 最後に打った人
      this.serving = false;      // サーブのボールが飛んでいる途中か
      this.serveOwnBounced = false; // サーブが自分のコートで1回跳ねたか
      this.recvBounces = 0;      // 打たれたあと、相手のコートで跳ねた回数
      this.letCandidate = false; // サーブがネットにふれたか（入ればやり直し）
      this.rallyTime = 0;
      this.pointTimer = 0;
      this.lastPoint = null;
      this.pending = null;       // 判定を待っている得点（graceTime の間）
      this.history = [];
      this.ball.vel = { x: 0, y: 0, z: 0 };
      this.ball.spin = { x: 0, y: 0, z: 0 };
      this.placeServeBall();
    }

    // サーブ前のボールは、サーブする人のラケットの前に浮かべておく
    placeServeBall() {
      const s = this.server;
      const r = this.rackets[s];
      const x = r ? clamp(r.x, -0.6, 0.6) : 0;
      this.ball.pos = { x: x, y: C.TABLE_TOP + 0.4, z: s * SERVE_Z };
    }

    // ----- ラケットの状態を受け取る（毎フレーム） -----
    //  state: { x, y, z, vx, vy, vz, swinging, swingT(0〜1), power(0〜1) }
    setRacket(side, state) {
      const old = this.rackets[side];
      state.prevZ = old ? old.z : state.z;
      this.rackets[side] = state;
    }

    // ----- サーブを打つ -----
    requestServe(side, power) {
      if (this.phase !== "serve" || side !== this.server || this.countdown > 0) return false;
      const s = side;
      const p = clamp(power, 0, 1);
      const pos = this.ball.pos;
      // まず自分のコートに1回跳ねさせる（ネットから60〜80cm手前）。強いほど相手コートの深くに入る
      const target = { x: pos.x * 0.7, z: s * (0.8 - 0.2 * p) };
      const T = 0.14;
      const spin = { x: 0, y: 0, z: 0 };
      const vel = Physics.solveShot(pos, target, T, spin, false);
      this.ball.vel = vel;
      this.ball.spin = spin;
      this.phase = "rally";
      this.serving = true;
      this.lastHitter = s;
      this.events.push({ type: "serve", side: s, power: p, pos: [pos.x, pos.y, pos.z] });
      return true;
    }

    // ----- 時間を進める（中で細かいステップに分けて計算する） -----
    update(dt) {
      this.accum += Math.min(dt, 0.1);
      while (this.accum >= C.STEP) {
        this.accum -= C.STEP;
        this.tick(C.STEP);
      }
    }

    tick(dt) {
      this.time += dt;
      if (this.phase === "serve") {
        if (this.countdown > 0) this.countdown = Math.max(0, this.countdown - dt);
        this.placeServeBall();
        return;
      }
      if (this.phase === "point") {
        // 得点のあともボールは動かし続ける（見た目のため）
        Physics.step(this.ball, dt);
        this.pointTimer -= dt;
        if (this.pointTimer <= 0) {
          if (this.winner) {
            this.phase = "gameover";
            this.events.push({ type: "gameover", winner: this.winner });
          } else {
            this.newPoint();
          }
        }
        return;
      }
      if (this.phase !== "rally") return;

      // 判定待ちの得点：時間がたっても当たりの申告がなければ確定する
      if (this.pending && this.time - this.pending.at >= this.graceTime) {
        const p = this.pending;
        this.pending = null;
        this.awardPoint(p.winner, p.reason);
        return;
      }

      if (this.recordHistory) this.record();
      this.rallyTime += dt;
      const prev = { x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z };
      const events = Physics.step(this.ball, dt);
      for (const e of events) {
        if (this.phase !== "rally") break;
        if (e.type === "table") this.onTable(e.side);
        else if (e.type === "net") {
          if (this.serving) this.letCandidate = true;
          this.events.push({ type: "net", cord: e.cord, pos: [this.ball.pos.x, this.ball.pos.y, this.ball.pos.z] });
        } else if (e.type === "floor") this.onFloor();
      }
      if (this.phase !== "rally") return;

      // ラケットに当たったか（練習モードのみ。オンラインでは申告を確かめる）
      if (this.autoHit && !this.pending) {
        for (const side of [1, -1]) {
          if (side === this.lastHitter) continue;
          if (this.checkHit(side, prev)) break;
        }
      }

      // ボールが止まってしまったときなどの安全策
      const v = this.ball.vel;
      if (this.rallyTime > 60 || (Math.hypot(v.x, v.y, v.z) < 0.05 && this.rallyTime > 1)) {
        const half = this.ball.pos.z > 0 ? 1 : -1;
        this.awardPoint(-half, "stopped");
      }
    }

    // ----- 台で跳ねたとき -----
    onTable(half) {
      const hitter = this.lastHitter;
      const receiver = -hitter;
      const bp = this.ball.pos;
      this.events.push({ type: "bounce", side: half, time: this.time, pos: [bp.x, bp.y, bp.z] });

      if (this.serving && !this.serveOwnBounced) {
        if (half === hitter) this.serveOwnBounced = true;
        else this.awardPoint(receiver, "serve_fault"); // 自分のコートに入らなかった
        return;
      }
      if (this.serving) {
        if (half === receiver) {
          this.serving = false;
          this.recvBounces = 1;
          if (this.letCandidate) this.doLet(); // ネットにふれて入った → やり直し
        } else {
          this.awardPoint(receiver, "serve_fault"); // 自分のコートで2回跳ねた
        }
        return;
      }
      if (half === receiver) {
        this.recvBounces++;
        if (this.recvBounces >= 2) this.awardPoint(hitter, "double_bounce", true); // 返せなかった
      } else if (this.recvBounces === 0) {
        this.awardPoint(receiver, "own_side"); // 自分のコートに打ってしまった
      } else {
        this.awardPoint(hitter, "double_bounce", true);
      }
    }

    // ----- 床に落ちたとき -----
    onFloor() {
      const hitter = this.lastHitter;
      if (!this.serving && this.recvBounces >= 1) this.awardPoint(hitter, "missed", true); // 相手が返せなかった
      else this.awardPoint(-hitter, this.serving ? "serve_fault" : "out");      // 台に入らなかった
    }

    // サーブのやり直し（レット）
    doLet() {
      this.events.push({ type: "let" });
      this.phase = "point";
      this.pointTimer = 1.0;
      this.lastPoint = { winner: 0, reason: "let" };
    }

    // ----- ラケットに当たったか調べる -----
    //  ボールが「ラケットの面がある前後位置」を通りすぎた瞬間に、上下左右の距離を調べる
    checkHit(side, prev) {
      const r = this.rackets[side];
      if (!r) return false;
      const hit = Match.testHit(side, prev, this.ball.pos, this.ball.vel.z, r, r.prevZ);
      if (!hit) return false;
      this.onHit(side, r, hit.x, hit.y);
      return true;
    }

    // ----- 打ったとき -----
    onHit(side, r, cx, cy) {
      // 相手のコートで跳ねる前に打ってしまった
      if (this.recvBounces === 0) {
        const goingOut = Math.abs(this.ball.pos.z) > C.TABLE_L / 2; // もう台の外 → どうせアウトだった
        this.awardPoint(goingOut ? side : this.lastHitter, goingOut ? "out" : "volley");
        return;
      }

      // スイングのタイミング（振りの真ん中で当たるほど良い）
      let power;
      let quality;
      if (r.swinging) {
        quality = 1 - Math.min(1, Math.abs(r.swingT - 0.45) / 0.45);
        power = r.power * (0.55 + 0.45 * quality);
      } else {
        quality = 0.85; // 振らずに当てただけ（ブロック）
        power = 0.15;
      }

      // 打った人から見た「右」をプラスにして考える
      const offset = side * (cx - r.x);       // ラケットのどこで当たったか（右のはしで当たると左へ飛ぶ）
      const swingSide = side * (r.vx || 0);   // ラケットを横に振った速さ
      const ballSide = side * cx;
      let aimX = ballSide * 0.35 - offset * 4 - swingSide * 0.08;
      let depth = 0.5 + 0.7 * power;          // ネットから何m先に落とすか
      const spread = 0.04 + 0.3 * (1 - quality) * power; // タイミングが悪いほどブレる
      aimX = clamp(aimX, -0.65, 0.65) + gaussian(this.random) * spread;
      depth += gaussian(this.random) * spread * 1.2;

      // スマッシュ：強く振って、ネットより高い位置で打ったとき
      const aboveNet = cy - (C.TABLE_TOP + C.NET_H);
      const smash = r.swinging && power > 0.7 && aboveNet > 0.1;

      let T = 0.95 - 0.55 * power;            // 強いほど速く飛ぶ（ふつうの強打で約0.4秒）
      let topspin = r.swinging ? 30 + 140 * power * (0.6 + 0.4 * quality) : 15;
      if (smash) {
        // 高い打点ほど、より速く・低く・深く打ちこむ
        const height = Math.min(1, (aboveNet - 0.1) / 0.3);
        T = 0.34 - 0.08 * height;             // 約0.26〜0.34秒で相手コートへ
        depth = Math.max(depth, 1.0 + 0.2 * power);
        topspin += 40;                        // 強い回転で沈ませる
      }
      const target = { x: side * aimX, z: -side * depth };
      const spin = { x: -side * topspin, y: -(r.vx || 0) * 6, z: 0 };

      const from = { x: cx, y: cy, z: this.ball.pos.z };
      this.ball.pos = from;
      this.ball.vel = Physics.solveShot(from, target, T, spin, true);
      this.ball.spin = spin;
      this.lastHitter = side;
      this.recvBounces = 0;
      this.serving = false;
      this.events.push({ type: "hit", side: side, power: power, quality: quality, smash: smash, pos: [cx, cy, from.z] });
    }

    // ----- 得点 -----
    awardPoint(winner, reason, receiverFault) {
      if (this.pending) return; // すでに判定待ちの得点がある
      // 「返せなかった」は、通信の遅れを考えて少しだけ待ってから確定する（オンラインのみ）
      if (receiverFault && this.graceTime > 0) {
        this.pending = { winner: winner, reason: reason, at: this.time };
        return;
      }
      this.score[winner]++;
      this.lastPoint = { winner: winner, reason: reason };
      this.events.push({ type: "point", winner: winner, reason: reason, score: { 1: this.score[1], "-1": this.score[-1] } });
      const a = this.score[winner];
      const b = this.score[-winner];
      if (a >= 11 && a - b >= 2) this.winner = winner; // 11点以上で2点差
      this.phase = "point";
      this.pointTimer = POINT_PAUSE;
    }

    // ===== ここからオンライン対戦用 =====

    // 今の状態を記録しておく（巻き戻し用。0.5秒ぶん）
    record() {
      this.history.push({
        time: this.time,
        ball: Physics.cloneBall(this.ball),
        lastHitter: this.lastHitter,
        serving: this.serving,
        serveOwnBounced: this.serveOwnBounced,
        recvBounces: this.recvBounces,
        letCandidate: this.letCandidate,
        rallyTime: this.rallyTime,
      });
      while (this.history.length && this.time - this.history[0].time > 0.5) this.history.shift();
    }

    // プレイヤーからの「当たった」という申告を確かめて、正しければ打球にする
    //  t：申告した人の画面で当たった瞬間の試合時間
    //  巻き戻して打ったことにし、今の時間まで計算し直す
    applyRemoteHit(side, racket, cx, cy, t) {
      if (this.phase !== "rally") return { ok: false, reason: "phase" };
      if (!(this.time - t <= 0.45 && t <= this.time + 0.02)) return { ok: false, reason: "too_old" };
      let snap = null;
      for (let i = this.history.length - 1; i >= 0; i--) {
        if (this.history[i].time <= t) { snap = this.history[i]; break; }
      }
      if (!snap) return { ok: false, reason: "no_history" };
      if (snap.lastHitter === side) return { ok: false, reason: "same_hitter" };
      if (snap.ball.vel.z * side <= 0) return { ok: false, reason: "direction" };

      // 申告された当たった場所が、その時のボールの位置と近いか
      const bp = snap.ball.pos;
      if (Math.hypot(cx - bp.x, cy - bp.y) > 0.15 || Math.abs(bp.z - racket.z) > 0.3) {
        return { ok: false, reason: "far_from_ball" };
      }
      // ラケットの中心から届く距離か
      if (Math.hypot(cx - racket.x, cy - racket.y) > RACKET_REACH + 0.06) return { ok: false, reason: "far_from_racket" };

      // 巻き戻す
      const now = this.time;
      this.time = snap.time;
      this.ball = Physics.cloneBall(snap.ball);
      this.lastHitter = snap.lastHitter;
      this.serving = snap.serving;
      this.serveOwnBounced = snap.serveOwnBounced;
      this.recvBounces = snap.recvBounces;
      this.letCandidate = snap.letCandidate;
      this.rallyTime = snap.rallyTime;
      this.pending = null;
      this.history = this.history.filter(h => h.time <= snap.time);
      // 巻き戻した間に出た「バウンド」などのイベントは取り消す（申告した時点までのものだけ残す）
      this.events = this.events.filter(e => e.type !== "bounce" || e.time === undefined || e.time <= snap.time);

      // 打ったことにする
      this.ball.pos.z = racket.z;
      this.onHit(side, racket, cx, cy);

      // 今の時間まで計算し直す
      while (this.time < now - 1e-9 && this.phase !== "serve") this.tick(C.STEP);
      return { ok: true };
    }

    // 画面に送る形（ネットワーク用）
    snapshot() {
      const b = this.ball;
      const r3 = v => Math.round(v * 1000) / 1000;
      return {
        t: r3(this.time),
        phase: this.phase,
        server: this.server,
        score: [this.score[1], this.score[-1]],
        winner: this.winner,
        lastHitter: this.lastHitter,
        recvBounces: this.recvBounces,
        countdown: Math.round(this.countdown * 100) / 100,
        ball: {
          p: [r3(b.pos.x), r3(b.pos.y), r3(b.pos.z)],
          v: [r3(b.vel.x), r3(b.vel.y), r3(b.vel.z)],
          w: [Math.round(b.spin.x), Math.round(b.spin.y), Math.round(b.spin.z)],
        },
      };
    }

    // たまったイベントを受け取って空にする
    takeEvents() {
      const list = this.events;
      this.events = [];
      return list;
    }
  }

  // ----- ラケットに当たったかの判定（ブラウザとサーバーで同じものを使う） -----
  //  ボールが「ラケットの面がある前後位置」を通りすぎた瞬間に、上下左右の距離を調べる
  //  当たっていれば、当たった場所 { x, y, frac（前のフレームから何割進んだところか） } を返す
  Match.testHit = function (side, prevBall, ball, ballVelZ, racket, racketPrevZ) {
    if (ballVelZ * side <= 0) return null; // ボールがこの人の方へ向かっているときだけ
    const before = (prevBall.z - racketPrevZ) * side;
    const after = (ball.z - racket.z) * side;
    if (!(before < 0 && after >= 0)) return null;
    const frac = before / (before - after);
    const x = prevBall.x + (ball.x - prevBall.x) * frac;
    const y = prevBall.y + (ball.y - prevBall.y) * frac;
    const reach = RACKET_REACH + (racket.swinging ? 0.04 : 0);
    if (Math.hypot(x - racket.x, y - racket.y) > reach) return null;
    return { x: x, y: y, frac: frac };
  };
  Match.RACKET_REACH = RACKET_REACH;

  return Match;
});
