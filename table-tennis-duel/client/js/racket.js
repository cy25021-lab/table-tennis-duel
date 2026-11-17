// =====================================================
//  racket.js ― ラケット・腕・相手プレイヤーの体
//
//  ラケットの位置は「そのプレイヤーから見た向き」で考える：
//    x       … 右がプラス
//    y       … 床からの高さ
//    forward … 目の位置から前へどれだけ離れているか
//  side（1 = プレイヤー1, -1 = プレイヤー2）を使って、3D空間の座標に変える
// =====================================================

// プレイヤーから見た位置 → 3D空間の座標
function playerToWorld(side, x, y, forward) {
  return new THREE.Vector3(side * x, y, side * (VIEW.distance - forward));
}

// 2点の間に円柱をつなぐ（腕に使う）
function stretchBetween(mesh, from, to) {
  const dir = to.clone().sub(from);
  const length = dir.length();
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

const SWING_TIME = 0.28; // スイング1回にかかる時間（秒）

class Racket {
  constructor(scene, side) {
    this.side = side;

    // 動かす目標と、今の位置（プレイヤーから見た向き）
    this.target = { x: 0.35, y: RACKET_AREA.homeY };
    this.local = { x: 0.35, y: RACKET_AREA.homeY };

    this.charge = 0;            // ため（0〜1）
    this.swingTime = -1;        // スイングの経過時間（-1 = スイングしていない）
    this.swingPower = 0;        // スイングの強さ（0〜1）
    this.flip = 0;              // 0 = フォア（赤い面）、PI = バック（黒い面）

    this.worldPos = new THREE.Vector3();
    this.velocity = new THREE.Vector3(); // ラケットの速さ（STEP 3 で打球に使う）

    this.root = this.createMesh();
    this.root.rotation.order = "YXZ"; // 回す順番：横向き → 傾き → ひねり
    scene.add(this.root);
  }

  // ----- 見た目 -----
  createMesh() {
    const root = new THREE.Group();
    const R = RACKET.bladeRadius;

    // ブレード（木の板）
    const wood = new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.6 });
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.005, 40), wood);
    blade.rotation.x = Math.PI / 2; // 円柱を立てて、面が前を向くようにする
    blade.castShadow = true;
    root.add(blade);

    // ラバー（表：赤、裏：黒）
    const rubber = (color, z) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(R - 0.002, R - 0.002, 0.0015, 40),
        new THREE.MeshStandardMaterial({ color: color, roughness: 0.75 })
      );
      m.rotation.x = Math.PI / 2;
      m.position.z = z;
      m.castShadow = true;
      root.add(m);
    };
    rubber(0xc8102e, 0.0033);   // 赤（前の面＝フォア）
    rubber(0x111111, -0.0033);  // 黒（後ろの面＝バック）

    // 持ち手
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, RACKET.handleLength, 0.024),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.5 })
    );
    handle.position.y = -R - RACKET.handleLength / 2 + 0.01;
    handle.castShadow = true;
    root.add(handle);

    // 手（持ち手をにぎっている）
    const skin = new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.7 });
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), skin);
    palm.scale.set(1.15, 1.4, 0.95);
    palm.position.y = -R - 0.055;
    palm.castShadow = true;
    root.add(palm);
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), skin);
    thumb.scale.set(1, 2, 1);
    thumb.position.set(0, -R - 0.01, 0.018);
    root.add(thumb);

    return root;
  }

  setTarget(x, y) {
    this.target.x = Math.max(RACKET_AREA.minX, Math.min(RACKET_AREA.maxX, x));
    this.target.y = Math.max(RACKET_AREA.minY, Math.min(RACKET_AREA.maxY, y));
  }

  // power：0〜1
  startSwing(power) {
    if (this.swingTime >= 0) return; // スイング中は次のスイングをしない
    this.swingTime = 0;
    this.swingPower = Math.max(0.15, Math.min(1, power));
  }

  isSwinging() {
    return this.swingTime >= 0;
  }

  // 持ち手の下のはし（腕をつなぐ場所）
  handPosition() {
    return this.root.localToWorld(new THREE.Vector3(0, -RACKET.bladeRadius - 0.07, 0));
  }

  update(dt) {
    // --- なめらかに目標へ近づける ---
    const k = 1 - Math.exp(-18 * dt);
    this.local.x += (this.target.x - this.local.x) * k;
    this.local.y += (this.target.y - this.local.y) * k;

    // --- 右側ならフォア（赤）、左側ならバック（黒）に持ちかえる ---
    const wantFlip = this.local.x >= -0.05 ? 0 : Math.PI;
    this.flip += (wantFlip - this.flip) * (1 - Math.exp(-14 * dt));
    const hand = Math.cos(this.flip); // 1 = フォア, -1 = バック（途中はその間）

    // --- スイングの動き ---
    let forward = RACKET_AREA.forward - this.charge * 0.08; // ためると少し後ろに引く
    let lift = 0;
    let sweep = 0;
    if (this.swingTime >= 0) {
      const t = this.swingTime / SWING_TIME;          // 0 → 1
      const curve = Math.sin(Math.PI * t);            // 0 → 1 → 0
      forward += curve * (0.12 + 0.28 * this.swingPower); // 前に振り出す
      lift = curve * 0.06 * this.swingPower;               // 少し上へこすり上げる
      sweep = (0.5 - t) * 1.2 * this.swingPower * hand;    // 横にふり抜く
      this.swingTime += dt;
      if (this.swingTime > SWING_TIME) this.swingTime = -1;
    }

    // --- 3D空間の位置と向き ---
    const pos = playerToWorld(this.side, this.local.x, this.local.y + lift, forward);
    if (dt > 0) this.velocity.copy(pos).sub(this.worldPos).divideScalar(dt);
    this.worldPos.copy(pos);
    this.root.position.copy(pos);

    const baseYaw = this.side === 1 ? Math.PI : 0; // 面が相手の方を向くように
    this.root.rotation.y = baseYaw + this.flip + sweep;
    this.root.rotation.x = 0.25;          // 面を少し伏せる
    this.root.rotation.z = -0.5 * hand;   // 持ち手を体の方へ傾ける
    this.root.updateMatrixWorld();         // 手の位置をすぐ計算できるようにする
  }
}

