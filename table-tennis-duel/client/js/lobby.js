// =====================================================
//  lobby.js ― タイトル・部屋作成・コード入力・相手待ち・対戦準備の画面
//
//  画面の流れ：
//    タイトル ─┬─「部屋を作る」→ 部屋作成（コード表示・相手待ち）─┐
//              ├─「部屋に参加」→ コード入力 ─────────────────┤
//              └─「練習モード」→ CPUと練習                     ↓
//                                              対戦準備（2人そろったら）→ 試合
// =====================================================

const ERROR_TEXT = {
  invalid_code: "6桁の数字を入力してください",
  not_found: "その部屋は見つかりません。コードを確認してください",
  full: "この部屋はすでに2人そろっています",
  already_in_room: "すでにこの部屋に入っています",
  too_many: "試した回数が多すぎます。1分ほど待ってからもう一度どうぞ",
  offline: "サーバーに接続していません。少し待ってからもう一度どうぞ",
  timeout: "サーバーから返事がありません。もう一度どうぞ",
};

const Lobby = {
  screen: "title",   // 今の画面（null ならゲーム中で画面を出していない）
  room: null,        // 部屋の最新の情報（サーバーから届く）
  you: null,         // 自分の情報 { side, name, token }
  onStartMatch: null,  // 試合開始のときに呼ぶ関数（main.js で設定）
  onStartPractice: null,
  onLeaveRoom: null,
  onRoomUpdate: null,  // 試合中に部屋の情報（相手の接続状態など）が届いたとき

  init() {
    const $ = id => document.getElementById(id);
    this.$ = $;

    // 名前（前回入れたものを覚えておく）
    try { $("nameInput").value = localStorage.getItem("ttdName") || ""; } catch (e) { /* 何もしない */ }

    $("btnCreate").addEventListener("click", () => this.createRoom());
    $("btnJoinOpen").addEventListener("click", () => this.show("join"));
    $("btnPractice").addEventListener("click", () => {
      this.show(null);
      if (this.onStartPractice) this.onStartPractice();
    });
    $("btnSettingsTitle").addEventListener("click", () => Settings.toggle(true));
    $("btnCopy").addEventListener("click", () => this.copyCode());
    $("btnJoin").addEventListener("click", () => this.joinRoom());
    $("codeInput").addEventListener("input", e => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); // 数字だけ・6桁まで
      $("joinError").textContent = "";
    });
    $("codeInput").addEventListener("keydown", e => {
      if (e.key === "Enter") this.joinRoom();
    });
    $("btnJoinBack").addEventListener("click", () => this.show("title"));
    document.querySelectorAll(".btn-leave").forEach(b => b.addEventListener("click", () => this.leaveRoom()));
    $("btnReady").addEventListener("click", () => this.toggleReady());

    this.show("title");
  },

  playerName() {
    const name = this.$("nameInput").value.trim().slice(0, 12) || "PLAYER";
    try { localStorage.setItem("ttdName", name); } catch (e) { /* 何もしない */ }
    return name;
  },

  // ----- 画面の切り替え（null ならすべて隠す＝ゲーム画面） -----
  show(name) {
    this.screen = name;
    document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
    if (name) this.$("screen-" + name).classList.remove("hidden");
    document.body.classList.toggle("in-menu", !!name);
    if (name === "join") {
      this.$("codeInput").value = "";
      this.$("joinError").textContent = "";
      setTimeout(() => this.$("codeInput").focus(), 50);
    }
  },

  notice(text) {
    const el = this.$("titleNotice");
    el.textContent = text;
    el.classList.toggle("hidden", !text);
  },

  // サーバーに送って返事を待つ（5秒で時間切れ）
  request(event, data) {
    return new Promise(resolve => {
      if (!Network.socket || !Network.socket.connected) return resolve({ ok: false, error: "offline" });
      Network.socket.timeout(5000).emit(event, data, (err, res) => {
        resolve(err ? { ok: false, error: "timeout" } : res);
      });
    });
  },

  // ----- 部屋を作る -----
  async createRoom() {
    this.notice("");
    const res = await this.request("room:create", { name: this.playerName() });
    if (!res.ok) return this.notice(ERROR_TEXT[res.error] || res.error);
    this.enterRoom(res);
  },

  // ----- 部屋に参加 -----
  async joinRoom() {
    const code = this.$("codeInput").value;
    if (!/^\d{6}$/.test(code)) {
      this.$("joinError").textContent = ERROR_TEXT.invalid_code;
      return;
    }
    const res = await this.request("room:join", { code: code, name: this.playerName() });
    if (!res.ok) {
      this.$("joinError").textContent = ERROR_TEXT[res.error] || res.error;
      return;
    }
    this.enterRoom(res);
  },

  enterRoom(res) {
    this.you = res.you;
    this.saveSession(res.room.code, res.you.token);
    this.updateRoom(res.room);
  },

  // ----- 部屋から出る -----
  async leaveRoom() {
    await this.request("room:leave", {});
    this.room = null;
    this.you = null;
    this.saveSession(null);
    this.show("title");
    if (this.onLeaveRoom) this.onLeaveRoom();
  },

  async toggleReady() {
    const me = this.room && this.room.players.find(p => p.side === this.you.side);
    if (!me) return;
    await this.request("room:ready", { ready: !me.ready });
  },

  // ----- ルームコードをコピー -----
  async copyCode() {
    const code = this.room ? this.room.code : "";
    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch (err) {
      // 古いブラウザや許可がない場合の予備の方法
      const area = document.createElement("textarea");
      area.value = code;
      document.body.appendChild(area);
      area.select();
      try { copied = document.execCommand("copy"); } catch (e) { copied = false; }
      area.remove();
    }
    this.$("btnCopy").textContent = copied ? "コピーしました ✓" : "コピーできませんでした";
    setTimeout(() => { this.$("btnCopy").textContent = "コードをコピー"; }, 1500);
  },

  // ----- サーバーから部屋の情報が届いたとき -----
  updateRoom(room) {
    const wasPlaying = this.room && this.room.state === "playing";
    this.room = room;
    const $ = this.$;

    if (room.state === "playing") {
      // つなぎ直したら試合中だった → 試合の画面に戻る
      if (this.screen !== null) this.startMatch();
      if (this.onRoomUpdate) this.onRoomUpdate(room);
      return;
    }

    if (room.state === "waiting") {
      // 相手待ち（作った直後・相手が抜けたとき）
      if (wasPlaying || this.screen === "lobby" || this.screen === null) {
        this.flash("相手が退出したため、相手の参加を待っています");
      }
      $("roomCode").textContent = room.code.replace(/(\d{3})(\d{3})/, "$1 $2");
      this.show("create");
      if (wasPlaying && this.onLeaveRoom) this.onLeaveRoom();
      return;
    }

    if (room.state === "lobby") {
      if (wasPlaying && this.onLeaveRoom) this.onLeaveRoom();
      this.show("lobby");
      $("lobbyCode").textContent = room.code;
      // 自分と相手のカード
      const me = room.players.find(p => p.side === this.you.side);
      const opp = room.players.find(p => p.side !== this.you.side);
      this.fillCard("cardMe", me, true);
      this.fillCard("cardOpp", opp, false);
      $("btnReady").textContent = me && me.ready ? "準備完了を取り消す" : "準備完了";
      $("btnReady").classList.toggle("is-ready", !!(me && me.ready));
      const bothReady = room.players.length === 2 && room.players.every(p => p.ready);
      $("lobbyStatus").textContent = !opp || !opp.connected
        ? "相手の接続が切れています（30秒以内に戻れば続けられます）"
        : (bothReady ? "まもなく試合開始！" : "2人とも「準備完了」を押すと試合が始まります");
    }
  },

  fillCard(id, p, isMe) {
    const card = this.$(id);
    if (!p) {
      card.querySelector(".pc-name").textContent = "—";
      return;
    }
    card.querySelector(".pc-name").textContent = p.name + (isMe ? "（あなた）" : "");
    card.querySelector(".pc-side").textContent = p.side === 1 ? "PLAYER 1" : "PLAYER 2";
    const conn = card.querySelector(".pc-conn");
    conn.textContent = p.connected ? "● 接続中" : "● 切断中";
    conn.className = "pc-conn " + (p.connected ? "ok" : "ng");
    const ready = card.querySelector(".pc-ready");
    ready.textContent = p.ready ? "準備OK" : "準備中…";
    ready.className = "pc-ready " + (p.ready ? "ok" : "");
  },

  flash(text) {
    const el = this.$("createNotice");
    el.textContent = text;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 4000);
  },

  // ----- 試合開始 -----
  startMatch() {
    if (this.screen === null) return; // すでに試合の画面
    this.show(null);
    if (this.onStartMatch) this.onStartMatch(this.you.side, this.room);
  },

  // 部屋が時間切れで閉じられた
  roomClosed() {
    this.room = null;
    this.you = null;
    this.saveSession(null);
    this.show("title");
    this.notice("部屋の有効期限が切れたため、部屋を閉じました");
    if (this.onLeaveRoom) this.onLeaveRoom();
  },

  // ----- つなぎ直し用に、部屋のコードと合言葉をこのタブに覚えておく -----
  saveSession(code, token) {
    try {
      if (code) sessionStorage.setItem("ttdSession", JSON.stringify({ code: code, token: token }));
      else sessionStorage.removeItem("ttdSession");
    } catch (e) { /* 何もしない */ }
  },

  // サーバーに（再）接続したとき：部屋にいたなら同じ席に戻る
  async onConnected() {
    let session = null;
    try { session = JSON.parse(sessionStorage.getItem("ttdSession")); } catch (e) { /* 何もしない */ }
    if (!session) return;
    const res = await this.request("room:rejoin", session);
    if (res.ok) {
      this.you = res.you;
      this.updateRoom(res.room);
    } else {
      this.saveSession(null);
      if (this.screen !== "title") {
        this.show("title");
        this.notice("接続が切れている間に、部屋が閉じられました");
        if (this.onLeaveRoom) this.onLeaveRoom();
      }
    }
  },

  // サーバーからのお知らせを受け取る準備
  listen(socket) {
    socket.on("room:update", room => this.updateRoom(room));
    socket.on("match:start", () => this.startMatch());
    socket.on("room:closed", () => this.roomClosed());
  },
};
