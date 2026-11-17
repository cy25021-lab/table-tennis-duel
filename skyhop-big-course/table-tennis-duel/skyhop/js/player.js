// =====================================================
//  player.js ― キャラクター「ホッピー」の見た目と動き
// =====================================================

// 動きの数値（ここを変えると操作の感じが変わる）
const PLAYER_CONFIG = {
  radius: 0.45,        // 当たり判定の半径
  height: 1.5,         // 当たり判定の高さ
  walkSpeed: 6,        // 歩く速さ（m/秒）
  dashSpeed: 10,       // ダッシュの速さ
  groundAccel: 60,     // 地面での加速の強さ
  airAccel: 22,        // 空中での加速の強さ（小さいと空中で曲がりにくい）
  jumpPower: 10,       // ジャンプの強さ
  gravity: 28,         // 重力
  fallGravityScale: 1.6, // 落ちるときは重力を強くして、キビキビ動かす
  maxFallSpeed: 30,    // 落ちる速さの上限
  coyoteTime: 0.1,     // 足場から落ちた直後でもジャンプできる時間（秒）
  jumpBufferTime: 0.12, // 着地の少し前に押したジャンプを覚えておく時間（秒）
  fallLimitY: -30,     // これより下に落ちたらリスポーン
};

// 角度 a を b に向けてなめらかに回す（ぐるっと遠回りしないように）
function dampAngle(a, b, speed, dt) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * (1 - Math.exp(-speed * dt));
}

// 値 a を b に向けてなめらかに近づける
function damp(a, b, speed, dt) {
  return a + (b - a) * (1 - Math.exp(-speed * dt));
}

// 人が操作するときの入力（キーボード）を「コントロール」の形にまとめる
// CPU は bots.js で同じ形のコントロールを作る
function getHumanControls(cameraYaw) {
  let inputX = 0;
  let inputZ = 0;
  // WASD でも矢印キーでも動かせる
  if (Input.isDown("KeyW") || Input.isDown("ArrowUp")) inputZ -= 1;
  if (Input.isDown("KeyS") || Input.isDown("ArrowDown")) inputZ += 1;
  if (Input.isDown("KeyA") || Input.isDown("ArrowLeft")) inputX -= 1;
  if (Input.isDown("KeyD") || Input.isDown("ArrowRight")) inputX += 1;

  // カメラの向きを基準にした方向へ変える
  const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  const right = new THREE.Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
  const move = new THREE.Vector3()
    .addScaledVector(forward, -inputZ)
    .addScaledVector(right, inputX);
  if (move.lengthSq() > 0) move.normalize();

  return {
    move: move,                                   // 進みたい方向（長さ 0〜1）
    jumpPressed: Input.wasPressed("Space"),       // ジャンプを押した瞬間
    jumpHeld: Input.isDown("Space"),              // ジャンプを押し続けている
    dash: Input.isDown("ShiftLeft") || Input.isDown("ShiftRight"),
  };
}

