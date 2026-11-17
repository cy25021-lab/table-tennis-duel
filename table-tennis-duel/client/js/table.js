// =====================================================
//  table.js ― 卓球台とネットを作る
// =====================================================

// x, z … 置く場所（省略すると体育館の真ん中）
function createTable(scene, x, z) {
  const group = new THREE.Group();
  group.position.set(x || 0, 0, z || 0);
  const T = TABLE;
  const topY = T.height;               // 台の上の面の高さ
  const halfL = T.length / 2;
  const halfW = T.width / 2;

  // ----- 天板（青） -----
  const topMat = new THREE.MeshStandardMaterial({ color: 0x1b4f8f, roughness: 0.5, metalness: 0.0 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(T.width, T.thickness, T.length), topMat);
  top.position.y = topY - T.thickness / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  // ----- 白いライン -----
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const lineY = topY + 0.0008; // 天板のほんの少し上（ちらつき防止）
  const addLine = (w, d, x, z) => {
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.0012, d), lineMat);
    line.position.set(x, lineY, z);
    line.receiveShadow = true;
    group.add(line);
  };
  addLine(T.lineWidth, T.length, -halfW + T.lineWidth / 2, 0);  // 左のサイドライン
  addLine(T.lineWidth, T.length, halfW - T.lineWidth / 2, 0);   // 右のサイドライン
  addLine(T.width, T.lineWidth, 0, -halfL + T.lineWidth / 2);   // 奥のエンドライン
  addLine(T.width, T.lineWidth, 0, halfL - T.lineWidth / 2);    // 手前のエンドライン
  addLine(0.004, T.length, 0, 0);                               // センターライン（ダブルス用）

  // ----- 天板のふち（黒っぽい側面） -----
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x14243d, roughness: 0.6 });
  const apronH = 0.06;
  [-1, 1].forEach(side => {
    const apronSide = new THREE.Mesh(new THREE.BoxGeometry(0.02, apronH, T.length - 0.1), edgeMat);
    apronSide.position.set(side * (halfW - 0.06), topY - T.thickness - apronH / 2, 0);
    group.add(apronSide);
    const apronEnd = new THREE.Mesh(new THREE.BoxGeometry(T.width - 0.1, apronH, 0.02), edgeMat);
    apronEnd.position.set(0, topY - T.thickness - apronH / 2, side * (halfL - 0.06));
    group.add(apronEnd);
  });

  // ----- 脚（金属のフレーム） -----
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.35, metalness: 0.7 });
  const legH = topY - T.thickness - 0.08;
  [-1, 1].forEach(sz => {
    // 台は2つに分かれていて、それぞれに脚がある
    const zCenter = sz * halfL / 2;
    [-1, 1].forEach(sx => {
      [-1, 1].forEach(dz => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, legH, 12), legMat);
        leg.position.set(sx * (halfW - 0.15), 0.08 + legH / 2, zCenter + dz * 0.45);
        leg.castShadow = true;
        group.add(leg);
        // 足もとのキャスター
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), legMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx * (halfW - 0.15), 0.04, zCenter + dz * 0.45);
        group.add(wheel);
      });
      // 前後の脚をつなぐ棒
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.9), legMat);
      bar.position.set(sx * (halfW - 0.15), 0.22, zCenter);
      group.add(bar);
    });
    // 左右をつなぐ棒
    const cross = new THREE.Mesh(new THREE.BoxGeometry(T.width - 0.3, 0.03, 0.03), legMat);
    cross.position.set(0, 0.22, zCenter);
    group.add(cross);
  });

  // ----- ネット -----
  const netLen = T.width + T.netOverhang * 2;
  const netTex = Textures.netMesh();
  netTex.wrapS = THREE.RepeatWrapping;
  netTex.repeat.set(4, 1);
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(netLen, T.netHeight - 0.015),
    new THREE.MeshStandardMaterial({
      map: netTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.8,
    })
  );
  net.position.set(0, topY + (T.netHeight - 0.015) / 2, 0);
  net.castShadow = true;
  group.add(net);

  // ネットの上の白いテープ
  const tape = new THREE.Mesh(
    new THREE.BoxGeometry(netLen, 0.015, 0.006),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
  );
  tape.position.set(0, topY + T.netHeight - 0.0075, 0);
  group.add(tape);

  // ネットを支える支柱（左右）
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.4, metalness: 0.6 });
  [-1, 1].forEach(side => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, T.netHeight, 0.02), postMat);
    post.position.set(side * (netLen / 2), topY + T.netHeight / 2, 0);
    post.castShadow = true;
    group.add(post);
    // 台をはさむクランプ
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), postMat);
    clamp.position.set(side * (halfW + 0.02), topY - 0.02, 0);
    group.add(clamp);
    // クランプから支柱までの腕
    const armLen = netLen / 2 - halfW;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.015, 0.02), postMat);
    arm.position.set(side * (halfW + armLen / 2), topY + 0.005, 0);
    group.add(arm);
  });

  scene.add(group);
  return group;
}
