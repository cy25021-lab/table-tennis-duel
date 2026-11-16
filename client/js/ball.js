// =====================================================
//  ball.js ― ボールの見た目（本体・影・残像）
//  ボールの動きの計算は shared/physics.js がする。ここは「描くだけ」
// =====================================================

class BallView {
  constructor(scene) {
    const R = Physics.C.R;

    // ボール本体（オレンジ）
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.35, emissive: 0x401800 })
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    // 真下の丸い影（小さいボールでも位置が分かりやすいように）
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(R * 1.2, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);

    // 残像（速い球でも見失わないように）
    this.trail = [];
    for (let i = 0; i < 8; i++) {
      const ghost = new THREE.Mesh(
        new THREE.SphereGeometry(R * (1 - i * 0.08), 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.3 * (1 - i / 8), depthWrite: false })
      );
      scene.add(ghost);
      this.trail.push(ghost);
    }
    this.history = [];
  }

  setVisible(visible) {
    this.mesh.visible = visible;
    this.shadow.visible = visible;
    if (!visible) this.trail.forEach(g => { g.visible = false; });
  }

  update(ball) {
    const p = ball.pos;
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.rotation.x += ball.spin.x * 0.002; // 回転を少しだけ見せる
    this.mesh.rotation.y += ball.spin.y * 0.002;

    // 影：台の上なら台の面、そうでなければ床
    const C = Physics.C;
    const overTable = Math.abs(p.x) <= C.TABLE_W / 2 && Math.abs(p.z) <= C.TABLE_L / 2 && p.y >= C.TABLE_TOP;
    const groundY = overTable ? C.TABLE_TOP + 0.002 : 0.006;
    this.shadow.position.set(p.x, groundY, p.z);
    const h = Math.max(0, p.y - groundY);
    this.shadow.material.opacity = Math.max(0.08, 0.4 - h * 0.25);

    // 残像
    this.history.unshift({ x: p.x, y: p.y, z: p.z });
    if (this.history.length > this.trail.length * 2) this.history.pop();
    this.trail.forEach((ghost, i) => {
      const h2 = this.history[(i + 1) * 2];
      ghost.visible = !!h2;
      if (h2) ghost.position.set(h2.x, h2.y, h2.z);
    });
  }
}
