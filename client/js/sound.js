// =====================================================
//  sound.js ― 効果音（音声ファイルは使わず、ブラウザで音を作る）
// =====================================================

const Sound = {
  ctx: null,

  // ブラウザのルールで、最初のクリックかキー操作のあとでないと音が出せない
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },

  // 「コッ」という短い音（卓球の打球音・バウンド音）
  knock(freq, volume, length) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + length);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + length);
  },

  tone(freq, length, volume, delay) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + (delay || 0);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + length);
  },

  // 歓声（ザーッという音を少しずつ小さくする）
  cheer(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const length = 1.4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.12 * (strength || 1);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  },

  count(last) { this.tone(last ? 1320 : 880, last ? 0.4 : 0.15, 0.15); },

  hit(power)  { this.knock(900 + power * 500, 0.35 + power * 0.25, 0.06); },
  bounce()    { this.knock(1500, 0.25, 0.04); },
  net()       { this.knock(220, 0.3, 0.12); },
  point()     { this.tone(880, 0.15, 0.12); this.tone(1320, 0.25, 0.12, 0.1); },
  win()       { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 0.12, i * 0.15)); },
};
