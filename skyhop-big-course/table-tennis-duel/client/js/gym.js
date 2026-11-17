// =====================================================
//  gym.js ― 体育館（床・壁・天井・照明・フェンス）を作る
// =====================================================

function createGym(scene) {
  const GYM_W = 24;   // 体育館の横幅
  const GYM_D = 34;   // 奥行き
  const GYM_H = 10;   // 天井の高さ

  // ----- 床（木目） -----
  const floorTex = Textures.woodFloor();
  floorTex.repeat.set(GYM_W / 4, GYM_D / 4);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(GYM_W, GYM_D),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ----- 台のまわりの競技用マット（えんじ色） -----
  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 14),
    new THREE.MeshStandardMaterial({ color: 0x7a2630, roughness: 0.85 })
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.003;
  mat.receiveShadow = true;
  scene.add(mat);

  // ----- コートを囲むフェンス -----
  const barrierTex = Textures.barrier("TABLE TENNIS DUEL");
  const barrierMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.6 });
  const plainMat = new THREE.MeshStandardMaterial({ color: 0x14244f, roughness: 0.6 });
  const addBarrier = (x, z, rotY) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 0.04), [plainMat, plainMat, plainMat, plainMat, barrierMat, barrierMat]);
    b.position.set(x, 0.35, z);
    b.rotation.y = rotY;
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
  };
  for (let x = -3; x <= 3; x += 2) {
    addBarrier(x, -7, 0);
    addBarrier(x, 7, 0);
  }
  for (let z = -6; z <= 6; z += 2) {
    addBarrier(-3.5, z, Math.PI / 2);
    addBarrier(3.5, z, Math.PI / 2);
  }

  // ----- 壁 -----
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 });
  const lowerMat = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.7 });
  const addWall = (w, x, z, rotY) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, GYM_H), wallMat);
    wall.position.set(x, GYM_H / 2, z);
    wall.rotation.y = rotY;
    wall.receiveShadow = true;
    scene.add(wall);
    // 下のほうは木の腰壁
    const lower = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.8), lowerMat);
    lower.position.set(x, 0.9, z);
    lower.rotation.y = rotY;
    lower.translateZ(0.01);
    scene.add(lower);
    // 上のほうの窓（明るく光る帯）
    const windows = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.85, 1.6),
      new THREE.MeshBasicMaterial({ color: 0xcfe6ff })
    );
    windows.position.set(x, GYM_H - 2, z);
    windows.rotation.y = rotY;
    windows.translateZ(0.02);
    scene.add(windows);
  };
  addWall(GYM_W, 0, -GYM_D / 2, 0);
  addWall(GYM_W, 0, GYM_D / 2, Math.PI);
  addWall(GYM_D, -GYM_W / 2, 0, Math.PI / 2);
  addWall(GYM_D, GYM_W / 2, 0, -Math.PI / 2);

  // ----- 天井と照明パネル -----
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(GYM_W, GYM_D),
    new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 1 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = GYM_H;
  scene.add(ceiling);
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0 });
  for (let x = -8; x <= 8; x += 4) {
    for (let z = -12; z <= 12; z += 4) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), panelMat);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(x, GYM_H - 0.01, z);
      scene.add(panel);
    }
  }

  // ----- 観客席（壁ぎわの段） -----
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2c3e66, roughness: 0.7 });
  [-1, 1].forEach(side => {
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4 * (i + 1), 20), seatMat);
      step.position.set(side * (GYM_W / 2 - 0.4 - i * 0.8), 0.2 * (i + 1), 0);
      step.receiveShadow = true;
      scene.add(step);
    }
  });

  // ----- 照明 -----
  // 部屋全体のやわらかい光
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x4a3a2a, 0.55));

  // 台の真上のメインライト（影をつくる）
  const main = new THREE.SpotLight(0xffffff, 1.1, 30, Math.PI / 5, 0.5, 1);
  main.position.set(0, 8, 0);
  main.target.position.set(0, 0, 0);
  main.castShadow = true;
  main.shadow.mapSize.set(2048, 2048);
  main.shadow.radius = 3; // 影のふちを少しぼかす
  main.shadow.camera.near = 2;
  main.shadow.camera.far = 12;
  main.shadow.bias = -0.0002;
  scene.add(main, main.target);

  // 両はしのプレイヤー側を照らすサブライト
  [-1, 1].forEach(side => {
    const sub = new THREE.SpotLight(0xfff4e0, 0.5, 25, Math.PI / 4, 0.6, 1);
    sub.position.set(0, 7, side * 6);
    sub.target.position.set(0, 0, side * 2);
    scene.add(sub, sub.target);
  });

  // ----- 奥行き：遠くを少しかすませる -----
  scene.background = new THREE.Color(0x2a2e35);
  scene.fog = new THREE.Fog(0x2a2e35, 18, 40);

  // ----- まわりの練習台（にぎやかに見せる飾り） -----
  [[-8, -8], [-8, 8], [8, -8], [8, 8]].forEach(([x, z]) => createTable(scene, x, z));

  // 練習台の上の照明
  [-8, 8].forEach(x => {
    const lamp = new THREE.PointLight(0xfff2dd, 0.35, 14, 2);
    lamp.position.set(x, 7, 0);
    scene.add(lamp);
  });

  // ----- 天井の梁（はり） -----
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6, metalness: 0.5 });
  for (let z = -14; z <= 14; z += 4) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(GYM_W, 0.3, 0.25), beamMat);
    beam.position.set(0, GYM_H - 0.6, z);
    scene.add(beam);
  }

  // ----- 壁の旗（色とりどりのバナー） -----
  const flagColors = [0xe63946, 0x1d3557, 0xf1c40f, 0x2a9d8f, 0xff8c1a, 0x6c5ce7];
  for (let i = 0; i < 6; i++) {
    [-1, 1].forEach(side => {
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 2.2),
        new THREE.MeshStandardMaterial({ color: flagColors[i], roughness: 0.9, side: THREE.DoubleSide })
      );
      flag.position.set(side * (GYM_W / 2 - 0.05), 5.2, -12.5 + i * 5);
      flag.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(flag);
    });
  }
}
