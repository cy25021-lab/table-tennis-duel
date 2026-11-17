// =====================================================
//  online.js ― みんなで走るオンライン対戦（最大8人）
//
//  ・サーバーの「/race」につなぐ（卓球と同じサーバー）
//  ・部屋の作成・参加・待合室・ホストのスタート
//  ・自分の位置を1秒に15回送り、ほかの人の位置を受け取って表示する
//  ・スタート時刻はサーバーが決めるので、障害物の動きも全員そろう
// =====================================================

// ほかの人の体の色（スタート位置の番号ごと）。自分はいつものオレンジ
const SLOT_COLORS = [
  [0x6fb8ff, 0xffe45c], [0xff6fae, 0x7a5cff], [0x5ad6b0, 0xff8a3d], [0xffd23f, 0xff5f6d],
  [0xb48cff, 0x3ddc84], [0xff5f6d, 0x2ec4b6], [0x8bd14a, 0xb48cff], [0xf2f2f2, 0xff6fae],
];

// スタート位置（番号ごと。スタート地点からのずれ）
function slotOffset(slot) {
  const xs = [-4.5, -1.5, 1.5, 4.5];
  return new THREE.Vector3(xs[slot % 4], 0, slot < 4 ? 0 : 2.5);
}

const ONLINE_ERRORS = {
  invalid_code: "6桁の数字を入力してください",
  not_found: "その部屋は見つかりません。コードを確認してください",
  full: "この部屋は満員です（8人まで）",
  racing: "この部屋はレース中です。終わるまで待ってください",
  too_many: "試した回数が多すぎます。1分ほど待ってください",
  offline: "サーバーに接続していません",
  timeout: "サーバーから返事がありません",
  not_enough: "2人以上そろうとスタートできます",
  not_host: "スタートできるのはホストだけです",
};

