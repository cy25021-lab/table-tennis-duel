// =====================================================
//  main.js ― 全体をまとめて動かす
//
//  モード（mode）：
//    menu     … タイトルなどの画面を表示中（後ろでCPU同士がデモ試合をしている）
//    practice … CPUと練習
//    online   … オンライン対戦（試合の計算はサーバー。online.js が表示と送信をする）
// =====================================================

// ----- 描画の準備 -----
const container = document.getElementById("game");

// このPC・ブラウザで3D表示（WebGL）が使えるか調べる
function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch (e) {
    return false;
  }
}

const WEBGL_HELP =
  "このPC・ブラウザでは3D表示（WebGL）が使えないようです。<br><br>" +
  "① Chrome・Edge の設定 →「システム」→「<b>グラフィック アクセラレーションが使用可能な場合は使用する</b>」をオンにして、ブラウザを再起動<br>" +
  "② ブラウザを最新版にする（または Chrome / Edge で開く）<br>" +
  "③ それでも映らない場合は、PCのグラフィック機能が対応していない可能性があります";

if (!webglAvailable()) {
  showFatal(WEBGL_HELP, "WebGL: not available");
  throw new Error("WebGL not available"); // ここで止める（原因は画面に表示済み）
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false }); // 軽い設定でもう一度
  } catch (err2) {
    showFatal(WEBGL_HELP, String(err2 && err2.message));
    throw err2;
  }
}

// 3D表示が途中で止まった（グラフィックの負担が大きすぎたときなど）
renderer.domElement.addEventListener("webglcontextlost", e => {
  e.preventDefault();
  showFatal("3D表示が止まりました。ページを再読み込み（F5）してください。", "WebGL context lost");
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VIEW.fov, window.innerWidth / window.innerHeight, 0.05, 100);

// ----- 体育館・卓球台・ボール -----
createGym(scene);
createTable(scene);
View.init(renderer.domElement);
Input.init(renderer.domElement);
Settings.init();
const ballView = new BallView(scene);
const effects = new Effects(scene);
const wallBoard = new WallScoreboard(scene);

// ----- 2人分のラケットと体 -----
const sides = {};
[1, -1].forEach(side => {
  sides[side] = {
    racket: new Racket(scene, side),
    avatar: new Avatar(scene, side, side === 1 ? 0x2a6fdb : 0xe0482f),
    wasSwinging: false,
  };
});
const myArm = new Arm(scene, 0x2a6fdb);

// ----- 試合（ルールと物理は shared/ のファイル） -----
const match = new Match({ firstServer: 1, startCountdown: 3 });
let cpu = new Cpu(-1, 0.7);
const demoCpu = { 1: new Cpu(1, 0.75), "-1": new Cpu(-1, 0.75) }; // メニューの後ろのデモ試合用
let mode = "menu";
let opponentName = "CPU";

// ----- 画面の部品 -----
const el = id => document.getElementById(id);
const hud = document.querySelector(".hud");
const powerFill = el("powerFill");
const powerText = el("powerText");
const modeText = el("modeText");
const MODE_NAMES = { both: "マウス＋キーボード", mouse: "マウスのみ", keyboard: "キーボードのみ" };

// 得点の理由を日本語にする
const REASONS = {
  serve_fault: "サーブミス",
  out: "アウト",
  double_bounce: "2バウンド",
  missed: "返球できず",
  own_side: "自分のコートに打った",
  volley: "ノーバウンドで打った",
  stopped: "ボールが止まった",
};

let messageTimer = null;
function showMessage(text, sub) {
  el("message").innerHTML = text + (sub ? "<small>" + sub + "</small>" : "");
  el("message").classList.add("show");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => el("message").classList.remove("show"), 1600);
}

// スコアボードを書きかえる（練習でもオンラインでも使う）
function renderScoreboard(myScore, oppScore, myServe, showServe, oppName) {
  el("scoreMe").textContent = myScore;
  el("scoreOpp").textContent = oppScore;
  el("oppName").textContent = oppName;
  el("serveMe").classList.toggle("on", showServe && myServe);
  el("serveOpp").classList.toggle("on", showServe && !myServe);
}

