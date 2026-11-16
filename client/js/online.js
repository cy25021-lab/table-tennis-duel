// =====================================================
//  online.js ― オンライン対戦の画面側
//
//  ・サーバーから届く試合の状態を、補間してなめらかに表示する
//  ・自分のラケットの状態・サーブ・当たりの申告をサーバーに送る（shared/netplay.js）
//  ・得点・サーブ権・試合終了・再戦・相手の切断の表示
// =====================================================

const Online = {
  active: false,
  side: 1,
  net: null,        // Netplay.NetPlayer
  opponentName: "相手",

  // 試合開始
  start(side, opponentName) {
    this.active = true;
    this.side = side;
    this.opponentName = opponentName;
    this.net = new Netplay.NetPlayer(side, (event, data) => {
      if (Network.socket && Network.socket.connected) Network.socket.emit(event, data);
    });
    document.getElementById("gameover").classList.add("hidden");
    document.getElementById("pauseOverlay").classList.add("hidden");
  },

  stop() {
    this.active = false;
    this.net = null;
    document.getElementById("pauseOverlay").classList.add("hidden");
  },

  // サーバーからのお知らせを受け取る準備（network.js から呼ばれる）
  listen(socket) {
    socket.on("game:state", snap => {
      if (this.active && this.net) this.net.onState(snap);
    });
    socket.on("game:events", events => {
      if (!this.active) return;
      // 画面のボールは少し遅れて表示しているので、音や演出も同じだけ遅らせて合わせる
      setTimeout(() => {
        if (this.active) events.forEach(e => this.onEvent(e));
      }, Netplay.INTERP_DELAY);
    });
  },

  // 時刻合わせ（ping を測ったときに呼ばれる）
  onClock(serverTime, sentAt, receivedAt) {
    if (this.net) this.net.updateClock(serverTime, sentAt, receivedAt);
  },

  // 毎フレーム：自分のラケットを渡して、表示するボールの状態を受け取る
  update(dt, myRacket, oppRacket) {
    if (!this.net) return null;
    const r = myRacket;
    const swinging = r.isSwinging();
    const view = this.net.update(dt, {
      x: r.worldPos.x, y: r.worldPos.y, z: r.worldPos.z,
      vx: r.velocity.x, vy: r.velocity.y, vz: r.velocity.z,
      swinging: swinging,
      swingT: swinging ? r.swingTime / SWING_TIME : 0,
      power: r.swingPower,
      localX: r.local.x,
      localY: r.local.y,
    });
    this.net.driveOpponent(oppRacket);
    this.updateHud();
    return view;
  },

  latest() {
    return this.net ? this.net.buffer.latest() : null;
  },

  // スコアボード・サーブの案内
  updateHud() {
    const s = this.latest();
    if (!s) return;
    const me = this.side;
    const myScore = me === 1 ? s.score[0] : s.score[1];
    const oppScore = me === 1 ? s.score[1] : s.score[0];
    renderScoreboard(myScore, oppScore, s.server === me, s.phase !== "gameover", this.opponentName);
    const myServe = s.phase === "serve" && s.server === me && !s.paused && !(s.countdown > 0);
    document.getElementById("hint").textContent = myServe
      ? "あなたのサーブ：クリック または Space（長押しで強く）"
      : (s.phase === "serve" ? this.opponentName + " のサーブ" : "");
  },

  // 壁のスコアボード用の名前 { 1: プレイヤー1, -1: プレイヤー2 }
  names() {
    const me = Lobby.you ? Lobby.you.name : "YOU";
    return this.side === 1 ? { 1: me, "-1": this.opponentName } : { 1: this.opponentName, "-1": me };
  },

  // 試合で起きたこと（音・表示）
  onEvent(e) {
    const me = this.side;
    playEffect(e, me);
    if (e.type === "hit") {
      Sound.hit(e.smash ? 1.3 : e.power);
      if (e.smash && e.side === me) showMessage("SMASH!", "");
    } else if (e.type === "serve") Sound.hit(0.3);
    else if (e.type === "bounce") Sound.bounce();
    else if (e.type === "net") Sound.net();
    else if (e.type === "let") showMessage("LET", "ネットにふれたのでサーブやり直し");
    else if (e.type === "point") {
      Sound.point();
      showMessage(e.winner === me ? "YOUR POINT!" : this.opponentName + " POINT", REASONS[e.reason] || "");
    } else if (e.type === "gameover") {
      const won = e.winner === me;
      if (won) Sound.win();
      const s = this.latest();
      const my = s ? (me === 1 ? s.score[0] : s.score[1]) : "";
      const opp = s ? (me === 1 ? s.score[1] : s.score[0]) : "";
      document.getElementById("gameoverTitle").textContent = won ? "YOU WIN!" : "YOU LOSE";
      document.getElementById("gameoverScore").textContent = my + " - " + opp;
      document.getElementById("rematchStatus").textContent = "";
      document.getElementById("rematchBtn").disabled = false;
      document.getElementById("gameover").classList.remove("hidden");
    } else if (e.type === "rematch_request") {
      const el = document.getElementById("rematchStatus");
      el.textContent = e.side === me ? "相手の返事を待っています…" : this.opponentName + " が再戦を希望しています";
    } else if (e.type === "rematch_start") {
      document.getElementById("gameover").classList.add("hidden");
      showMessage("REMATCH!", "再戦スタート");
    }
  },

  requestRematch() {
    if (Network.socket) Network.socket.emit("game:rematch");
    document.getElementById("rematchBtn").disabled = true;
  },

  // 部屋の情報が届いたとき：相手の接続が切れていたら「待っています」を出す
  onRoomUpdate(room) {
    if (!this.active) return;
    const opp = room.players.find(p => p.side !== this.side);
    const waiting = !opp || !opp.connected;
    document.getElementById("pauseOverlay").classList.toggle("hidden", !waiting);
  },
};
