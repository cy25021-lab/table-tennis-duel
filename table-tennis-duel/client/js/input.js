// =====================================================
//  input.js ― マウスとキーボードの状態を記録する
// =====================================================

const Input = {
  keys: {},           // 押されているキー
  mouseX: 0.5,        // マウスの位置（画面の左はし 0 〜 右はし 1）
  mouseY: 0.5,        // マウスの位置（画面の上はし 0 〜 下はし 1）
  mouseMoved: false,  // このフレームでマウスが動いたか
  mouseDown: false,   // 左ボタンを押しているか
  enabled: true,      // 設定画面を開いている間は false

  init(dom) {
    window.addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT") return; // 名前やコードの入力中は無視する
      this.keys[e.code] = true;
      // Space で画面がスクロールしないように
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", e => {
      this.keys[e.code] = false;
    });
    window.addEventListener("blur", () => {
      this.keys = {};
      this.mouseDown = false;
    });

    dom.addEventListener("pointermove", e => {
      const rect = dom.getBoundingClientRect();
      this.mouseX = (e.clientX - rect.left) / rect.width;
      this.mouseY = (e.clientY - rect.top) / rect.height;
      this.mouseMoved = true;
    });
    dom.addEventListener("pointerdown", e => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener("pointerup", e => {
      if (e.button === 0) this.mouseDown = false;
    });
    dom.addEventListener("contextmenu", e => e.preventDefault());
  },

  isDown(code) {
    return this.enabled && !!this.keys[code];
  },

  // 毎フレームの最後に呼ぶ
  endFrame() {
    this.mouseMoved = false;
  },
};