// -----------------------------------------------------
//  腕（肩からラケットの手までをつなぐ）
// -----------------------------------------------------
class Arm {
  constructor(scene, color) {
    this.mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.032, 1, 12),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.7 })
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  update(shoulder, hand) {
    stretchBetween(this.mesh, shoulder, hand);
  }
}

// -----------------------------------------------------
//  相手プレイヤーの体
// -----------------------------------------------------
class Avatar {
  constructor(scene, side, shirtColor) {
    this.side = side;
    this.group = new THREE.Group();
    this.sway = 0;

    const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
    const add = (geo, material, x, y, z) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    const skin = mat(0xf1c27d);
    const shirt = mat(shirtColor);
    const shorts = mat(0x1c2233);

    // 脚・パンツ・胴体・頭（体の正面は local の +z。あとで相手の方へ向ける）
    [-0.11, 0.11].forEach(x => add(new THREE.CylinderGeometry(0.055, 0.05, 0.75, 12), skin, x, 0.4, 0));
    [-0.11, 0.11].forEach(x => add(new THREE.BoxGeometry(0.11, 0.06, 0.24), mat(0xffffff), x, 0.03, 0.04));
    add(new THREE.BoxGeometry(0.34, 0.24, 0.2), shorts, 0, 0.84, 0);
    const torso = add(new THREE.CylinderGeometry(0.19, 0.16, 0.55, 16), shirt, 0, 1.2, 0);
    torso.scale.z = 0.7;
    add(new THREE.SphereGeometry(0.11, 20, 16), skin, 0, 1.62, 0);
    const hair = add(new THREE.SphereGeometry(0.115, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2b1d14), 0, 1.64, -0.005);
    hair.rotation.x = -0.2;
    // 利き手でない方の腕（下ろしている）
    const leftArm = add(new THREE.CylinderGeometry(0.04, 0.032, 0.6, 12), shirt, 0.24, 1.15, 0.05);
    leftArm.rotation.z = 0.25;
    leftArm.rotation.x = -0.5;

    this.group.rotation.y = side === 1 ? Math.PI : 0; // 台の方を向く
    scene.add(this.group);

    this.arm = new Arm(scene, shirtColor);
  }

  // 利き手の肩の位置（3D空間）
  shoulder() {
    return playerToWorld(this.side, 0.24 + this.sway, 1.4, -0.05);
  }

  update(racket) {
    // ラケットについていくように、体を少し左右に動かす
    this.sway += (racket.local.x * 0.45 - this.sway) * 0.1;
    const base = playerToWorld(this.side, this.sway, 0, -0.1);
    this.group.position.copy(base);
    this.arm.update(this.shoulder(), racket.handPosition());
  }
}
