// =====================================================
//  main.js ― 全体をまとめて動かす（ゲームのスタート地点）
// =====================================================

// ----- 1. 描画の準備 -----
const container = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha: 背景を透明にしてCSSの空を見せる
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

// ----- 2. 世界・コース・キャラクター・演出を作る -----
const world = World.create(scene);
Course.build(scene, world);
const player = new Player(scene, world.spawnPoint, { name: "YOU", isHuman: true });
player.startOffset = new THREE.Vector3(0, 0, 0);

// CPU を5人作る（スタート位置を横と後ろにずらして並べる）
const botOffsets = [
  new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 0, 0),
  new THREE.Vector3(-2.5, 0, 2), new THREE.Vector3(2.5, 0, 2), new THREE.Vector3(0, 0, 2.5),
];
const bots = BOT_PROFILES.map((profile, i) => {
  const racer = new Player(scene, world.spawnPoint, Object.assign({ isHuman: false }, profile));
  racer.startOffset = botOffsets[i];
  racer.spawnPoint.add(racer.startOffset);
  racer.respawn(false);
  return new Bot(racer, profile.skill);
});
const racers = [player].concat(bots.map(b => b.racer)); // 自分＋CPU

// モード：solo（ひとりで、CPUと）/ online（みんなでオンライン）
let mode = "solo";
let raceStartAt = 0; // オンラインのスタート時刻（サーバーの時計）

// 今のモードで、この画面の中で動かすキャラ（オンラインでは自分だけ。ほかの人は online.js が表示）
function activeRacers() {
  return mode === "online" ? [player] : racers;
}
Effects.init(scene);
Input.init(renderer.domElement);
UI.init(Course.startPoint.z, Course.goal.z, Course.checkpoints.map(cp => cp.z));

// ----- 3. ゲームの状態 -----
//   title     … スタート画面
//   countdown … 3・2・1・GO!
//   playing   … プレイ中（タイマーが進む）
//   finished  … ゴールした
const game = {
  state: "title",
  time: 0,           // クリアタイム（秒）
  falls: 0,          // 落ちた回数
  countdown: 0,
  lastCount: 0,
  celebrateTimer: 0, // ゴール後の演出用
  resultTimer: 0,
  best: loadBest(),
};

// ベストタイムをブラウザに保存・読み込み（使えない環境ではスキップ）
function loadBest() {
  try {
    const value = parseFloat(localStorage.getItem("skyHopBest"));
    return isNaN(value) ? null : value;
  } catch (err) {
    return null;
  }
}

function saveBest(time) {
  try {
    localStorage.setItem("skyHopBest", String(time));
  } catch (err) {
    // 保存できなくてもゲームは続ける
  }
}

UI.setTitleBest(game.best);
UI.setCheckpoint(0, Course.checkpoints.length);

// ----- 4. スタート・リスタート -----
function startRun() {
  if (mode === "online") return; // オンラインでは、スタートはホストが決める
  bots.forEach(bot => bot.racer.setVisible(true));
  player.startOffset = new THREE.Vector3(0, 0, 0);
  Course.restart(racers);
  bots.forEach(bot => bot.reset());
  game.state = "countdown";
  game.time = 0;
  game.falls = 0;
  game.countdown = 3;
  game.lastCount = 4;
  game.resultTimer = 0;
  racers.forEach(r => { r.frozen = true; });
  UI.hideResults();
  UI.setTime(0);
  UI.setFalls(0);
  UI.setCheckpoint(0, Course.checkpoints.length);
}

document.getElementById("startBtn").addEventListener("click", e => {
  Sound.init();
  Sound.startMusic();
  Input.requestLock(renderer.domElement);
  UI.hideStart();
  e.target.blur();
  startRun();
});

document.getElementById("retryBtn").addEventListener("click", e => {
  e.target.blur();
  if (mode === "online") {
    if (Online.isHost()) Online.backToLobby(); // ホスト：みんなで待合室へ
    return;
  }
  Input.requestLock(renderer.domElement);
  startRun();
});