function updateScoreboard() {
  if (mode === "online") return; // オンラインでは online.js が書きかえる
  const me = View.side;
  renderScoreboard(match.score[me], match.score[-me], match.server === me, match.phase !== "gameover", opponentName);
  const myServe = mode === "practice" && match.phase === "serve" && match.server === me;
  el("hint").textContent = myServe ? "あなたのサーブ：クリック または Space（長押しで強く）" : "";
}

function restartMatch(rematch) {
  if (rematch) match.rematch();
  else match.reset();
  el("gameover").classList.add("hidden");
  updateScoreboard();
}

// ----- モードの切り替え -----
function setMode(next) {
  mode = next;
  document.body.dataset.mode = next; // CSS で表示を切り替える
  el("gameover").classList.add("hidden");
}

function startPractice() {
  View.setSide(1);
  cpu = new Cpu(-1, 0.7);
  opponentName = "CPU";
  setMode("practice");
  restartMatch(false);
  showHelpForAWhile();
}

function startOnline(mySide, room) {
  View.setSide(mySide);
  const opp = room.players.find(p => p.side !== mySide);
  opponentName = opp ? opp.name : "相手";
  setMode("online");
  Online.start(mySide, opponentName);
  showHelpForAWhile();
}

function backToMenu() {
  Online.stop();
  setMode("menu");
  match.reset();
}

el("rematchBtn").addEventListener("click", () => {
  if (mode === "online") Online.requestRematch(); // オンライン：2人とも押したら再戦
  else restartMatch(true);
});
el("gameoverLeave").addEventListener("click", () => {
  el("gameover").classList.add("hidden");
  if (mode === "online") Lobby.leaveRoom();
  else {
    backToMenu();
    Lobby.show("title");
  }
});
el("btnMenu").addEventListener("click", () => {
  if (mode === "online") Lobby.leaveRoom();
  else {
    backToMenu();
    Lobby.show("title");
  }
});

// ----- 画面（タイトル・部屋）の準備 -----
Lobby.onStartPractice = startPractice;
Lobby.onStartMatch = startOnline;
Lobby.onLeaveRoom = () => {
  if (mode !== "menu") backToMenu();
};
Lobby.onRoomUpdate = room => Online.onRoomUpdate(room);
Lobby.init();
setMode("menu");

