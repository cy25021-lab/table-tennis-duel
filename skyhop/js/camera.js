// =====================================================
//  camera.js ― キャラクターを後ろから追いかけるカメラ
// =====================================================

const CameraController = {
  yaw: 0,          // 横の回転（0 = キャラの後ろ）
  pitch: 0.35,     // 縦の角度（大きいほど上から見下ろす）
  distance: 8,     // キャラからの距離
  sensitivity: 0.0025, // マウス感度
  lookTarget: new THREE.Vector3(),
  ready: false,

  update(camera, playerPos, dt) {
    // --- マウスでカメラを回す ---
    const mouse = Input.consumeMouse();
    this.yaw -= mouse.x * this.sensitivity;
    this.pitch += mouse.y * this.sensitivity;
    this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch)); // 真上・真下まで回らないように
    this.distance = Math.max(4, Math.min(14, this.distance + mouse.wheel * 0.01));

    // --- 見る場所（キャラの少し上）をなめらかに追いかける ---
    const target = new THREE.Vector3(playerPos.x, playerPos.y + 1.2, playerPos.z);
    if (!this.ready) {
      this.lookTarget.copy(target);
      this.ready = true;
    }
    this.lookTarget.lerp(target, 1 - Math.exp(-12 * dt));

    // --- 球の表面の上にカメラを置くイメージ ---
    const horizontal = Math.cos(this.pitch) * this.distance;
    camera.position.set(
      this.lookTarget.x + Math.sin(this.yaw) * horizontal,
      this.lookTarget.y + Math.sin(this.pitch) * this.distance,
      this.lookTarget.z + Math.cos(this.yaw) * horizontal
    );
    camera.lookAt(this.lookTarget);
  },
};
