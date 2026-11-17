// =====================================================
//  sound.js ― 効果音
//  音声ファイルは使わず、ブラウザの機能（Web Audio）で音を作る
// =====================================================

const Sound = {
  ctx: null,
  muted: false,
  master: null,  // すべての音の音量をまとめる場所（ミュートに使う）

  // ブラウザのルールで、最初のクリックのあとでないと音を出せない
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },

  // 音の高さを startFreq から endFreq へ変えながら鳴らす
  // delay：何秒後に鳴らすか（メロディを作るときに使う）
  tone(startFreq, endFreq, duration, type, volume, delay = 0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration);
  },

  jump()    { this.tone(320, 720, 0.15, "square", 0.08); },
  land()    { this.tone(180, 60, 0.12, "sine", 0.25); },
  dash()    { this.tone(900, 300, 0.18, "triangle", 0.12); },
  fall()    { this.tone(700, 120, 0.6, "sawtooth", 0.06); },
  respawn() { this.tone(400, 1000, 0.25, "triangle", 0.12); },
  bonk()    { this.tone(220, 80, 0.25, "square", 0.15); },     // はじき飛ばされた
  shake()   { this.tone(140, 90, 0.35, "sawtooth", 0.06); },   // 床がガタガタ
  crumble() { this.tone(90, 40, 0.4, "sawtooth", 0.1); },      // 床が落ちた

  // チェックポイント：ピロリン♪
  checkpoint() {
    [660, 880, 1320].forEach((f, i) => this.tone(f, f, 0.12, "square", 0.08, i * 0.09));
  },

  // カウントダウン：ピッ・ピッ・ピッ・ピーン
  count() { this.tone(660, 660, 0.15, "square", 0.1); },
  go()    { this.tone(1320, 1320, 0.4, "square", 0.1); },

  // ゴール：ファンファーレ
  goal() {
    const melody = [523, 659, 784, 1047, 784, 1047];
    melody.forEach((f, i) => this.tone(f, f, i === melody.length - 1 ? 0.5 : 0.14, "square", 0.09, i * 0.13));
  },

  // ===== BGM（短いメロディをくり返す） =====
  // 数字は音の高さ（MIDIノート番号。60 = ド）。0 は休み
  melody: [
    72, 0, 76, 79, 76, 0, 72, 74, 76, 0, 74, 72, 69, 0, 67, 0,
    72, 0, 76, 79, 81, 0, 79, 76, 74, 0, 76, 74, 72, 0, 0, 0,
  ],
  bass: [48, 45, 41, 43, 48, 45, 41, 43], // 8拍ごとに変わるベース
  tempo: 150,     // 1分間の拍の数
  step: 0,
  nextNoteTime: 0,
  musicTimer: null,

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    // 0.05秒ごとに「少し先までの音」を予約する（音のタイミングがずれないように）
    this.musicTimer = setInterval(() => this.scheduleMusic(), 50);
  },

  scheduleMusic() {
    const stepTime = 60 / this.tempo / 2; // 8分音符の長さ
    while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
      const delay = this.nextNoteTime - this.ctx.currentTime;
      const note = this.melody[this.step % this.melody.length];
      if (note) {
        const f = 440 * Math.pow(2, (note - 69) / 12); // ノート番号を周波数に変える
        this.tone(f, f, stepTime * 0.9, "square", 0.025, delay);
      }
      if (this.step % 2 === 0) {
        const b = this.bass[Math.floor(this.step / 4) % this.bass.length];
        const fb = 440 * Math.pow(2, (b - 69) / 12);
        this.tone(fb, fb, stepTime * 1.6, "triangle", 0.07, delay);
      }
      this.step++;
      this.nextNoteTime += stepTime;
    }
  },

  // M キー：音のオン・オフ
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  },
};
