// =====================================================
//  selftest.js ― サーバーで「試合の計算」が動くか確かめる
//  ブラウザと同じ shared/physics.js・shared/match.js を使って、サーブを1本打ってみる
// =====================================================

const config = require("./config");
const Match = require(require("path").join(config.sharedDir, "match.js"));

function runSelfTest() {
  const started = Date.now();
  const match = new Match({ firstServer: 1, random: () => 0.5 });

  // ラケットを構えの位置に置く（プレイヤー1・2）
  match.setRacket(1, { x: 0.2, y: 1.0, z: 1.73, vx: 0, vy: 0, vz: 0, swinging: false, swingT: 0, power: 0 });
  match.setRacket(-1, { x: 0, y: 1.0, z: -1.73, vx: 0, vy: 0, vz: 0, swinging: false, swingT: 0, power: 0 });
  match.newPoint();
  match.requestServe(1, 0.6);

  // 2秒ぶん計算を進めて、起きたことを記録する
  const events = [];
  for (let i = 0; i < 120 && match.phase === "rally"; i++) {
    match.update(1 / 60);
    events.push(...match.takeEvents());
  }
  events.push(...match.takeEvents());

  return {
    ok: events.some(e => e.type === "serve") && events.some(e => e.type === "bounce"),
    phase: match.phase,
    score: { player1: match.score[1], player2: match.score[-1] },
    events: events.map(e => e.type + (e.side ? "(" + (e.side === 1 ? "P1側" : "P2側") + ")" : "") + (e.reason ? ":" + e.reason : "")),
    ms: Date.now() - started,
  };
}

module.exports = { runSelfTest };