// ----- オンライン対戦の準備 -----
// サーバーが決めたスタート時刻に合わせて、カウントダウンを始める
function startOnlineRace(slot, startAt) {
  mode = "online";
  raceStartAt = startAt;
  Sound.init();
  Sound.startMusic();
  bots.forEach(bot => bot.racer.setVisible(false));
  player.startOffset = slotOffset(slot);
  Course.restart([player]);
  game.state = "countdown";
  game.time = 0;
  game.falls = 0;
  game.lastCount = 4;
  game.resultTimer = 0;
  player.frozen = true;
  UI.hideStart();
  UI.hideResults();
  UI.setTime(0);
  UI.setFalls(0);
  UI.setCheckpoint(0, Course.checkpoints.length);
  Input.requestLock(renderer.domElement);
}

Online.init(scene, {
  onRaceStart: startOnlineRace,
  onRanking: list => {
    if (game.state === "finished") UI.setRanking(list);
  },
  onResults: list => {
    UI.setRanking(list);
    document.getElementById("retryBtn").textContent = Online.isHost() ? "待合室に戻る（みんな）" : "ホストを待っています";
    document.getElementById("retryBtn").disabled = !Online.isHost();
  },
  onLobby: () => {
    game.state = "title";
    UI.hideResults();
  },
  onLeave: () => {
    mode = "solo";
    game.state = "title";
    UI.hideResults();
    document.getElementById("startScreen").classList.remove("hidden");
  },
});
Obstacles.onTileTrigger = id => {
  if (mode === "online" && Online.inRace && Online.connected) Online.socket.emit("race:tile", { id: id });
};

// ----- 5. コースからの知らせ -----
Course.onCheckpoint = cp => {
  const passed = Course.checkpoints.filter(c => c.active).length;
  UI.setCheckpoint(passed, Course.checkpoints.length);
  UI.toast("CHECKPOINT " + cp.number + "!", "#3ddc84");
  Effects.burst(new THREE.Vector3(cp.x, cp.y + 4.5, cp.z), 50, 6);
};

Course.onGoal = racer => {
  racer.finishTime = game.time;
  if (!racer.isHuman) return; // CPU のゴールは記録だけ
  if (mode === "online") {
    // タイムはサーバーの時計で決まる（届いたらそのタイムにそろえる）
    Online.finish().then(res => {
      if (res && res.ok) {
        game.time = res.ms / 1000;
        UI.setTime(game.time);
      }
    });
  }
  game.state = "finished";
  player.frozen = true;
  game.celebrateTimer = 0;
  game.resultTimer = 1.8; // 少し喜んでから結果を出す
  UI.toast("GOAL!!", "#ffe45c");
  const g = Course.goal;
  Effects.burst(new THREE.Vector3(g.x - 3, g.y + 5, g.z), 70, 8);
  Effects.burst(new THREE.Vector3(g.x + 3, g.y + 5, g.z), 70, 8);
};

player.onFall = () => {
  if (game.state === "playing") {
    game.falls++;
    UI.setFalls(game.falls);
  }
};

// ウィンドウの大きさが変わったら画面を合わせる
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----- 6. 状態ごとの処理 -----
function updateGame(dt) {
  if (mode === "online" && (game.state === "countdown" || game.state === "playing")) {
    // オンライン：残り時間とタイムは、サーバーのスタート時刻から計算する（全員そろう）
    const elapsed = (Online.serverNow() - raceStartAt) / 1000;
    if (game.state === "countdown") game.countdown = -elapsed;
    else game.time = elapsed;
  }
  if (game.state === "countdown") {
    if (mode !== "online") game.countdown -= dt;
    const n = Math.ceil(game.countdown);
    if (n !== game.lastCount && n > 0) {
      game.lastCount = n;
      UI.showCount(String(n));
      Sound.count();
    }
    if (game.countdown <= 0) {
      game.state = "playing";
      racers.forEach(r => { r.frozen = false; });
      UI.showCount("GO!");
      Sound.go();
    }
  } else if (game.state === "playing") {
    if (mode !== "online") game.time += dt;
    UI.setTime(game.time);
  } else if (game.state === "finished") {
    // その場でピョンピョン跳ねて喜ぶ
    game.celebrateTimer -= dt;
    if (player.grounded && game.celebrateTimer <= 0) {
      player.velocity.y = 7;
      player.squash = 1.3;
      game.celebrateTimer = 0.7;
      Effects.burst(new THREE.Vector3(player.position.x, player.position.y + 2, player.position.z), 15, 4);
    }
    // 結果画面を出す
    if (game.resultTimer > 0) {
      game.resultTimer -= dt;
      if (game.resultTimer <= 0) showResults();
    }
  }
}