const Online = {
  socket: null,
  connected: false,
  available: false,   // オンライン対戦できる環境か（サーバーから開いたとき）
  clockOffset: 0,     // サーバーの時刻 − 自分の時刻（ミリ秒）
  room: null,
  you: null,          // { id, slot, name, token }
  remotes: new Map(), // ほかの人 id → { racer, buffer: [...] }
  inRace: false,
  raceStartAt: 0,
  sendTimer: 0,
  hooks: {},          // main.js から渡される関数（レース開始など）

  // ----- 接続 -----
  init(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    const $ = id => document.getElementById(id);
    this.$ = $;

    try { $("onlineName").value = localStorage.getItem("skyHopName") || ""; } catch (e) { /* 何もしない */ }

    $("btnOnline").addEventListener("click", () => this.openPanel());
    $("btnOnlineBack").addEventListener("click", () => this.closePanel());
    $("btnRoomCreate").addEventListener("click", () => this.createRoom());
    $("btnRoomJoin").addEventListener("click", () => this.joinRoom());
    $("roomCodeInput").addEventListener("input", e => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    });
    $("btnRoomLeave").addEventListener("click", () => this.leaveRoom());
    $("btnRaceStart").addEventListener("click", () => this.startRace());
    $("btnCopyCode").addEventListener("click", () => this.copyCode());

    if (typeof io === "undefined") return; // 通信ライブラリがない（オンラインは使えない）
    let url = location.origin;
    if (location.protocol === "file:") url = "http://localhost:3000";
    this.socket = io(url + "/race", { transports: ["websocket"], reconnectionDelayMax: 5000 });
    const s = this.socket;

    s.on("connect", () => {
      this.connected = true;
      this.available = true;
      this.syncClock();
      this.tryRejoin();
      this.updatePanel();
    });
    s.on("disconnect", () => {
      this.connected = false;
      this.updatePanel();
    });
    s.on("room:update", room => this.onRoom(room));
    s.on("room:closed", () => {
      this.room = null;
      this.saveSession(null);
      this.updatePanel();
    });
    s.on("race:states", data => this.onStates(data));
    s.on("race:tile", data => {
      const tile = Obstacles.tiles[data.id];
      if (tile && this.inRace) tile.trigger({ isHuman: false });
    });
    s.on("race:finished", data => {
      const me = this.you && data.id === this.you.id;
      UI.toast((me ? "あなた" : data.name) + " がゴール！ " + data.rank + "位", me ? "#ffe45c" : "#ffffff");
    });

    setInterval(() => this.syncClock(), 3000);
  },

  // サーバーとの時刻のずれを測る
  syncClock() {
    if (!this.connected) return;
    const sent = Date.now();
    this.socket.timeout(3000).emit("ping:check", sent, (err, res) => {
      if (err || !res) return;
      const now = Date.now();
      const offset = res.serverTime + (now - sent) / 2 - now;
      this.clockOffset = this.clockOffset ? this.clockOffset * 0.7 + offset * 0.3 : offset;
    });
  },

  serverNow() {
    return Date.now() + this.clockOffset;
  },

  request(event, data) {
    return new Promise(resolve => {
      if (!this.socket || !this.connected) return resolve({ ok: false, error: "offline" });
      this.socket.timeout(5000).emit(event, data, (err, res) => resolve(err ? { ok: false, error: "timeout" } : res));
    });
  },

  // ----- 画面（パネル） -----
  openPanel() {
    Sound.init();
    this.$("startScreen").classList.add("hidden");
    this.$("onlinePanel").classList.remove("hidden");
    this.updatePanel();
  },

  closePanel() {
    this.$("onlinePanel").classList.add("hidden");
    this.$("startScreen").classList.remove("hidden");
  },

  setError(text) {
    this.$("onlineError").textContent = text || "";
  },

  updatePanel() {
    const $ = this.$;
    const inRoom = !!this.room;
    $("onlineEntry").classList.toggle("hidden", inRoom);
    $("onlineRoom").classList.toggle("hidden", !inRoom);
    if (!this.socket) {
      $("onlineStatus").textContent = "オンライン対戦は、サーバーのページ（https://〜.onrender.com/skyhop/）で遊べます";
    } else {
      $("onlineStatus").textContent = this.connected ? "● サーバーに接続しています" : "サーバーに接続中…（起動まで1分ほどかかることがあります）";
    }
    $("btnRoomCreate").disabled = !this.connected;
    $("btnRoomJoin").disabled = !this.connected;
    if (!inRoom) return;

    const room = this.room;
    $("roomCodeShow").textContent = room.code.replace(/(\d{3})(\d{3})/, "$1 $2");
    const isHost = this.you && room.hostId === this.you.id;
    const list = room.players.slice().sort((a, b) => a.slot - b.slot).map(p => {
      const me = this.you && p.id === this.you.id;
      const tags = (p.id === room.hostId ? '<span class="tag host">ホスト</span>' : "") +
        (me ? '<span class="tag me">あなた</span>' : "") +
        (p.connected ? "" : '<span class="tag off">切断中</span>');
      return '<li><span class="slot">' + (p.slot + 1) + "</span>" + escapeHtml(p.name) + tags + "</li>";
    });
    $("roomPlayers").innerHTML = list.join("");
    $("roomCount").textContent = room.players.length + " / 8 人";
    $("btnRaceStart").classList.toggle("hidden", !isHost);
    $("btnRaceStart").disabled = room.players.filter(p => p.connected).length < 2;
    $("roomWaitText").textContent = isHost
      ? (room.players.length < 2 ? "2人以上そろうとスタートできます" : "全員そろったら「スタート」を押してください")
      : "ホストがスタートするのを待っています";
  },

  playerName() {
    const name = this.$("onlineName").value.trim().slice(0, 12) || "PLAYER";
    try { localStorage.setItem("skyHopName", name); } catch (e) { /* 何もしない */ }
    return name;
  },

  async createRoom() {
    this.setError("");
    const res = await this.request("room:create", { name: this.playerName() });
    if (!res.ok) return this.setError(ONLINE_ERRORS[res.error] || res.error);
    this.enterRoom(res);
  },

  async joinRoom() {
    this.setError("");
    const code = this.$("roomCodeInput").value;
    if (!/^\d{6}$/.test(code)) return this.setError(ONLINE_ERRORS.invalid_code);
    const res = await this.request("room:join", { code: code, name: this.playerName() });
    if (!res.ok) return this.setError(ONLINE_ERRORS[res.error] || res.error);
    this.enterRoom(res);
  },

  enterRoom(res) {
    this.you = res.you;
    this.saveSession(res.room.code, res.you.token);
    this.onRoom(res.room);
  },

  async leaveRoom() {
    await this.request("room:leave", {});
    this.room = null;
    this.you = null;
    this.saveSession(null);
    this.endRace();
    this.updatePanel();
    if (this.hooks.onLeave) this.hooks.onLeave();
  },

  async startRace() {
    const res = await this.request("race:start", {});
    if (!res.ok) this.setError(ONLINE_ERRORS[res.error] || res.error);
  },

  async backToLobby() {
    const res = await this.request("race:lobby", {});
    if (!res.ok) this.setError(ONLINE_ERRORS[res.error] || res.error);
  },

  isHost() {
    return !!(this.room && this.you && this.room.hostId === this.you.id);
  },

  async copyCode() {
    const code = this.room ? this.room.code : "";
    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch (err) {
      const area = document.createElement("textarea");
      area.value = code;
      document.body.appendChild(area);
      area.select();
      try { copied = document.execCommand("copy"); } catch (e) { copied = false; }
      area.remove();
    }
    this.$("btnCopyCode").textContent = copied ? "コピーしました ✓" : "コピーできませんでした";
    setTimeout(() => { this.$("btnCopyCode").textContent = "コードをコピー"; }, 1500);
  },

  // ----- サーバーから部屋の状態が届いた -----
  onRoom(room) {
    const prev = this.room;
    this.room = room;
    this.updatePanel();

    // いなくなった人の体を片づける
    for (const [id, r] of this.remotes) {
      if (!room.players.some(p => p.id === id)) {
        r.racer.setVisible(false);
        this.remotes.delete(id);
      }
    }

    if ((room.state === "countdown" || room.state === "racing") && (!this.inRace || this.raceStartAt !== room.startAt)) {
      // レース開始（つなぎ直したらレース中だった場合も）
      this.inRace = true;
      this.raceStartAt = room.startAt;
      this.$("onlinePanel").classList.add("hidden");
      this.$("startScreen").classList.add("hidden");
      if (this.hooks.onRaceStart) this.hooks.onRaceStart(this.you.slot, room.startAt);
    }
    if (room.state === "results" && this.hooks.onResults) this.hooks.onResults(this.ranking());
    if (room.state === "lobby" && prev && prev.state !== "lobby") {
      // レースが終わって待合室に戻った
      this.endRace();
      if (this.hooks.onLobby) this.hooks.onLobby();
      this.$("onlinePanel").classList.remove("hidden");
    }
    if (this.inRace && this.hooks.onRanking) this.hooks.onRanking(this.ranking());
  },

  endRace() {
    this.inRace = false;
    for (const r of this.remotes.values()) r.racer.setVisible(false);
  },

  // ----- 全員の位置が届いた -----
  onStates(data) {
    if (!this.inRace) return;
    for (const s of data.list) {
      if (this.you && s.id === this.you.id) continue; // 自分のものは使わない
      let r = this.remotes.get(s.id);
      if (!r) r = this.createRemote(s.id);
      if (!r) continue;
      r.buffer.push(s);
      if (r.buffer.length > 30) r.buffer.shift();
      r.cp = s.cp;
      r.z = s.p[2];
    }
  },

  createRemote(id) {
    const info = this.room && this.room.players.find(p => p.id === id);
    if (!info) return null;
    const colors = SLOT_COLORS[info.slot % SLOT_COLORS.length];
    const racer = new Player(this.scene, Course.startPoint, {
      name: info.name, isHuman: false, bodyColor: colors[0], limbColor: colors[1],
    });
    racer.isLocal = false;
    const r = { racer: racer, buffer: [], cp: 0, z: Course.startPoint.z };
    this.remotes.set(id, r);
    return r;
  },

  // ----- 毎フレーム -----
  update(dt, player, colliders, ramps) {
    if (!this.inRace) return;

    // 自分の位置を送る（1秒に15回）
    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && this.connected) {
      this.sendTimer = 1 / 15;
      const p = player.position;
      const v = player.velocity;
      const r = n => Math.round(n * 100) / 100;
      this.socket.volatile.emit("race:state", {
        p: [r(p.x), r(p.y), r(p.z)],
        v: [r(v.x), r(v.y), r(v.z)],
        f: r(player.facing),
        g: player.grounded,
        st: player.stunTimer > 0,
        cp: player.cpIndex,
      });
    }

    // ほかの人：少し前（0.15秒前）の位置を、なめらかにつないで表示する
    const renderTime = this.serverNow() - 150;
    for (const r of this.remotes.values()) {
      const list = r.buffer;
      if (!list.length) continue;
      let a = list[0];
      let b = list[0];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].t <= renderTime) {
          a = list[i];
          b = list[i + 1] || list[i];
          break;
        }
      }
      const k = b.t > a.t ? Math.max(0, Math.min(1, (renderTime - a.t) / (b.t - a.t))) : 0;
      const lerp = (x, y) => x + (y - x) * k;
      const pos = new THREE.Vector3(lerp(a.p[0], b.p[0]), lerp(a.p[1], b.p[1]), lerp(a.p[2], b.p[2]));
      const vel = new THREE.Vector3(b.v[0], b.v[1], b.v[2]);
      r.racer.setVisible(true);
      r.racer.applyRemote(pos, vel, b.f, b.g, b.st, dt, colliders, ramps);
    }
  },

  // 自分が重ならないように、ほかの人から少し離す
  separate(player) {
    const minDist = PLAYER_CONFIG.radius * 2;
    for (const r of this.remotes.values()) {
      const o = r.racer.position;
      const p = player.position;
      if (Math.abs(o.y - p.y) > 1.4) continue;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.0001 && d < minDist) {
        p.x += (dx / d) * (minDist - d);
        p.z += (dz / d) * (minDist - d);
      }
    }
  },

  // ゴールした
  async finish() {
    return this.request("race:finish", {});
  },

  // 順位（ゴールした人はタイム順、まだの人はコースの先にいる順）
  ranking(localPlayer) {
    if (!this.room) return [];
    const list = this.room.players.map(p => {
      const me = this.you && p.id === this.you.id;
      const remote = this.remotes.get(p.id);
      const z = me && localPlayer ? localPlayer.position.z : (remote ? remote.racer.position.z : 999);
      return { name: p.name, isHuman: me, finished: p.finishMs > 0, finishTime: p.finishMs / 1000, z: z };
    });
    return list.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return a.z - b.z;
    });
  },

  // ----- つなぎ直し -----
  saveSession(code, token) {
    try {
      if (code) sessionStorage.setItem("skyHopSession", JSON.stringify({ code: code, token: token }));
      else sessionStorage.removeItem("skyHopSession");
    } catch (e) { /* 何もしない */ }
  },

  async tryRejoin() {
    let session = null;
    try { session = JSON.parse(sessionStorage.getItem("skyHopSession")); } catch (e) { /* 何もしない */ }
    if (!session) return;
    const res = await this.request("room:rejoin", session);
    if (res.ok) {
      this.you = res.you;
      this.onRoom(res.room);
    } else {
      this.saveSession(null);
      this.room = null;
      this.updatePanel();
    }
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
