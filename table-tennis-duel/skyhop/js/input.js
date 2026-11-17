// =====================================================
//  input.js ― キーボードとマウスの入力をまとめて管理
// =====================================================

const Input = {
  keys: {},        // 今押されているキー
  pressed: {},     // このフレームで「押した瞬間」のキー
  mouseDX: 0,      // マウスが動いた量（横）
  mouseDY: 0,      // マウスが動いた量（縦）
  wheel: 0,        // ホイールを回した量
  locked: false,   // マウスが画面に固定されているか
  dragging: false, // マウスボタンを押しながら動かしているか

  init(dom) {
    // --- キーボード ---
    window.addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT") return; // 名前やコードの入力中は、ゲームの操作にしない
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      // Space や矢印キーでページがスクロールしないように
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", e => {
      this.keys[e.code] = false;
    });
    // 別のウィンドウに切り替えたら全部離したことにする
    window.addEventListener("blur", () => {
      this.keys = {};
    });

    // --- マウス ---
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === dom;
    });
    document.addEventListener("mousemove", e => {
      if (this.locked || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    dom.addEventListener("mousedown", () => {
      this.dragging = true;
      this.requestLock(dom);
    });
    window.addEventListener("mouseup", () => {
      this.dragging = false;
    });
    dom.addEventListener("wheel", e => {
      e.preventDefault();
      this.wheel += e.deltaY;
    }, { passive: false });
  },

  // マウスを画面に固定する（できない環境ではドラッグ操作になる）
  requestLock(dom) {
    try {
      const result = dom.requestPointerLock();
      if (result && result.catch) result.catch(() => {});
    } catch (err) {
      // 固定できなくてもドラッグでカメラを回せるので何もしない
    }
  },

  isDown(code) {
    return !!this.keys[code];
  },

  wasPressed(code) {
    return !!this.pressed[code];
  },

  // マウスの移動量を受け取って 0 に戻す
  consumeMouse() {
    const move = { x: this.mouseDX, y: this.mouseDY, wheel: this.wheel };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    return move;
  },

  // 毎フレームの最後に呼ぶ（「押した瞬間」をリセット）
  endFrame() {
    this.pressed = {};
  },
};