function showResults() {
  const isNewRecord = game.best === null || game.time < game.best;
  if (isNewRecord) {
    game.best = game.time;
    saveBest(game.time);
  }
  if (document.exitPointerLock) document.exitPointerLock(); // ボタンを押せるようにマウスの固定を外す
  UI.showResults(game.time, game.falls, game.best, isNewRecord);
  if (mode === "online") {
    UI.setRanking(Online.ranking(player));
    const btn = document.getElementById("retryBtn");
    btn.textContent = "みんなのゴールを待っています…";
    btn.disabled = true;
  } else {
    UI.setRanking(getRanking());
    document.getElementById("retryBtn").textContent = "もう一度あそぶ";
    document.getElementById("retryBtn").disabled = false;
  }
  UI.setTitleBest(game.best);
}

// ----- 順位 -----
// ゴールした人はタイム順、まだの人はコースの先にいる順（z が小さいほど先）
function getRanking() {
  return racers.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return a.position.z - b.position.z;
  });
}

// キャラ同士が重ならないように押し合う
function separateRacers() {
  const minDist = PLAYER_CONFIG.radius * 2;
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i].position;
      const b = racers[j].position;
      if (Math.abs(a.y - b.y) > 1.4) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.0001 && dist < minDist) {
        const push = (minDist - dist) / 2;
        a.x -= (dx / dist) * push;
        a.z -= (dz / dist) * push;
        b.x += (dx / dist) * push;
        b.z += (dz / dist) * push;
      }
    }
  }
}

// ----- 7. ゲームループ（1秒間に約60回くり返す） -----
const clock = new THREE.Clock();
const sunOffset = new THREE.Vector3(15, 30, 10);

function gameLoop() {
  requestAnimationFrame(gameLoop);
  // 前のフレームからの経過時間（重いときに大きくなりすぎないように上限をつける）
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const active = game.state !== "title";

  if (active && Input.wasPressed("KeyR")) {
    if (mode === "online") player.respawn(true); // オンライン：最後のチェックポイントに戻る
    else startRun();                             // ひとりで：最初からやり直し
  }
  if (Input.wasPressed("KeyM")) {
    const muted = Sound.toggleMute();
    UI.toast(muted ? "SOUND OFF" : "SOUND ON", "#ffffff");
  }

  // 障害物を動かす（プレイヤーより先に動かすと、動く足場に乗ったときズレない）
  // オンラインでは、障害物の動きをサーバーのスタート時刻からの時間でそろえる
  const raceTime = mode === "online" && Online.inRace ? (Online.serverNow() - raceStartAt) / 1000 : undefined;
  Obstacles.update(dt, active ? activeRacers() : [], raceTime);
  if (active) {
    player.update(dt, getHumanControls(CameraController.yaw), world.colliders, world.ramps);
    if (mode === "solo") {
      for (const bot of bots) {
        bot.racer.update(dt, bot.think(dt, Course.waypoints, world), world.colliders, world.ramps);
      }
      separateRacers();
    } else {
      Online.separate(player);
    }
  }
  if (mode === "online") Online.update(dt, player, world.colliders, world.ramps);
  Course.update(dt, game.state === "playing" || game.state === "finished" ? activeRacers() : []);
  updateGame(dt);

  // 順位の表示
  if (active) {
    if (mode === "online") {
      const ranking = Online.ranking(player);
      UI.setRank(ranking.findIndex(r => r.isHuman) + 1, ranking.length);
    } else {
      const ranking = getRanking();
      UI.setRank(ranking.indexOf(player) + 1, racers.length);
      if (game.state === "finished") UI.setRanking(ranking); // 結果画面の順位表も更新し続ける
    }
  }

  world.update(dt);
  Effects.update(dt);
  CameraController.update(camera, player.position, dt);
  UI.setProgress(player.position.z);
  UI.setMouseHint(active && game.state !== "finished" && !Input.locked);

  // 太陽をキャラについて行かせる（どこにいても影がつくように）
  world.sun.position.copy(player.position).add(sunOffset);
  world.sun.target.position.copy(player.position);

  renderer.render(scene, camera);
  Input.endFrame();
}

gameLoop();
