// =====================================================
//  obstacles.js ― 障害物（動くもの）をまとめたファイル
//
//   1. Hammer         … 回転する巨大ハンマー
//   2. Pusher         … 左右に動く壁
//   3. MovingPlatform … 動く足場
//   4. FallingTile    … 乗ると落ちる床
//   （5. 滑る坂道は world.js の addRamp で作る）
//
//  どの障害物も update(dt, player) を持っていて、毎フレーム呼ばれる
// =====================================================

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const toonMat = (color, extra) =>
  new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.5 }, extra || {}));

// -----------------------------------------------------
//  1. 回転する巨大ハンマー
//     中心の柱のまわりを、ハンマーの頭がぐるぐる回る
// -----------------------------------------------------
class Hammer {
  constructor(scene, world, center, radius, speed, headLength) {
    this.center = center.clone(); // 柱の根元（足場の上の面）
    this.radius = radius;         // 柱からハンマーの頭までの距離
    this.speed = speed;           // 回る速さ（ラジアン/秒）
    this.angle = 0;
    this.headRadius = 0.8;        // 頭の太さ
    this.headLength = headLength || 2.2; // 頭の長さ
    this.headHeight = 0.95;       // 頭の高さ（足場からの高さ）

    // 柱（ぶつかる）
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 3.6, 16), toonMat(0x7a5cff));
    pole.position.set(center.x, center.y + 1.8, center.z);
    pole.castShadow = true;
    scene.add(pole);
    world.colliders.push({
      box: new THREE.Box3(V3(center.x - 0.5, center.y, center.z - 0.5), V3(center.x + 0.5, center.y + 3.6, center.z + 0.5)),
      mesh: pole,
    });

    // 回る部分（Group ごと回転させる）
    this.group = new THREE.Group();
    this.group.position.copy(center);
    scene.add(this.group);

    // 柱の上のふた
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), toonMat(0xffe45c));
    cap.position.y = 3.7;
    this.group.add(cap);

    // 左右に2本のうでとハンマー
    [1, -1].forEach(side => {
      // 横に伸びるうで
      const arm = new THREE.Mesh(new THREE.BoxGeometry(radius, 0.35, 0.35), toonMat(0xff5fa2));
      arm.position.set(side * radius / 2, 3.4, 0);
      arm.castShadow = true;
      this.group.add(arm);
      // 下に伸びる柄
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8), toonMat(0xff5fa2));
      handle.position.set(side * radius, 2.2, 0);
      this.group.add(handle);
      // ハンマーの頭（横向きの太い円柱）
      const head = new THREE.Mesh(
        new THREE.CylinderGeometry(this.headRadius, this.headRadius, this.headLength, 20),
        toonMat(0xffd23f)
      );
      head.rotation.x = Math.PI / 2; // 回る方向に寝かせる
      head.position.set(side * radius, this.headHeight, 0);
      head.castShadow = true;
      this.group.add(head);
      // 頭の両はしの赤いふち
      [-1, 1].forEach(end => {
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(this.headRadius + 0.05, this.headRadius + 0.05, 0.25, 20),
          toonMat(0xff4d4d)
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(side * radius, this.headHeight, end * (this.headLength / 2 - 0.12));
        this.group.add(ring);
      });
    });
  }

  // CPU用：ハンマーの頭が、点 (px, pz) に来るまであと何秒か（今そこにあれば 0）
  timeUntilHit(px, pz) {
    const phi = Math.atan2(-(pz - this.center.z), px - this.center.x); // 点の角度
    const halfWidth = (this.headLength / 2 + PLAYER_CONFIG.radius + 0.3) / this.radius; // 頭の幅（角度）
    let soonest = Infinity;
    [0, Math.PI].forEach(offset => {
      const head = this.angle + offset;
      let delta = (phi - head) % (Math.PI * 2);
      if (delta < 0) delta += Math.PI * 2;
      if (delta < halfWidth || delta > Math.PI * 2 - halfWidth) soonest = 0; // 今まさに通過中
      else soonest = Math.min(soonest, (delta - halfWidth) / Math.abs(this.speed));
    });
    return soonest;
  }

  // raceTime：レース開始からの時間（オンラインでは全員同じ。あれば、それで角度を決める）
  update(dt, racers, raceTime) {
    if (raceTime !== undefined) this.angle = this.speed * raceTime;
    else this.angle += this.speed * dt;
    this.group.rotation.y = this.angle;
    for (const racer of racers) this.hitTest(racer);
  }

  // --- ハンマーの頭とキャラがぶつかったか調べる ---
  hitTest(player) {
    const playerCenter = V3(player.position.x, player.position.y + 0.75, player.position.z);
    [1, -1].forEach(side => {
      // 頭の中心（回転を計算して求める）
      const cos = Math.cos(this.angle);
      const sin = Math.sin(this.angle);
      const head = V3(
        this.center.x + side * this.radius * cos,
        this.center.y + this.headHeight,
        this.center.z - side * this.radius * sin
      );
      // 頭が動いている向き（回転の接線方向）
      const tangent = V3(-side * sin, 0, -side * cos).multiplyScalar(Math.sign(this.speed));

      // 頭（円柱）のいちばん近い点との距離
      const diff = playerCenter.clone().sub(head);
      const along = Math.max(-this.headLength / 2, Math.min(this.headLength / 2, diff.dot(tangent)));
      const closest = head.clone().addScaledVector(tangent, along);
      const dist = playerCenter.distanceTo(closest);

      if (dist < this.headRadius + PLAYER_CONFIG.radius + 0.1) {
        // ハンマーが動く向き＋外側へ、大きくはじき飛ばす
        const outward = V3(head.x - this.center.x, 0, head.z - this.center.z).normalize();
        const push = tangent.clone().multiplyScalar(13).addScaledVector(outward, 4);
        player.knockback(push.x, 7, push.z);
      }
    });
  }
}

