// =====================================================
//  shared/cpu.js ― 練習用のCPU（コンピューターの相手）
//
//  ボールの動きを先読みして、ラケットをそこへ動かし、
//  ちょうどいいタイミングでスイングする。
// =====================================================

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./physics.js"));
  else root.Cpu = factory(root.Physics);
})(typeof self !== "undefined" ? self : this, function (Physics) {
  const CONTACT_Z = 1.45;     // だいたいこの前後位置でボールに当たる（スイングで前に出たとき）
  const SWING_LEAD = 0.13;    // 当たる何秒前にスイングを始めるか

  class Cpu {
    // skill：0〜1（大きいほど正確）
    constructor(side, skill, random) {
      this.side = side;
      this.skill = skill;
      this.random = random || Math.random;
      this.serveTimer = 1.2;
      this.swung = false;
      this.prediction = null;
      this.recalc = 0;
      this.errorX = 0;
      this.errorY = 0;
      this.lead = SWING_LEAD;
    }

    // ボールがこの人の打つ位置まで来るときの場所と時間を予測する
    predict(ball) {
      const b = Physics.cloneBall(ball);
      let t = 0;
      for (let i = 0; i < 600; i++) {
        const events = Physics.step(b, Physics.C.STEP);
        t += Physics.C.STEP;
        if (events.some(e => e.type === "floor")) return null;
        if (b.pos.z * this.side >= CONTACT_Z) return { x: b.pos.x, y: b.pos.y, t: t };
      }
      return null;
    }

    // 毎フレーム：どう動くかを決める
    //  返す値：{ x, y（ラケットの目標。本人から見た向き）, swing（0 なら振らない）, serve（0 ならサーブしない） }
    think(dt, match) {
      const out = { x: 0, y: 1.02, swing: 0, serve: 0 };
      const side = this.side;

      // --- サーブ ---
      if (match.phase === "serve" && match.server === side) {
        out.x = 0.15;
        this.serveTimer -= dt;
        if (this.serveTimer <= 0) {
          out.serve = 0.35 + this.random() * 0.4;
          this.serveTimer = 1.2 + this.random();
        }
        return out;
      }
      this.serveTimer = 1.2;

      // --- 相手が打ったボールがこっちへ来ている ---
      if (match.phase === "rally" && match.lastHitter === -side && match.ball.vel.z * side > 0) {
        if (!this.prediction) {
          // 新しいボールが来たら、うまさに応じたズレを決める
          this.errorX = (this.random() - 0.5) * 0.5 * (1 - this.skill);
          this.errorY = (this.random() - 0.5) * 0.3 * (1 - this.skill);
          this.lead = SWING_LEAD + (this.random() - 0.5) * 0.15 * (1 - this.skill);
          // たまに大きく空振りする（うまいほど少ない）
          if (this.random() < (1 - this.skill) * 0.35) {
            this.errorX += (this.random() < 0.5 ? -1 : 1) * (0.18 + this.random() * 0.1);
          }
        }
        this.recalc -= dt;
        if (this.recalc <= 0 || !this.prediction) {
          this.prediction = this.predict(match.ball);
          this.recalc = 0.08;
        }
        const p = this.prediction;
        if (p) {
          out.x = side * p.x + this.errorX; // 本人から見た向きに変える
          out.y = p.y + this.errorY;
          if (!this.swung && p.t <= this.lead) {
            out.swing = 0.45 + this.random() * 0.4 * this.skill;
            this.swung = true;
          }
        }
        return out;
      }

      // --- それ以外：構えの位置に戻る ---
      this.swung = false;
      this.prediction = null;
      return out;
    }
  }

  return Cpu;
});
