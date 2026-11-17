// =====================================================
//  bots.js ― CPU（コンピューターの対戦相手）
//
//  CPU は「キーボードの代わりに、自分で入力を考える」だけで、
//  体の動き・ぶつかり判定は自分のキャラと同じ Player を使う。
//
//  考え方：
//   1. course.js の道しるべ（waypoints）のうち、まだ通っていない一番手前のものをめざす
//   2. 道しるべに「待つ条件」があれば、そこで止まってタイミングを待つ
//   3. 進む先に足場がない・段差がある → ジャンプする
// =====================================================

// CPU の名前・色・個性
const BOT_PROFILES = [
  { name: "ポポ",   bodyColor: 0xff6fae, limbColor: 0x7a5cff, speedScale: 0.97, skill: 0.9 },
  { name: "ミント", bodyColor: 0x5ad6b0, limbColor: 0xff8a3d, speedScale: 0.93, skill: 0.7 },
  { name: "ルル",   bodyColor: 0x6fb8ff, limbColor: 0xffe45c, speedScale: 0.95, skill: 0.8 },
  { name: "ガオ",   bodyColor: 0xffd23f, limbColor: 0xff5f6d, speedScale: 1.0,  skill: 0.5 },
  { name: "チップ", bodyColor: 0xb48cff, limbColor: 0x3ddc84, speedScale: 0.9,  skill: 0.6 },
];

class Bot {
  constructor(racer, skill) {
    this.racer = racer;      // 動かすキャラ（Player）
    this.skill = skill;      // うまさ（0〜1）。高いほど迷わず、ダッシュをよく使う
    this.lane = racer.startOffset.x * 0.25 + (Math.random() - 0.5) * 0.6; // 走るコースの横のずれ
    this.passed = new Set(); // 待ち終わった道しるべの番号
    this.waitDelay = 0;
    this.jumpHoldTimer = 0;
    this.jumpCooldown = 0;
    this.stuckTimer = 0;
    this.bestZ = racer.position.z;

    // 落ちたら、待ち状態を忘れる
    racer.onFall = () => this.reset();
  }

  reset() {
    this.passed.clear();
    this.jumpHoldTimer = 0;
    this.stuckTimer = 0;
    this.bestZ = this.racer.position.z;
  }

  // 今めざす道しるべを探す
  findWaypoint(waypoints) {
    const z = this.racer.position.z;
    for (let i = 0; i < waypoints.length; i++) {
      if (this.passed.has(i)) continue;
      const wp = waypoints[i];
      const margin = wp.waitUntil ? wp.margin : -0.3;
      if (wp.z < z + margin) return i; // まだ前にある
    }
    return -1;
  }

  // 毎フレーム：コントロール（キーボード入力の代わり）を作る
  think(dt, waypoints, world) {
    const r = this.racer;
    const p = r.position;
    const controls = { move: new THREE.Vector3(), jumpPressed: false, jumpHeld: false, dash: false };
    this.jumpCooldown -= dt;
    this.jumpHoldTimer -= dt;

    if (r.frozen) return controls;

    const index = this.findWaypoint(waypoints);
    if (index < 0 || r.finished) {
      // ゴールしたら、その場でたまにジャンプして喜ぶ
      if (r.finished && r.grounded && Math.random() < 0.02) controls.jumpPressed = true;
      controls.jumpHeld = true;
      return controls;
    }

    const wp = waypoints[index];
    const baseX = wp.follow ? wp.follow.mesh.position.x : wp.x;
    const tx = baseX + (wp.lane ? this.lane : 0);
    const tz = wp.z;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    let waiting = false;

    // --- 待つ道しるべ ---
    if (wp.waitUntil && dist < wp.radius && r.grounded) {
      waiting = true;
      if (wp.waitUntil()) {
        // 条件がそろっても、少しだけ迷う（うまいCPUほど迷わない）
        this.waitDelay -= dt;
        if (this.waitDelay <= 0) {
          this.passed.add(index);
          this.waitDelay = 0.05 + Math.random() * 0.3 * (1 - this.skill);
        }
      }
      // 道しるべの真ん中に立っているように少しだけ動く
      if (dist > 0.25) controls.move.set(dx, 0, dz).normalize().multiplyScalar(Math.min(1, dist));
    } else {
      // --- 道しるべに向かって進む ---
      if (dist > 0.001) controls.move.set(dx / dist, 0, dz / dist);
      // 待つ場所の近くではゆっくり
      if (wp.waitUntil && dist < 1.5) controls.move.multiplyScalar(Math.max(0.35, dist / 1.5));
      controls.dash = !wp.careful && !wp.waitUntil && Math.random() < 0.5 + this.skill * 0.5;
    }

    // --- ジャンプするか決める ---
    if (r.grounded && this.jumpCooldown <= 0 && controls.move.lengthSq() > 0.04) {
      const dir = controls.move.clone().normalize();
      const probeX = p.x + dir.x * 1.0;
      const probeZ = p.z + dir.z * 1.0;
      const ground = world.groundHeightAt(probeX, probeZ, p.y + 2.2);
      const gap = ground === null || ground < p.y - 1.2; // 先に足場がない
      const step = ground !== null && ground > p.y + 0.4; // 先が高い
      if (gap || step) {
        controls.jumpPressed = true;
        this.jumpHoldTimer = 0.35; // しばらく押し続けて高く跳ぶ
        this.jumpCooldown = 0.3;
      }
    }
    controls.jumpHeld = this.jumpHoldTimer > 0;

    // --- 引っかかって進めないときは、やり直す ---
    if (p.z < this.bestZ - 1) {
      this.bestZ = p.z;
      this.stuckTimer = 0;
    } else if (!waiting) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 8) {
        r.respawn(false);
        this.reset();
      }
    }

    return controls;
  }
}