// -----------------------------------------------------
//  2. 左右に動く壁（ぶつかるとはじき飛ばされる）
// -----------------------------------------------------
class Pusher {
  constructor(scene, world, x, topY, z, range, speed, phase, width) {
    this.baseX = x;
    this.range = range;  // 左右に動く幅（片側）
    this.speed = speed;
    this.phase = phase;  // 動き出すタイミングをずらす
    this.time = phase;
    this.w = width || 2.2;
    this.h = 1.8;
    this.d = 1.2;
    this.y = topY;
    this.z = z;

    this.mesh = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(this.w, this.h, this.d), toonMat(0xff5f6d));
    block.castShadow = true;
    this.mesh.add(block);
    // 白いしま模様
    for (let i = -Math.floor(this.w / 1.4); i <= Math.floor(this.w / 1.4); i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, this.h + 0.02, this.d + 0.02), toonMat(0xffffff));
      stripe.position.x = i * 0.7;
      this.mesh.add(stripe);
    }
    scene.add(this.mesh);

    this.collider = {
      box: new THREE.Box3(),
      mesh: this.mesh,
      pusher: true,                    // 「押す壁」の印
      velocity: new THREE.Vector3(),   // 動いている速さ（はじき飛ばす向きに使う）
      delta: new THREE.Vector3(),      // 1フレームで動いた量（上に乗ったとき用）
    };
    world.colliders.push(this.collider);
    this.place(0);
  }

  // 現在の位置に見た目と当たり判定を合わせる
  place(dt) {
    const oldX = this.mesh.position.x;
    const x = this.baseX + Math.sin(this.time * this.speed) * this.range;
    this.mesh.position.set(x, this.y + this.h / 2, this.z);
    this.collider.box.set(
      V3(x - this.w / 2, this.y, this.z - this.d / 2),
      V3(x + this.w / 2, this.y + this.h, this.z + this.d / 2)
    );
    this.collider.delta.set(dt > 0 ? x - oldX : 0, 0, 0);
    this.collider.velocity.set(dt > 0 ? (x - oldX) / dt : 0, 0, 0);
  }

  update(dt, racers, raceTime) {
    this.time = raceTime !== undefined ? this.phase + raceTime : this.time + dt;
    this.place(dt);
  }

  // CPU用：t 秒後の壁の横位置
  xAt(t) {
    return this.baseX + Math.sin((this.time + t) * this.speed) * this.range;
  }
}

