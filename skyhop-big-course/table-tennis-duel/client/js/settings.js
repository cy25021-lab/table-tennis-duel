// =====================================================
//  settings.js ― 設定（操作方法・感度など）と設定画面
// =====================================================

const Settings = {
  // 初期値
  values: {
    mode: "both",        // both（マウス＋キーボード） / mouse / keyboard
    mouseSensitivity: 1.0,
    keySpeed: 1.0,
    swingMode: "charge", // charge（長押しで強く） / instant（押した瞬間に最大）
  },
  open: false,
  onChange: null,

  init() {
    this.load();
    this.panel = document.getElementById("settings");
    this.form = {
      mode: document.getElementById("setMode"),
      mouseSensitivity: document.getElementById("setMouse"),
      keySpeed: document.getElementById("setKey"),
      swingMode: document.getElementById("setSwing"),
    };
    // 画面の入力欄に今の値を入れる
    Object.keys(this.form).forEach(key => {
      const el = this.form[key];
      el.value = this.values[key];
      el.addEventListener("input", () => {
        const v = el.type === "range" ? parseFloat(el.value) : el.value;
        this.values[key] = v;
        this.updateLabels();
        this.save();
      });
    });
    this.updateLabels();

    document.getElementById("settingsBtn").addEventListener("click", () => this.toggle());
    document.getElementById("settingsClose").addEventListener("click", () => this.toggle(false));
    window.addEventListener("keydown", e => {
      if (e.code === "Escape" && e.target.tagName !== "INPUT") this.toggle();
    });
  },

  updateLabels() {
    document.getElementById("setMouseValue").textContent = this.values.mouseSensitivity.toFixed(1);
    document.getElementById("setKeyValue").textContent = this.values.keySpeed.toFixed(1);
  },

  toggle(force) {
    this.open = force === undefined ? !this.open : force;
    this.panel.classList.toggle("hidden", !this.open);
    Input.enabled = !this.open; // 設定中はゲームの操作を止める
    if (this.open) Input.mouseDown = false;
  },

  // ブラウザに保存（保存できない環境ではスキップ）
  save() {
    try {
      localStorage.setItem("ttdSettings", JSON.stringify(this.values));
    } catch (err) { /* 何もしない */ }
  },

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem("ttdSettings"));
      if (saved) Object.assign(this.values, saved);
    } catch (err) { /* 何もしない */ }
  },
};
