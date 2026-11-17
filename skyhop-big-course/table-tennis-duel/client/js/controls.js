// =====================================================
//  controls.js ― マウス・キーボードの入力から、ラケットの動きを決める
// =====================================================

const Controls = {
  charging: false,  // スイングのため中か
  lastPower: 0,     // 最後に打ったスイングの強さ（画面表示用）

  update(dt, racket) {
    const s = Settings.values;
    const useMouse = s.mode !== "keyboard";
    const useKeys = s.mode !== "mouse";

    // --- ラケットの位置 ---
    let tx = racket.target.x;
    let ty = racket.target.y;

    // マウス：画面の位置がそのままラケットの位置になる（真ん中＝体の正面）
    if (useMouse && Input.mouseMoved && Input.enabled) {
      const sens = s.mouseSensitivity;
      tx = (Input.mouseX - 0.5) * 2 * RACKET_AREA.maxX * sens;
      const midY = (RACKET_AREA.minY + RACKET_AREA.maxY) / 2;
      ty = midY + (0.5 - Input.mouseY) * (RACKET_AREA.maxY - RACKET_AREA.minY) * sens;
    }

    // キーボード：WASD で少しずつ動かす
    if (useKeys) {
      const speed = 1.6 * s.keySpeed; // 1秒に動く距離（m）
      if (Input.isDown("KeyA")) tx -= speed * dt;
      if (Input.isDown("KeyD")) tx += speed * dt;
      if (Input.isDown("KeyW")) ty += speed * dt;
      if (Input.isDown("KeyS")) ty -= speed * dt;
    }
    racket.setTarget(tx, ty);

    // --- スイング ---
    const pressed = Input.enabled && (
      (useMouse && Input.mouseDown) || (useKeys && Input.isDown("Space"))
    );

    if (s.swingMode === "instant") {
      // 押した瞬間に最大の強さで振る
      if (pressed && !this.charging && !racket.isSwinging()) {
        racket.startSwing(1);
        this.lastPower = 1;
      }
      this.charging = pressed;
      racket.charge = 0;
    } else {
      // 長押しでためて、離したときに振る（長いほど強い）
      if (pressed) {
        if (!this.charging && !racket.isSwinging()) {
          this.charging = true;
          racket.charge = 0;
        }
        if (this.charging) racket.charge = Math.min(1, racket.charge + dt / 0.6); // 0.6秒で最大
      } else if (this.charging) {
        this.charging = false;
        this.lastPower = 0.2 + 0.8 * racket.charge;
        racket.startSwing(this.lastPower);
        racket.charge = 0;
      }
    }
  },
};
