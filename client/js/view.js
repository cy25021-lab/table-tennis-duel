// =====================================================
//  view.js ― 一人称視点のカメラ
//
//  プレイヤー1：z がプラス側に立ち、マイナス方向（相手側）を見る
//  プレイヤー2：z がマイナス側に立ち、プラス方向を見る
//  → 同じ3D空間を、反対側から見ていることになる
// =====================================================

const View = {
  side: 1,          // 1 = プレイヤー1, -1 = プレイヤー2
  lookYaw: 0,       // 見回し（横）
  lookPitch: 0,     // 見回し（縦）
  keys: {},
  shakeAmount: 0,   // 画面の揺れの強さ（スマッシュのときなど）

  init(dom) {
    // マウスはラケットの操作に使うので、見回しは矢印キーだけ（確認用）
    // 矢印キーでも見回せる、C キーで正面に戻す
    window.addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT") return; // 文字の入力中は無視する
      this.keys[e.code] = true;
      if (e.code.startsWith("Arrow")) e.preventDefault();
      if (e.code === "KeyC") this.recenter();
    });
    window.addEventListener("keyup", e => {
      this.keys[e.code] = false;
    });
  },

  look(dx, dy) {
    this.lookYaw -= dx * 0.004;
    this.lookPitch -= dy * 0.004;
    this.lookYaw = Math.max(-Math.PI, Math.min(Math.PI, this.lookYaw)); // 真後ろまで
    this.lookPitch = Math.max(-1.2, Math.min(1.2, this.lookPitch));
  },

  // 画面を揺らす
  shake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  },

  recenter() {
    this.lookYaw = 0;
    this.lookPitch = 0;
  },

  // side：1 ならプレイヤー1、-1 ならプレイヤー2
  setSide(side) {
    this.side = side;
    this.recenter();
  },

  update(camera, dt) {
    // 矢印キーで見回す
    const speed = 400 * dt;
    if (this.keys.ArrowLeft) this.look(-speed, 0);
    if (this.keys.ArrowRight) this.look(speed, 0);
    if (this.keys.ArrowUp) this.look(0, -speed);
    if (this.keys.ArrowDown) this.look(0, speed);

    // 自分の立ち位置
    camera.position.set(0, VIEW.eyeHeight, this.side * VIEW.distance);

    // 正面に見る点（台の中央より少し相手側）
    camera.lookAt(new THREE.Vector3(0, VIEW.lookAtY, -this.side * VIEW.lookAtZ));

    // 見回しの分だけ回す
    camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), this.lookYaw);
    camera.rotateX(this.lookPitch);

    // 揺れ（だんだん弱まる）
    if (this.shakeAmount > 0.0005) {
      camera.position.x += (Math.random() - 0.5) * this.shakeAmount;
      camera.position.y += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount *= Math.exp(-10 * dt);
    }
  },
};
