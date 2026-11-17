// =====================================================
//  network.js ― サーバーとの通信（Socket.IO）
//
//  ・WebSocket でサーバーにつなぐ
//  ・切れたら自動でつなぎ直す
//  ・通信の速さ（ping：往復にかかる時間）を測る
// =====================================================

const Network = {
  socket: null,
  status: "idle",   // idle / connecting / online / reconnecting / offline
  ping: null,       // 往復の時間（ミリ秒）
  online: 0,        // サーバーにつながっている人数
  attempts: 0,      // つなぎ直しの回数
  lastError: "",
  onStatus: null,   // 状態が変わったときに呼ぶ関数
  onSocket: null,   // 接続の準備ができたときに呼ぶ関数（お知らせの受け取りを登録する）
  onConnected: null, // つながった（つなぎ直した）ときに呼ぶ関数
  onClock: null,    // サーバーの時刻が分かったときに呼ぶ関数（時刻合わせ）

  // つなぐ先のURLを決める
  serverUrl() {
    // ?server=https://... をURLにつけると、その場でつなぐ先を変えられる（テスト用）
    const fromQuery = new URLSearchParams(location.search).get("server");
    if (fromQuery) return fromQuery;
    const configured = window.TTD_CONFIG && window.TTD_CONFIG.SERVER_URL;
    if (configured) return configured;
    if (location.protocol === "file:") return "http://localhost:3000"; // ダブルクリックで開いたとき
    return location.origin;                                            // サーバーから開いたとき
  },

  setStatus(status) {
    this.status = status;
    if (this.onStatus) this.onStatus(this);
  },

  connect(name) {
    if (typeof io === "undefined") {
      // Socket.IO のライブラリを読み込めなかった
      this.lastError = "通信ライブラリを読み込めませんでした";
      this.setStatus("offline");
      return;
    }
    const url = this.serverUrl();
    this.setStatus("connecting");

    this.socket = io(url, {
      transports: ["websocket"], // WebSocket で通信する
      reconnection: true,        // 切れたら自動でつなぎ直す
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000,
    });

    if (this.onSocket) this.onSocket(this.socket);

    this.socket.on("connect", () => {
      this.attempts = 0;
      this.lastError = "";
      this.setStatus("online");
      this.socket.emit("hello", { name: name }, info => {
        this.id = info.id;
      });
      this.measurePing();
      if (this.onConnected) this.onConnected();
    });

    this.socket.on("disconnect", reason => {
      // 自分から切ったとき以外は、つなぎ直しを待つ
      this.setStatus(reason === "io client disconnect" ? "offline" : "reconnecting");
    });

    this.socket.on("connect_error", err => {
      this.lastError = err.message;
      this.setStatus(this.attempts > 0 ? "reconnecting" : "offline");
    });

    this.socket.io.on("reconnect_attempt", n => {
      this.attempts = n;
      this.setStatus("reconnecting");
    });

    this.socket.on("server:stats", stats => {
      this.online = stats.online;
      if (this.onStatus) this.onStatus(this);
    });

    // 2秒ごとに通信の速さを測る
    setInterval(() => this.measurePing(), 2000);
  },

  measurePing() {
    if (!this.socket || !this.socket.connected) return;
    const start = performance.now();
    const sentAt = Date.now();
    this.socket.timeout(3000).emit("ping:check", sentAt, (err, res) => {
      if (err) return; // 3秒以内に返事がなかった
      this.ping = Math.round(performance.now() - start);
      if (this.onClock && res) this.onClock(res.serverTime, sentAt, Date.now());
      if (this.onStatus) this.onStatus(this);
    });
  },
};
