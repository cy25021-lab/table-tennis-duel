// =====================================================
//  course.js ― スタートからゴールまでのコースを作る
//
//  コースは奥（z がマイナスの方向）へ進んでいく。
//  チェックポイントを通るたびに、後半ほど難しくなる。
//
//   スタート
//    ├ ① 準備運動の足場ジャンプ
//    ├ ② ゆっくり回るハンマー
//   CP1
//    ├ ③ 動く足場
//    ├ ④ 動く壁の橋
//   CP2
//    ├ ⑤ 落ちる床
//    ├ ⑥ 滑る坂道 → 速いハンマー
//   CP3
//    ├ ⑦ 小さな動く足場・落ちる床の一本道・エレベーター
//   ゴール
// =====================================================

// 文字を書いた板を作る（看板・旗に使う）
function makeLabel(text, bgColor, textColor, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  g.fillStyle = bgColor;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = textColor;
  g.font = 'bold 76px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 68);
  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture })
  );
}

// -----------------------------------------------------
//  アーチ（スタート・チェックポイント・ゴールの門）
// -----------------------------------------------------
class Arch {
  constructor(scene, world, x, groundY, z, width, color, label) {
    this.group = new THREE.Group();
    this.group.position.set(x, groundY, z);
    scene.add(this.group);
    this.material = new THREE.MeshStandardMaterial({ color: color, roughness: 0.4 });

    const postH = 4.4;
    [-1, 1].forEach(side => {
      // 柱
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, postH, 14), this.material);
      post.position.set(side * width / 2, postH / 2, 0);
      post.castShadow = true;
      this.group.add(post);
      // 柱の上の玉
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), this.material);
      ball.position.set(side * width / 2, postH + 0.3, 0);
      this.group.add(ball);
      // 柱はぶつかる
      const px = x + side * width / 2;
      world.colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(px - 0.4, groundY, z - 0.4),
          new THREE.Vector3(px + 0.4, groundY + postH, z + 0.4)
        ),
        mesh: post,
      });
    });

    // 上の横棒
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width, 0.4, 0.5), this.material);
    beam.position.y = postH - 0.2;
    this.group.add(beam);

    // 看板（表と裏の2枚）
    if (label) this.setLabel(label);
  }

  setLabel(label) {
    if (this.labels) this.labels.forEach(l => this.group.remove(l));
    this.labels = [0, Math.PI].map(rot => {
      const l = label();
      l.position.set(0, 3.2, 0);
      l.rotation.y = rot;
      l.translateZ(0.3);
      this.group.add(l);
      return l;
    });
  }
}

// -----------------------------------------------------
//  チェックポイント
// -----------------------------------------------------
class Checkpoint {
  constructor(scene, world, number, x, groundY, z, width) {
    this.number = number;
    this.spawn = new THREE.Vector3(x, groundY, z - 1.5); // 復活する場所
    this.active = false;
    this.x = x;
    this.y = groundY;
    this.z = z;
    this.width = width;

    this.arch = new Arch(scene, world, x, groundY, z, width, 0xc8c8d8,
      () => makeLabel("CHECKPOINT " + number, "#9a9ab0", "#ffffff", 4.4, 1.1));

    // 地面の光る輪
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.6, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(x, groundY + 0.03, z - 1.5);
    scene.add(this.ring);
  }

  // プレイヤーが門をくぐったか
  isPassedBy(player) {
    const p = player.position;
    return Math.abs(p.x - this.x) < this.width / 2 + 1 &&
           p.z < this.z && p.z > this.z - 3 &&
           p.y > this.y - 1 && p.y < this.y + 5;
  }

  activate() {
    this.active = true;
    this.arch.material.color.set(0x3ddc84);
    this.arch.setLabel(() => makeLabel("CHECKPOINT " + this.number, "#3ddc84", "#ffffff", 4.4, 1.1));
    this.ring.material.color.set(0x3ddc84);
  }