// 最初のクリック・キーで音を出せるようにする
window.addEventListener("pointerdown", () => Sound.init());
window.addEventListener("keydown", e => {
  Sound.init();
  if (Settings.open || e.target.tagName === "INPUT") return; // 文字の入力中はゲームのキー操作をしない
  if (e.code === "KeyH") {
    clearTimeout(helpTimer);
    hud.classList.toggle("help-hidden");
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----- 演出（練習でもオンラインでも使う） -----
//  mySide：自分の側（1 or -1）
function playEffect(e, mySide) {
  if (e.type === "hit" && e.pos) {
    effects.hit(e.pos, e.power, e.smash);
    if (e.smash) View.shake(e.side === mySide ? 0.012 : 0.02); // スマッシュで画面が揺れる
  } else if (e.type === "bounce" && e.pos) {
    effects.bounce(e.pos);
  } else if (e.type === "point") {
    Sound.cheer(e.winner === mySide ? 1 : 0.6);
    bumpScore(e.winner === mySide ? "scoreMe" : "scoreOpp");
  } else if (e.type === "gameover") {
    Sound.cheer(1.6);
  }
}

// 点数が入ったときに数字をポンとはねさせる
function bumpScore(id) {
  const node = el(id);
  node.classList.remove("bump");
  void node.offsetWidth;
  node.classList.add("bump");
}

// 試合開始前の「3・2・1・GO!」
let lastCount = 0;
function showCountdown(remaining) {
  const n = Math.ceil(remaining);
  if (n !== lastCount) {
    if (n > 0) {
      el("countdown").textContent = n;
      Sound.count(false);
    } else if (lastCount > 0) {
      el("countdown").textContent = "GO!";
      Sound.count(true);
      setTimeout(() => { if (lastCount === 0) el("countdown").textContent = ""; }, 700);
    }
    el("countdown").classList.remove("pop");
    void el("countdown").offsetWidth;
    el("countdown").classList.add("pop");
    lastCount = n;
  }
}

// 操作説明は最初の10秒だけ出して、自動で隠す（H キーでいつでも出せる）
let helpTimer = null;
function showHelpForAWhile() {
  hud.classList.remove("help-hidden");
  clearTimeout(helpTimer);
  helpTimer = setTimeout(() => hud.classList.add("help-hidden"), 10000);
}

// ----- 試合で起きたことに反応する（音・表示） -----
function handleEvents() {
  const events = match.takeEvents();
  if (mode !== "practice") return; // デモ試合の音や表示は出さない
  for (const e of events) {
    playEffect(e, View.side);
    if (e.type === "hit") {
      Sound.hit(e.smash ? 1.3 : e.power);
      if (e.smash && e.side === View.side) showMessage("SMASH!", "");
    } else if (e.type === "serve") Sound.hit(0.3);
    else if (e.type === "bounce") Sound.bounce();
    else if (e.type === "net") Sound.net();
    else if (e.type === "let") showMessage("LET", "ネットにふれたのでサーブやり直し");
    else if (e.type === "point") {
      Sound.point();
      const mine = e.winner === View.side;
      showMessage(mine ? "YOUR POINT!" : opponentName + " POINT", REASONS[e.reason] || "");
    } else if (e.type === "gameover") {
      const won = e.winner === View.side;
      if (won) Sound.win();
      el("gameoverTitle").textContent = won ? "YOU WIN!" : "YOU LOSE";
      el("gameoverScore").textContent = match.score[View.side] + " - " + match.score[-View.side];
      el("rematchStatus").textContent = "";
      el("rematchBtn").disabled = false;
      el("gameover").classList.remove("hidden");
    }
  }
  updateScoreboard();
}

// スイングの強さのメーター
function updatePowerMeter(myRacket) {
  let ratio = myRacket.charge;
  if (myRacket.isSwinging()) ratio = Controls.lastPower;
  powerFill.style.width = (ratio * 100) + "%";
  powerFill.classList.toggle("max", ratio >= 0.99);
  powerText.textContent = myRacket.isSwinging()
    ? "SWING " + Math.round(Controls.lastPower * 100) + "%"
    : (Controls.charging ? "CHARGE " + Math.round(ratio * 100) + "%" : "POWER");
  modeText.textContent = "操作：" + MODE_NAMES[Settings.values.mode];
}

// ラケットの状態を試合に渡す
function sendRacket(side) {
  const s = sides[side];
  const r = s.racket;
  const swinging = r.isSwinging();
  // スイングを始めた瞬間がサーブの合図
  if (swinging && !s.wasSwinging && match.phase === "serve" && match.server === side) {
    match.requestServe(side, r.swingPower);
  }
  s.wasSwinging = swinging;
  match.setRacket(side, {
    x: r.worldPos.x, y: r.worldPos.y, z: r.worldPos.z,
    vx: r.velocity.x, vy: r.velocity.y, vz: r.velocity.z,
    swinging: swinging,
    swingT: swinging ? r.swingTime / SWING_TIME : 0,
    power: r.swingPower,
  });
}

// CPU の考えたとおりにラケットを動かす
function driveByCpu(racket, brain, dt) {
  const plan = brain.think(dt, match);
  racket.setTarget(plan.x, plan.y);
  if (plan.swing) racket.startSwing(plan.swing);
  if (plan.serve) racket.startSwing(plan.serve);
}

// ----- サーバーとの接続 -----
const STATUS_TEXT = {
  idle: "未接続",
  connecting: "サーバーに接続中…",
  online: "オンライン",
  reconnecting: "再接続中",
  offline: "サーバー未接続（練習モードのみ）",
};
Network.onStatus = net => {
  let text = STATUS_TEXT[net.status];
  if (net.status === "online") {
    text += net.ping !== null ? "　ping " + net.ping + "ms" : "";
    text += "　接続中 " + net.online + "人";
  }
  if (net.status === "reconnecting" && net.attempts) text += "（" + net.attempts + "回目）";
  el("netText").textContent = text;
  el("netBadge").className = "net-badge " + net.status;
  el("netBadge").title = "つなぎ先：" + net.serverUrl() + (net.lastError ? "\n" + net.lastError : "");
  // サーバーにつながっていないときは、部屋のボタンを押せないようにする
  const online = net.status === "online";
  el("btnCreate").disabled = !online;
  el("btnJoinOpen").disabled = !online;
  el("titleServer").textContent = online
    ? "サーバーに接続しています"
    : "サーバーに接続していません（オンライン対戦には、サーバーの起動が必要です）";
};
Network.onSocket = socket => {
  Lobby.listen(socket);
  Online.listen(socket);
};
Network.onClock = (serverTime, sentAt, receivedAt) => Online.onClock(serverTime, sentAt, receivedAt);
Network.onConnected = () => Lobby.onConnected();
Network.connect("PLAYER");

// 壁の電光スコアボードと「3・2・1」
function updateWallBoard() {
  let info;
  let countdown = 0;
  if (mode === "online") {
    const s = Online.latest();
    if (!s) return;
    const names = Online.names();
    info = { nameA: names[1], nameB: names[-1], scoreA: s.score[0], scoreB: s.score[1], serve: s.phase === "gameover" ? 0 : s.server, label: "ONLINE MATCH" };
    countdown = s.countdown || 0;
  } else {
    const isPractice = mode === "practice";
    info = {
      nameA: isPractice ? "YOU" : "CPU A",
      nameB: isPractice ? "CPU" : "CPU B",
      scoreA: match.score[1],
      scoreB: match.score[-1],
      serve: match.phase === "gameover" ? 0 : match.server,
      label: isPractice ? "PRACTICE" : "TABLE TENNIS DUEL",
    };
    countdown = isPractice ? match.countdown : 0;
  }
  wallBoard.draw(info);
  showCountdown(countdown);
}

// ----- くり返し描画 -----
const clock = new THREE.Clock();
let menuTime = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  Input.enabled = !Settings.open && mode !== "menu";

  const me = sides[View.side];
  const opponent = sides[-View.side];

  if (mode === "menu") {
    // 後ろでCPU同士がデモ試合
    driveByCpu(sides[1].racket, demoCpu[1], dt);
    driveByCpu(sides[-1].racket, demoCpu[-1], dt);
    if (match.phase === "gameover") match.reset();
  } else if (mode === "practice") {
    Controls.update(dt, me.racket);
    driveByCpu(opponent.racket, cpu, dt);
  } else if (mode === "online") {
    Controls.update(dt, me.racket);
  }

  sides[1].racket.update(dt);
  sides[-1].racket.update(dt);

  if (mode === "online") {
    // オンライン：サーバーの状態を補間して表示。自分のラケットを送り、相手のラケットを動かす
    const view = Online.update(dt, me.racket, opponent.racket);
    ballView.setVisible(!!view);
    if (view) ballView.update(view);
  } else {
    sendRacket(1);
    sendRacket(-1);
    match.update(dt);
    handleEvents();
    ballView.setVisible(true);
    ballView.update(match.ball);
  }

  // 体と腕：メニューでは2人とも体を見せる。プレイ中は自分の体を隠して腕だけ見せる
  const showMyBody = mode === "menu";
  me.avatar.group.visible = showMyBody;
  me.avatar.arm.mesh.visible = showMyBody;
  opponent.avatar.group.visible = true;
  opponent.avatar.arm.mesh.visible = true;
  opponent.avatar.update(opponent.racket);
  if (showMyBody) me.avatar.update(me.racket);
  myArm.mesh.visible = !showMyBody;
  myArm.update(playerToWorld(View.side, 0.3, VIEW.eyeHeight - 0.32, -0.1), me.racket.handPosition());

  if (mode === "menu") {
    // ゆっくり台のまわりを回るカメラ
    menuTime += dt;
    const a = menuTime * 0.12;
    camera.position.set(Math.sin(a) * 4.2, 2.3, Math.cos(a) * 4.2);
    camera.lookAt(0, 0.8, 0);
  } else {
    View.update(camera, dt);
  }
  effects.update(dt);
  updateWallBoard();
  updatePowerMeter(me.racket);
  renderer.render(scene, camera);
  Input.endFrame();
}
updateScoreboard();
loop();