// 名前の札（頭の上に出す）
function makeNameTag(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  g.fillStyle = "rgba(40, 40, 90, 0.55)";
  g.fillRect(28, 6, 200, 52);
  g.fillStyle = color;
  g.font = 'bold 36px "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

class Player {
  // options: { name, bodyColor, limbColor, isHuman, speedScale }
  constructor(scene, spawnPoint, options) {
    options = options || {};
    this.scene = scene;
    this.spawnPoint = spawnPoint.clone();
    this.name = options.name || "YOU";
    this.isHuman = options.isHuman !== false;
    this.bodyColor = options.bodyColor || 0xff8a3d;
    this.limbColor = options.limbColor || 0x2ec4b6;
    this.speedScale = options.speedScale || 1; // 足の速さの倍率（CPUの個性）

    // レースの記録
    this.cpIndex = 0;       // 通ったチェックポイントの番号
    this.finished = false;  // ゴールしたか
    this.finishTime = 0;

    this.position = new THREE.Vector3(); // 足もとの位置
    this.velocity = new THREE.Vector3(); // 速度
    this.grounded = false;               // 地面に立っているか
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.facing = Math.PI;               // 向いている方向（最初は奥向き）
    this.walkPhase = 0;                  // 歩きアニメーションの進み具合
    this.squash = 1;                     // つぶれ具合（1 = ふつう）
    this.squashVelocity = 0;
    this.wasDashing = false;
    this.frozen = false;                 // true の間は動けない（カウントダウン中など）
    this.onFall = null;                  // 落ちたときに呼ぶ関数

    this.mesh = this.createModel();
    const tag = makeNameTag(this.name, this.isHuman ? "#ffe45c" : "#ffffff");
    tag.position.y = 2.3;
    this.mesh.add(tag);
    scene.add(this.mesh);
    this.shadow = this.createBlobShadow();
    scene.add(this.shadow);
    this.dust = this.createDustPool();

    this.respawn(false);
  }

  // ===== 見た目（丸い体・大きな目・頭のアンテナ） =====
  createModel() {
    const root = new THREE.Group(); // 全体（足もとが原点、向きをここで回す）
    const body = new THREE.Group(); // つぶれたり傾いたりする部分
    root.add(body);
    this.body = body;

    const mat = color => new THREE.MeshStandardMaterial({ color: color, roughness: 0.45 });
    const add = (parent, geometry, material, x, y, z) => {
      const m = new THREE.Mesh(geometry, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // 胴体（オレンジの丸）
    const torso = add(body, new THREE.SphereGeometry(0.55, 28, 20), mat(this.bodyColor), 0, 0.8, 0);
    torso.scale.set(1, 1.05, 0.95);
    // おなか
    const belly = add(body, new THREE.SphereGeometry(0.4, 24, 16), mat(0xfff1d6), 0, 0.68, 0.27);
    belly.scale.set(1, 1, 0.5);
    // 目（白目と黒目）
    const white = mat(0xffffff);
    const black = mat(0x22223a);
    [-0.2, 0.2].forEach(x => {
      add(body, new THREE.SphereGeometry(0.13, 16, 12), white, x, 1.0, 0.44);
      add(body, new THREE.SphereGeometry(0.07, 12, 10), black, x, 1.0, 0.56);
    });
    // ほっぺ
    const cheek = mat(0xff6f91);
    [-0.36, 0.36].forEach(x => {
      const c = add(body, new THREE.SphereGeometry(0.08, 12, 8), cheek, x, 0.84, 0.4);
      c.scale.set(1, 0.6, 0.4);
    });
    // 頭のアンテナ
    add(body, new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), mat(0x22223a), 0, 1.5, 0);
    this.antennaBall = add(body, new THREE.SphereGeometry(0.11, 16, 12), mat(0xffe45c), 0, 1.72, 0);

    // 腕（肩を中心に回せるように Group に入れる）
    const teal = mat(this.limbColor);
    this.armL = new THREE.Group();
    this.armL.position.set(0.5, 0.95, 0);
    add(this.armL, new THREE.SphereGeometry(0.14, 14, 10), teal, 0, -0.2, 0);
    body.add(this.armL);
    this.armR = new THREE.Group();
    this.armR.position.set(-0.5, 0.95, 0);
    add(this.armR, new THREE.SphereGeometry(0.14, 14, 10), teal, 0, -0.2, 0);
    body.add(this.armR);

    // 足
    this.footL = add(root, new THREE.SphereGeometry(0.16, 14, 10), teal, 0.22, 0.12, 0.05);
    this.footL.scale.set(1, 0.65, 1.4);
    this.footR = add(root, new THREE.SphereGeometry(0.16, 14, 10), teal, -0.22, 0.12, 0.05);
    this.footR.scale.set(1, 0.65, 1.4);

    return root;
  }

  // 真下に落ちる丸い影（ジャンプの着地点が分かりやすくなる）
  createBlobShadow() {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    return shadow;
  }

  // 着地やジャンプで出る土ぼこり（使い回すために先に作っておく）
  createDustPool() {
    const pool = [];
    for (let i = 0; i < 24; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
      );
      puff.visible = false;
      puff.userData = { life: 0, velocity: new THREE.Vector3() };
      this.scene.add(puff);
      pool.push(puff);
    }
    return pool;
  }

  spawnDust(count, power) {
    let made = 0;
    for (const puff of this.dust) {
      if (made >= count) break;
      if (puff.userData.life > 0) continue;
      const angle = Math.random() * Math.PI * 2;
      puff.position.set(
        this.position.x + Math.cos(angle) * 0.3,
        this.position.y + 0.1,
        this.position.z + Math.sin(angle) * 0.3
      );
      puff.userData.velocity.set(Math.cos(angle) * power, 0.8 + Math.random(), Math.sin(angle) * power);
      puff.userData.life = 0.45;
      puff.visible = true;
      made++;
    }
  }

  // ===== スタート地点（またはチェックポイント）に戻す =====
  respawn(playSound) {
    this.position.copy(this.spawnPoint);
    this.velocity.set(0, 0, 0);
    this.facing = Math.PI;
    this.mesh.rotation.y = this.facing;
    this.mesh.position.copy(this.position);
    this.squash = 0.6; // ポンッと出てくる演出
    this.stunTimer = 0;
    this.groundCollider = null;
    this.onRamp = null;
    if (playSound) this.sfx("respawn");
  }

  // 効果音は自分のキャラのときだけ鳴らす（CPUの音まで鳴るとうるさいので）
  sfx(name) {
    if (this.isHuman) Sound[name]();
  }

  // ===== オンラインのほかの人：届いた位置どおりに表示する（動きの計算はしない） =====
  applyRemote(pos, vel, facing, grounded, stunned, dt, colliders, ramps) {
    this.position.copy(pos);
    this.velocity.copy(vel);
    this.grounded = grounded;
    this.facing = facing;
    this.stunTimer = stunned ? 0.1 : 0;
    this.animate(dt);
    this.updateShadow(colliders, ramps);
    this.updateDust(dt);
  }

  setVisible(visible) {
    this.mesh.visible = visible;
    this.shadow.visible = visible;
  }

  // ===== 障害物にはじき飛ばされる =====
  knockback(vx, vy, vz) {
    if (this.stunTimer > 0) return; // 飛ばされている最中は重ねて飛ばされない
    this.velocity.set(vx, vy, vz);
    this.stunTimer = 0.5;           // この間は操作がききにくい
    this.coyoteTimer = 0;
    this.squash = 0.7;
    this.sfx("bonk");
    this.spawnDust(6, 3);
  }

  // ===== 毎フレームの更新 =====
  // controls：getHumanControls() または CPU が作った入力
  update(dt, controls, colliders, ramps) {
    const C = PLAYER_CONFIG;
    const v = this.velocity;

    // --- 0. 動く足場に乗っていたら、足場と一緒に動く ---
    if (this.grounded && this.groundCollider && this.groundCollider.delta) {
      this.position.add(this.groundCollider.delta);
    }
    this.stunTimer -= dt;
    const stunned = this.stunTimer > 0;

    // --- 1. 進みたい方向 ---
    const move = controls.move.clone();
    if (stunned || this.frozen) move.set(0, 0, 0); // 飛ばされている間・カウントダウン中は操作できない

    const dashing = controls.dash && move.lengthSq() > 0;
    const targetSpeed = (dashing ? C.dashSpeed : C.walkSpeed) * this.speedScale;

    // ダッシュを始めた瞬間の音と演出
    if (dashing && !this.wasDashing && this.grounded) {
      this.sfx("dash");
      this.spawnDust(5, 2);
    }
    this.wasDashing = dashing;

    // --- 2. 横方向の速度を、目標の速度へ少しずつ近づける ---
    let accel = this.grounded ? C.groundAccel : C.airAccel;
    if (this.onRamp) accel *= 0.15; // 滑る坂の上はツルツル（止まりにくい・曲がりにくい）
    if (stunned) accel = 2;

    // 滑る坂の上にいると、坂の下へ引っぱられる
    if (this.onRamp) v.z += this.onRamp.downhillZ * this.onRamp.slide * dt;

    const diffX = move.x * targetSpeed - v.x;
    const diffZ = move.z * targetSpeed - v.z;
    const diffLen = Math.hypot(diffX, diffZ);
    const maxStep = accel * dt;
    if (diffLen > maxStep) {
      v.x += (diffX / diffLen) * maxStep;
      v.z += (diffZ / diffLen) * maxStep;
    } else {
      v.x += diffX;
      v.z += diffZ;
    }
    if (move.lengthSq() > 0) this.facing = Math.atan2(move.x, move.z);
    if (stunned) this.facing += dt * 18; // 飛ばされている間はくるくる回る

    // --- 3. ジャンプ ---
    if (controls.jumpPressed) this.jumpBufferTimer = C.jumpBufferTime;
    else this.jumpBufferTimer -= dt;
    this.coyoteTimer = this.grounded ? C.coyoteTime : this.coyoteTimer - dt;

    if (!this.frozen && this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      v.y = C.jumpPower;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.squash = 1.35; // 縦にのびる
      this.sfx("jump");
      this.spawnDust(6, 1.5);
    }

    // --- 4. 重力（落ちるとき・Spaceを離したときは強め → 小ジャンプができる） ---
    const strongGravity = v.y < 0 || !controls.jumpHeld;
    v.y -= C.gravity * (strongGravity ? C.fallGravityScale : 1) * dt;
    v.y = Math.max(v.y, -C.maxFallSpeed);

    // --- 5. 移動とぶつかり判定（すり抜けないように3回に分けて動かす） ---
    const fallSpeed = v.y;
    const wasGrounded = this.grounded;
    this.grounded = false;
    this.groundCollider = null;
    this.nextRamp = null;
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      this.position.addScaledVector(v, dt / steps);
      if (this.resolveCollisions(colliders)) this.grounded = true;
      if (this.resolveRamps(ramps)) this.grounded = true;
    }
    this.onRamp = this.nextRamp;

    // 着地した瞬間
    if (this.grounded && !wasGrounded && fallSpeed < -4) {
      this.squash = 0.7; // ぺちゃっとつぶれる
      this.sfx("land");
      this.spawnDust(8, 2.5);
    }

    // --- 6. 落ちたらリスポーン ---
    if (this.position.y < C.fallLimitY) {
      this.sfx("fall");
      this.respawn(true);
      if (this.onFall) this.onFall(); // 落下回数を数えるため main.js に知らせる
    }

    this.animate(dt);
    this.updateShadow(colliders, ramps);
    this.updateDust(dt);
  }

  // ===== 坂道との判定 =====
  // 坂の上にいるとき、坂の表面の高さに足をそろえる
  resolveRamps(ramps) {
    const p = this.position;
    const v = this.velocity;
    let landed = false;
    for (const r of ramps) {
      if (p.x < r.minX || p.x > r.maxX || p.z < r.minZ || p.z > r.maxZ) continue;
      const surfaceY = r.heightAt(p.z);
      // すでに坂の上にいるときは、少し浮いても吸いつくようにする（下り坂でポンポン跳ねないため）
      const snap = this.onRamp === r ? 0.4 : 0.05;
      if (v.y <= 0.5 && p.y <= surfaceY + snap && p.y >= surfaceY - 1.2) {
        p.y = surfaceY;
        if (v.y < 0) v.y = 0;
        this.nextRamp = r;
        landed = true;
      }
    }
    return landed;
  }

  // ===== ぶつかり判定 =====
  // プレイヤーを縦長の箱とみなし、足場の箱と重なったら、いちばん浅い方向へ押し出す
  resolveCollisions(colliders) {
    const r = PLAYER_CONFIG.radius;
    const h = PLAYER_CONFIG.height;
    const p = this.position;
    const v = this.velocity;
    let landed = false;

    for (const c of colliders) {
      if (c.disabled) continue; // 落ちている床などは判定しない
      const b = c.box;
      // 重なっていなければ次へ
      if (p.x + r <= b.min.x || p.x - r >= b.max.x ||
          p.y + h <= b.min.y || p.y >= b.max.y ||
          p.z + r <= b.min.z || p.z - r >= b.max.z) continue;

      // それぞれの方向に押し出すのに必要な距離
      const up = b.max.y - p.y;
      const down = p.y + h - b.min.y;
      const px = b.max.x - (p.x - r);
      const nx = p.x + r - b.min.x;
      const pz = b.max.z - (p.z - r);
      const nz = p.z + r - b.min.z;
      const side = Math.min(px, nx, pz, nz);

      if (up <= side || (up < 0.35 && v.y <= 0)) {
        // 上に押し出す ＝ 足場に乗る（少しの段差なら自動で乗り越える）
        p.y = b.max.y;
        if (v.y < 0) v.y = 0;
        landed = true;
        this.groundCollider = c;           // 今乗っている足場を覚える
        if (c.onStand) c.onStand(this);    // 落ちる床など「乗ったとき」の処理
        continue;
      } else if (down < side) {
        // 下に押し出す ＝ 頭をぶつけた
        p.y = b.min.y - h;
        if (v.y > 0) v.y = 0;
        continue;
      }

      // ここから下は横から押し出す処理
      if (c.pusher && c.velocity) {
        // 動く壁にぶつかったら、壁が動く方向へはじき飛ばす
        const dir = Math.sign(c.velocity.x) || Math.sign(p.x - (b.min.x + b.max.x) / 2) || 1;
        this.knockback(dir * 9, 6, v.z * 0.3);
      }
      if (side === px) {
        p.x += px;
        if (v.x < 0) v.x = 0;
      } else if (side === nx) {
        p.x -= nx;
        if (v.x > 0) v.x = 0;
      } else if (side === pz) {
        p.z += pz;
        if (v.z < 0) v.z = 0;
      } else {
        p.z -= nz;
        if (v.z > 0) v.z = 0;
      }
    }
    return landed;
  }

  // ===== アニメーション =====
  animate(dt) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    let bob = 0;

    if (this.grounded) {
      // 歩く・走る：足を前後に動かし、腕をふる
      const swing = Math.min(speed / PLAYER_CONFIG.walkSpeed, 1.3);
      this.walkPhase += speed * dt * 2.2;
      const s = Math.sin(this.walkPhase);
      const c = Math.cos(this.walkPhase);
      this.footL.position.z = damp(this.footL.position.z, 0.05 + s * 0.28 * swing, 25, dt);
      this.footR.position.z = damp(this.footR.position.z, 0.05 - s * 0.28 * swing, 25, dt);
      this.footL.position.y = damp(this.footL.position.y, 0.12 + Math.max(0, c) * 0.12 * swing, 25, dt);
      this.footR.position.y = damp(this.footR.position.y, 0.12 + Math.max(0, -c) * 0.12 * swing, 25, dt);
      this.armL.rotation.x = damp(this.armL.rotation.x, -s * 0.9 * swing, 20, dt);
      this.armR.rotation.x = damp(this.armR.rotation.x, s * 0.9 * swing, 20, dt);
      this.armL.rotation.z = damp(this.armL.rotation.z, 0.15, 12, dt);
      this.armR.rotation.z = damp(this.armR.rotation.z, -0.15, 12, dt);
      bob = Math.abs(s) * 0.07 * swing;
    } else {
      // 空中：足をちぢめ、腕をバンザイ
      this.footL.position.z = damp(this.footL.position.z, -0.05, 12, dt);
      this.footR.position.z = damp(this.footR.position.z, 0.15, 12, dt);
      this.footL.position.y = damp(this.footL.position.y, 0.3, 12, dt);
      this.footR.position.y = damp(this.footR.position.y, 0.22, 12, dt);
      this.armL.rotation.x = damp(this.armL.rotation.x, 0, 10, dt);
      this.armR.rotation.x = damp(this.armR.rotation.x, 0, 10, dt);
      this.armL.rotation.z = damp(this.armL.rotation.z, 2.4, 10, dt);
      this.armR.rotation.z = damp(this.armR.rotation.z, -2.4, 10, dt);
    }

    // 速く走るほど前に傾く
    this.body.rotation.x = damp(this.body.rotation.x, (speed / PLAYER_CONFIG.dashSpeed) * 0.3, 10, dt);

    // つぶれ・のび（ばねのように 1 に戻る）
    this.squashVelocity += (1 - this.squash) * 220 * dt;
    this.squashVelocity *= Math.exp(-11 * dt);
    this.squash += this.squashVelocity * dt;
    const wide = 1 / Math.sqrt(Math.max(this.squash, 0.3));
    this.body.scale.set(wide, this.squash, wide);
    this.body.position.y = bob;

    // アンテナの玉をぷるぷる揺らす
    this.antennaBall.position.x = Math.sin(this.walkPhase * 0.5) * 0.04 * Math.min(speed, 6) / 6;

    // 体の向きを、進む方向へなめらかに回す
    this.mesh.rotation.y = dampAngle(this.mesh.rotation.y, this.facing, 14, dt);
    this.mesh.position.copy(this.position);
  }

  // 足もとの真下にある、いちばん高い足場の上に影を置く
  updateShadow(colliders, ramps) {
    const p = this.position;
    let groundY = -Infinity;
    for (const r of ramps) {
      if (p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ) {
        const y = r.heightAt(p.z);
        if (y <= p.y + 0.05 && y > groundY) groundY = y;
      }
    }
    for (const c of colliders) {
      if (c.disabled) continue;
      const b = c.box;
      if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z &&
          b.max.y <= p.y + 0.05 && b.max.y > groundY) {
        groundY = b.max.y;
      }
    }
    if (groundY === -Infinity) {
      this.shadow.visible = false;
      return;
    }
    const height = p.y - groundY;
    this.shadow.visible = true;
    this.shadow.position.set(p.x, groundY + 0.02, p.z);
    const size = Math.max(0.4, 1 - height * 0.08); // 高いほど影が小さくなる
    this.shadow.scale.set(size, size, size);
    this.shadow.material.opacity = 0.3 * size;
  }

  updateDust(dt) {
    for (const puff of this.dust) {
      if (puff.userData.life <= 0) continue;
      puff.userData.life -= dt;
      puff.position.addScaledVector(puff.userData.velocity, dt);
      const t = Math.max(puff.userData.life, 0) / 0.45; // 1 → 0
      puff.scale.setScalar(1 + (1 - t) * 1.5);
      puff.material.opacity = t * 0.8;
      if (puff.userData.life <= 0) puff.visible = false;
    }
  }
}