  reset() {
    this.active = false;
    this.arch.material.color.set(0xc8c8d8);
    this.arch.setLabel(() => makeLabel("CHECKPOINT " + this.number, "#9a9ab0", "#ffffff", 4.4, 1.1));
    this.ring.material.color.set(0xffffff);
  }

  update(dt) {
    this.ring.rotation.z += dt * (this.active ? 2 : 0.5);
  }
}

// -----------------------------------------------------
//  コース全体
// -----------------------------------------------------
const Course = {
  startPoint: new THREE.Vector3(0, 0, 5),
  checkpoints: [],
  goal: null,
  onCheckpoint: null, // チェックポイントを通ったときに呼ぶ関数（main.js で設定）
  onGoal: null,       // ゴールしたときに呼ぶ関数

  build(scene, world) {
    const W = world;
    const O = Obstacles;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    // ===== スタート =====
    W.addIsland(scene, 0, 0, 0, 16, 16, 0x7ed957);
    new Arch(scene, W, 0, 0, -6, 8, 0xff5fa2, () => makeLabel("START", "#ff5fa2", "#ffffff", 5, 1.25));
    W.addTree(scene, -6, 0, 5);
    W.addTree(scene, 6, 0, 3);

    // ===== ① 準備運動：足場ジャンプ =====
    W.addBlock(scene, 0, 0, -11, 4, 1, 4, 0xff7aa8);
    W.addBlock(scene, -2, 0.8, -16, 4, 1, 4, 0xffd23f);
    W.addBlock(scene, 2, 1.6, -21, 4, 1, 4, 0x5ccfe6);
    W.addBlock(scene, 0, 2.4, -26, 4, 1, 4, 0xb48cff);

    // ===== ② ゆっくり回るハンマー =====
    W.addBlock(scene, 0, 2.4, -37, 12, 1.2, 14, 0xffd23f);
    const hammer1 = O.add(new Hammer(scene, W, V(0, 2.4, -37), 4.5, 1.0));

    // ===== CP1 =====
    W.addIsland(scene, 0, 2.4, -50, 12, 10, 0x7ed957);
    this.addCheckpoint(scene, W, 1, 0, 2.4, -47, 7);

    // ===== ③ 動く足場 =====
    const plat1 = O.add(new MovingPlatform(scene, W, V(-3.5, 2.4, -59.25), V(3.5, 2.4, -59.25), 3.5, 0.9, 0x5ccfe6));
    const plat2 = O.add(new MovingPlatform(scene, W, V(3.5, 2.4, -65), V(-3.5, 2.4, -65), 3.5, 1.0, 0xb48cff));
    const plat3 = O.add(new MovingPlatform(scene, W, V(-3.5, 2.4, -70.75), V(3.5, 2.4, -70.75), 3.5, 1.1, 0xff7aa8));
    W.addBlock(scene, 0, 2.4, -77, 8, 1.2, 8, 0xffa94d);

    // ===== ④ 動く壁の橋 =====
    W.addBlock(scene, 0, 2.4, -92, 6, 1, 20, 0xffd23f);
    const pusher1 = O.add(new Pusher(scene, W, 0, 2.4, -86, 2.4, 1.8, 0));
    const pusher2 = O.add(new Pusher(scene, W, 0, 2.4, -91, 2.4, 1.8, 1.2));
    const pusher3 = O.add(new Pusher(scene, W, 0, 2.4, -96, 2.4, 1.8, 2.4));

    // ===== CP2 =====
    W.addIsland(scene, 0, 2.4, -110, 12, 12, 0x7ed957);
    this.addCheckpoint(scene, W, 2, 0, 2.4, -106, 7);
    W.addTree(scene, -4.5, 2.4, -113);

    // ===== ⑤ 落ちる床（4列 × 5行） =====
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 4; col++) {
        O.add(new FallingTile(scene, W, -3.75 + col * 2.5, 2.4, -118.3 - row * 2.5, 2.4));
      }
    }
    W.addBlock(scene, 0, 2.4, -134, 8, 1.2, 8, 0xffa94d);

    // ===== ⑥ 滑る坂道 → 速いハンマー =====
    W.addRamp(scene, 0, 7, -138, 2.4, -158, -4, 16, 0x9be7ff);
    W.addBlock(scene, 0, -4, -167, 14, 1.2, 18, 0xff7aa8);
    const hammer2 = O.add(new Hammer(scene, W, V(0, -4, -167), 5, 1.8));

    // ===== CP3 =====
    W.addIsland(scene, 0, -4, -184, 12, 12, 0x7ed957);
    this.addCheckpoint(scene, W, 3, 0, -4, -180, 7);

    // ===== ⑦ ラストスパート =====
    // 小さな動く足場
    const plat4 = O.add(new MovingPlatform(scene, W, V(-3, -3, -194), V(3, -3, -194), 3, 1.3, 0x5ccfe6));
    // 落ちる床の一本道
    for (let i = 0; i < 3; i++) {
      O.add(new FallingTile(scene, W, 0, -2, -199 - i * 2.5, 2.4));
    }
    // 上下に動くエレベーター
    const elevator = O.add(new MovingPlatform(scene, W, V(0, -2, -209), V(0, 4, -209), 3.5, 0.9, 0xb48cff));

    // ===== ゴール =====
    W.addIsland(scene, 0, 4, -219, 16, 14, 0xffd23f);
    this.goalArch = new Arch(scene, W, 0, 4, -219, 9, 0xff5fa2, () => makeLabel("GOAL", "#ffe45c", "#ff5fa2", 5, 1.25));
    this.goal = { x: 0, y: 4, z: -219, width: 9 };
    W.addTree(scene, -6, 4, -224);
    W.addTree(scene, 6, 4, -224);

    // ===== CPU用の道しるべ =====
    this.buildWaypoints({ hammer1, hammer2, plat1, plat2, plat3, plat4, elevator, pusher1, pusher2, pusher3 });
  },

  // -----------------------------------------------------
  //  CPU が順番にめざす「道しるべ」
  //   x, z      … めざす場所
  //   lane      … true ならCPUごとに少し横にずれて走る
  //   careful   … true ならダッシュしない（小さな足場に跳び乗るとき）
  //   follow    … 動く足場の上の点（足場と一緒に動く）
  //   waitUntil … ここで止まって、この条件が true になるまで待つ
  //   radius    … どれくらい近づいたら「着いた」とみなすか
  //   margin    … 少し通り過ぎても、まだこの道しるべを使う距離
  // -----------------------------------------------------
  buildWaypoints(o) {
    const wp = (x, z, opts) => Object.assign({ x: x, z: z, radius: 0.8, margin: 0.6 }, opts || {});
    const onPlatform = (plat, opts) => Object.assign(wp(0, plat.from.z), { follow: plat }, opts || {});
    const pusherClear = p => () => [0, 0.2, 0.4, 0.6].every(t => Math.abs(p.xAt(t)) > 1.75);

    this.waypoints = [
      // スタート → 準備運動
      wp(0, -7, { lane: true }),
      wp(0, -11, { lane: true }),
      wp(-2, -16, { lane: true }),
      wp(2, -21, { lane: true }),
      wp(0, -26, { lane: true }),
      // ハンマー①：輪の外で待つ → 柱の近く（安全地帯）→ 出口で待つ → 抜ける
      wp(0, -31, { waitUntil: () => o.hammer1.timeUntilHit(0.6, -32.6) > 0.8 }),
      wp(1.3, -34.4),
      wp(1.3, -39.6, { waitUntil: () => o.hammer1.timeUntilHit(0.6, -41.6) > 0.8, radius: 0.6 }),
      wp(0, -43.2),
      // CP1 → 動く足場（足場が来るタイミングを予想して跳ぶ）
      wp(0, -48, { lane: true }),
      wp(0, -52.5, { waitUntil: () => Math.abs(o.plat1.positionAt(1.1).x) < 0.7 }),
      onPlatform(o.plat1, { careful: true, radius: 1.2,
        waitUntil: () => Math.abs(o.plat2.positionAt(0.9).x - o.plat1.positionAt(0.9).x) < 0.8 }),
      onPlatform(o.plat2, { careful: true, radius: 1.2,
        waitUntil: () => Math.abs(o.plat3.positionAt(0.9).x - o.plat2.positionAt(0.9).x) < 0.8 }),
      onPlatform(o.plat3, { careful: true, margin: -0.3 }),
      wp(0, -77),
      // 動く壁：壁が離れているときに通る
      wp(0, -83, { waitUntil: pusherClear(o.pusher1) }),
      wp(0, -88.5, { waitUntil: pusherClear(o.pusher2) }),
      wp(0, -93.5, { waitUntil: pusherClear(o.pusher3) }),
      wp(0, -100),
      // CP2 → 落ちる床（止まらず走り抜ける）
      wp(0, -110, { lane: true }),
      wp(0, -117, { lane: true }),
      wp(0, -130, { lane: true }),
      // 滑る坂 → ハンマー②
      wp(0, -137),
      wp(0, -160, { radius: 3, margin: 3, waitUntil: () => o.hammer2.timeUntilHit(0.6, -162.2) > 0.7 }),
      wp(1.3, -164.4),
      wp(1.3, -169.6, { waitUntil: () => o.hammer2.timeUntilHit(0.6, -171.8) > 0.7, radius: 0.6 }),
      wp(0, -174),
      // CP3 → ラストスパート
      wp(0, -182, { lane: true }),
      wp(0, -188, { waitUntil: () => Math.abs(o.plat4.positionAt(1.0).x) < 0.6 }),
      onPlatform(o.plat4, { careful: true, radius: 1.0,
        waitUntil: () => Math.abs(o.plat4.positionAt(0.4).x) < 0.5 && o.elevator.positionAt(2.0).y < -0.9 }),
      wp(0, -199, { careful: true, margin: -0.3 }),
      wp(0, -201.5, { careful: true, margin: -0.3 }),
      wp(0, -204, { careful: true, margin: -0.3 }),
      onPlatform(o.elevator, { careful: true, radius: 1.2, waitUntil: () => o.elevator.positionAt(0).y > 3.6 }),
      wp(0, -214),
      wp(0, -223, { lane: true }),
    ];
  },

  addCheckpoint(scene, world, number, x, y, z, width) {
    this.checkpoints.push(new Checkpoint(scene, world, number, x, y, z, width));
  },

  // 毎フレーム：みんながチェックポイントとゴールを通ったか調べる
  //   racers … 自分とCPUのリスト（スタート前は空）
  update(dt, racers) {
    for (const cp of this.checkpoints) cp.update(dt);

    for (const racer of racers) {
      for (const cp of this.checkpoints) {
        if (racer.cpIndex >= cp.number || !cp.isPassedBy(racer)) continue;
        racer.cpIndex = cp.number;
        racer.spawnPoint.copy(cp.spawn);             // 落ちたらここから再開
        racer.spawnPoint.x += racer.startOffset.x * 0.6; // 重ならないように少しずらす
        if (racer.isHuman) {
          cp.activate(); // 門の色が変わるのは自分が通ったときだけ
          Sound.checkpoint();
          if (this.onCheckpoint) this.onCheckpoint(cp);
        }
      }

      const p = racer.position;
      const g = this.goal;
      if (!racer.finished && Math.abs(p.x - g.x) < g.width / 2 + 1 && p.z < g.z && p.y > g.y - 1) {
        racer.finished = true;
        if (racer.isHuman) Sound.goal();
        if (this.onGoal) this.onGoal(racer);
      }
    }
  },

  // R キー：最初からやり直す
  restart(racers) {
    this.checkpoints.forEach(cp => cp.reset());
    Obstacles.items.forEach(item => { if (item.reset) item.reset(); });
    for (const racer of racers) {
      racer.cpIndex = 0;
      racer.finished = false;
      racer.finishTime = 0;
      racer.spawnPoint.copy(this.startPoint).add(racer.startOffset); // スタート位置は横に並べる
      racer.respawn(racer.isHuman);
    }
  },
};
