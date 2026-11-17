// =====================================================
//  shared/physics.js ― ボールの物理演算（ブラウザとサーバーの両方で使う）
//
//  ・重力、空気抵抗、回転による曲がり（マグヌス効果）
//  ・卓球台でのバウンド（回転の影響も受ける）
//  ・ネットとの衝突、床への落下
//  ・狙った場所に落ちる打球の速さを計算する（solveShot）
//
//  単位：メートル・秒。座標の向きは client/js/constants.js と同じ
// =====================================================

(function (root, factory) {
  // Node.js では module.exports、ブラウザでは window.Physics として使えるようにする
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Physics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const C = {
    G: 9.81,             // 重力
    R: 0.02,             // ボールの半径（直径40mm）
    DRAG: 0.11,          // 空気抵抗の強さ
    MAGNUS: 0.0028,      // 回転で曲がる強さ
    SPIN_DECAY: 0.25,    // 回転が弱まる速さ（1秒あたりの割合）
    TABLE_L: 2.74,
    TABLE_W: 1.525,
    TABLE_TOP: 0.76,
    NET_H: 0.1525,
    NET_HALF: 1.525 / 2 + 0.1525, // ネットの横幅の半分
    TABLE_E: 0.88,       // 台での跳ね返りの強さ（30cmから落として約23cm跳ねる）
    TABLE_GRIP: 0.3,     // 台での回転のかかり具合
    FLOOR_E: 0.55,
    STEP: 1 / 240,       // 1回の計算で進める時間（細かいほど正確）
  };

  function newBall() {
    return {
      pos: { x: 0, y: C.TABLE_TOP + 0.3, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      spin: { x: 0, y: 0, z: 0 }, // 回転（軸の向き×速さ、ラジアン/秒）
    };
  }

  function cloneBall(b) {
    return {
      pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
      vel: { x: b.vel.x, y: b.vel.y, z: b.vel.z },
      spin: { x: b.spin.x, y: b.spin.y, z: b.spin.z },
    };
  }

  // ----- 空中の動き（重力・空気抵抗・回転による曲がり） -----
  function flight(b, dt) {
    const v = b.vel;
    const w = b.spin;
    const speed = Math.hypot(v.x, v.y, v.z);
    // 回転 × 速度 の向きに曲がる（トップスピンなら下へ落ちる）
    const ax = -C.DRAG * speed * v.x + C.MAGNUS * (w.y * v.z - w.z * v.y);
    const ay = -C.G - C.DRAG * speed * v.y + C.MAGNUS * (w.z * v.x - w.x * v.z);
    const az = -C.DRAG * speed * v.z + C.MAGNUS * (w.x * v.y - w.y * v.x);
    v.x += ax * dt;
    v.y += ay * dt;
    v.z += az * dt;
    b.pos.x += v.x * dt;
    b.pos.y += v.y * dt;
    b.pos.z += v.z * dt;
    const decay = 1 - C.SPIN_DECAY * dt;
    w.x *= decay;
    w.y *= decay;
    w.z *= decay;
  }

  // ----- 台でのバウンド -----
  function bounceOnTable(b) {
    const v = b.vel;
    const w = b.spin;
    const R = C.R;
    b.pos.y = C.TABLE_TOP + R;
    v.y = -v.y * C.TABLE_E;
    if (v.y < 0.25) v.y = 0; // ほとんど跳ねないときは、転がっていることにする
    // ボールの下側（台にふれる点）の速さ。回転があると滑る向きが変わる
    const slipX = v.x + R * w.z;
    const slipZ = v.z - R * w.x;
    const jx = -C.TABLE_GRIP * slipX;
    const jz = -C.TABLE_GRIP * slipZ;
    v.x += jx;
    v.z += jz;
    // 台にこすられて回転も変わる（中空の球なので 3/(2R) を使う）
    w.x += (-3 * jz) / (2 * R);
    w.z += (3 * jx) / (2 * R);
  }

  // ----- 1ステップ進める。起きたこと（イベント）のリストを返す -----
  //   { type: "table", side: 1 or -1 }  … どちら側のコートで跳ねたか
  //   { type: "net", cord: true/false } … ネット（cord = 上のテープにかすった）
  //   { type: "floor" }                 … 床に落ちた
  function step(b, dt) {
    const events = [];
    const prev = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    flight(b, dt);
    const p = b.pos;
    const v = b.vel;

    // ネット（z = 0 をまたいだとき）
    if ((prev.z > 0) !== (p.z > 0)) {
      const t = prev.z / (prev.z - p.z);
      const x = prev.x + (p.x - prev.x) * t;
      const y = prev.y + (p.y - prev.y) * t;
      const netTop = C.TABLE_TOP + C.NET_H;
      if (Math.abs(x) < C.NET_HALF && y - C.R < netTop && y > C.TABLE_TOP) {
        if (y < netTop - C.R * 0.5) {
          // 網に当たって、打った側へ跳ね返る
          p.z = (prev.z > 0 ? 1 : -1) * C.R * 1.1;
          v.z = -v.z * 0.15;
          v.x *= 0.4;
          v.y *= 0.4;
          b.spin.x *= 0.3;
          b.spin.y *= 0.3;
          b.spin.z *= 0.3;
          events.push({ type: "net", cord: false });
        } else {
          // 上のテープにかすって、勢いが落ちる
          v.y = Math.abs(v.y) * 0.4 + 0.5;
          v.z *= 0.5;
          events.push({ type: "net", cord: true });
        }
      }
    }

    // 台（上の面に上から当たったとき）
    const onTable = Math.abs(p.x) <= C.TABLE_W / 2 && Math.abs(p.z) <= C.TABLE_L / 2;
    if (v.y <= 0 && p.y - C.R < C.TABLE_TOP && prev.y - C.R >= C.TABLE_TOP - 0.002 && onTable) {
      const hard = v.y < -0.3; // ある程度の速さで当たったときだけ「バウンド」と数える
      bounceOnTable(b);
      if (hard) events.push({ type: "table", side: p.z > 0 ? 1 : -1 });
    }

    // 床
    if (p.y < C.R) {
      p.y = C.R;
      v.y = -v.y * C.FLOOR_E;
      v.x *= 0.8;
      v.z *= 0.8;
      events.push({ type: "floor" });
    }
    return events;
  }

  // ----- 台の高さまで落ちてくるところを予測する（台やネットには当てない） -----
  function simulateToTable(pos, vel, spin) {
    const b = cloneBall({ pos: pos, vel: vel, spin: spin });
    let t = 0;
    let yAtNet = null;
    for (let i = 0; i < 1200; i++) {
      const prevZ = b.pos.z;
      flight(b, C.STEP);
      t += C.STEP;
      if (yAtNet === null && (prevZ > 0) !== (b.pos.z > 0)) yAtNet = b.pos.y;
      if (b.vel.y < 0 && b.pos.y <= C.TABLE_TOP + C.R) {
        return { x: b.pos.x, z: b.pos.z, t: t, yAtNet: yAtNet };
      }
    }
    return null;
  }

  // ----- 狙った場所 target に、だいたい T 秒で落ちる打球の速度を求める -----
  //  回転や空気抵抗があると計算どおりに飛ばないので、試しに飛ばして少しずつ直す
  function solveShot(pos, target, T, spin, needNet) {
    let result = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const vel = {
        x: (target.x - pos.x) / T,
        y: (C.TABLE_TOP + C.R - pos.y + 0.5 * C.G * T * T) / T,
        z: (target.z - pos.z) / T,
      };
      let land = null;
      for (let iter = 0; iter < 6; iter++) {
        land = simulateToTable(pos, vel, spin);
        if (!land) {
          vel.y += 0.5;
          continue;
        }
        vel.x += (target.x - land.x) / land.t;
        vel.z += (target.z - land.z) / land.t;
      }
      result = vel;
      // ネットを越えられないなら、少しだけゆっくり高い球にしてやり直す（できるだけ速さを保つ）
      if (needNet && land && land.yAtNet !== null && land.yAtNet < C.TABLE_TOP + C.NET_H + C.R + 0.02) {
        T *= 1.07;
        continue;
      }
      break;
    }
    return result;
  }

  return { C, newBall, cloneBall, flight, step, simulateToTable, solveShot };
});