// -----------------------------------------------------
//  3. 動く足場（2つの地点の間を行ったり来たり）
// -----------------------------------------------------
class MovingPlatform {
  constructor(scene, world, from, to, size, speed, color) {
    this.from = from.clone();
    this.to = to.clone();
    this.size = size;
    this.speed = speed;
    this.time = 0;
    this.thick = 0.8;

    this.mesh = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(size, this.thick, size), toonMat(color));
    base.position.y = -this.thick / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.04, 0.14, size + 0.04),
      toonMat(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.4))
    );
    top.position.y = -0.065;
    top.receiveShadow = true;
    this.mesh.add(base, top);
    scene.add(this.mesh);

    this.collider = { box: new THREE.Box3(), mesh: this.mesh, delta: new THREE.Vector3() };
    world.colliders.push(this.collider);
    this.mesh.position.copy(from);
    this.place();
  }

  place() {
    const p = this.mesh.position;
    const s = this.size / 2;
    this.collider.box.set(V3(p.x - s, p.y - this.thick, p.z - s), V3(p.x + s, p.y, p.z + s));
  }

  // t 秒後の位置（0 → 1 → 0 となめらかに往復する。端でゆっくりになる）
  positionAt(t) {
    const k = 0.5 - 0.5 * Math.cos((this.time + t) * this.speed);
    return this.from.clone().lerp(this.to, k);
  }

  update(dt, racers, raceTime) {
    this.time = raceTime !== undefined ? raceTime : this.time + dt;
    const newPos = this.positionAt(0);
    this.collider.delta.copy(newPos).sub(this.mesh.position); // 動いた量
    this.mesh.position.copy(newPos);
    this.place();
  }
}

// -----------------------------------------------------
//  4. 乗ると落ちる床
//     乗る → ガタガタ揺れる → 落ちる → しばらくすると元に戻る
// -----------------------------------------------------
class FallingTile {
  constructor(scene, world, x, topY, z, size) {
    this.id = Obstacles.tiles.length; // オンラインで「どの床か」を伝えるための番号
    Obstacles.tiles.push(this);
    this.home = V3(x, topY, z);
    this.size = size;
    this.thick = 0.6;
    this.state = "idle"; // idle（ふつう）/ shaking（揺れ中）/ falling（落下中）
    this.timer = 0;
    this.fallSpeed = 0;

    this.color = new THREE.Color(0x8fe3ff);
    this.warnColor = new THREE.Color(0xff6f91);
    this.material = toonMat(this.color.clone());
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(size, this.thick, size), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this.collider = {
      box: new THREE.Box3(),
      mesh: this.mesh,
      onStand: racer => this.trigger(racer), // キャラが乗ったら呼ばれる
    };
    world.colliders.push(this.collider);
    this.reset();
  }

  reset() {
    this.state = "idle";
    this.timer = 0;
    this.fallSpeed = 0;
    this.mesh.position.set(this.home.x, this.home.y - this.thick / 2, this.home.z);
    this.mesh.visible = true;
    this.material.color.copy(this.color);
    this.collider.disabled = false;
    const s = this.size / 2;
    this.collider.box.set(
      V3(this.home.x - s, this.home.y - this.thick, this.home.z - s),
      V3(this.home.x + s, this.home.y, this.home.z + s)
    );
  }

  trigger(racer) {
    if (this.state !== "idle") return;
    this.state = "shaking";
    this.timer = 0.6; // 0.6秒後に落ちる
    this.heardByHuman = racer.isHuman;
    if (this.heardByHuman) Sound.shake();
    // 自分が乗って落ち始めたら、オンラインのほかの人にも知らせる
    if (racer.isHuman && racer.isLocal !== false && Obstacles.onTileTrigger) Obstacles.onTileTrigger(this.id);
  }

  update(dt) {
    if (this.state === "shaking") {
      this.timer -= dt;
      // ガタガタ揺らして、だんだん赤くする
      const shake = 0.06;
      this.mesh.position.x = this.home.x + (Math.random() - 0.5) * shake;
      this.mesh.position.z = this.home.z + (Math.random() - 0.5) * shake;
      this.material.color.copy(this.color).lerp(this.warnColor, 1 - this.timer / 0.6);
      if (this.timer <= 0) {
        this.state = "falling";
        this.timer = 3; // 3秒後に元に戻る
        this.collider.disabled = true; // もう乗れない
        if (this.heardByHuman) Sound.crumble();
      }
    } else if (this.state === "falling") {
      this.timer -= dt;
      this.fallSpeed += 20 * dt;
      this.mesh.position.y -= this.fallSpeed * dt;
      if (this.timer <= 0) this.reset();
    }
  }
}

// -----------------------------------------------------
//  障害物をまとめて動かす
//  （どこに置くかは course.js で決める）
// -----------------------------------------------------
const Obstacles = {
  items: [],
  tiles: [],            // 落ちる床（番号順）
  onTileTrigger: null,  // 自分が床を落としたときに呼ぶ関数（オンライン用）

  add(item) {
    this.items.push(item);
    return item;
  },

  // racers：自分とCPUのリスト（ハンマーの当たり判定に使う）
  //  raceTime：オンラインでは、レース開始からの時間を渡すと全員の障害物の動きがそろう
  update(dt, racers, raceTime) {
    for (const item of this.items) item.update(dt, racers, raceTime);
  },
};
