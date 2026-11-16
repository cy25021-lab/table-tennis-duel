// =====================================================
//  effects.js ― 紙吹雪などの演出
// =====================================================

const Effects = {
  confetti: [],
  colors: [0xff5fa2, 0xffe45c, 0x3ddc84, 0x5ccfe6, 0xb48cff, 0xff8a3d],

  // 紙吹雪を先にまとめて作っておく（毎回作ると重くなるので使い回す）
  init(scene) {
    const geometry = new THREE.PlaneGeometry(0.18, 0.28);
    for (let i = 0; i < 220; i++) {
      const piece = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: this.colors[i % this.colors.length], side: THREE.DoubleSide })
      );
      piece.visible = false;
      piece.userData = { life: 0, velocity: new THREE.Vector3(), spin: new THREE.Vector3() };
      scene.add(piece);
      this.confetti.push(piece);
    }
  },

  // position の場所から紙吹雪を count 枚ばらまく
  burst(position, count, power) {
    let made = 0;
    for (const piece of this.confetti) {
      if (made >= count) break;
      if (piece.userData.life > 0) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = power * (0.4 + Math.random() * 0.6);
      piece.position.copy(position);
      piece.userData.velocity.set(
        Math.cos(angle) * speed,
        power * (0.8 + Math.random() * 0.8),
        Math.sin(angle) * speed
      );
      piece.userData.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      piece.userData.life = 2 + Math.random();
      piece.visible = true;
      made++;
    }
  },

  update(dt) {
    for (const piece of this.confetti) {
      const d = piece.userData;
      if (d.life <= 0) continue;
      d.life -= dt;
      d.velocity.y -= 9 * dt;                     // ゆっくり落ちる
      d.velocity.multiplyScalar(Math.exp(-1.5 * dt)); // 空気でだんだん遅くなる
      piece.position.addScaledVector(d.velocity, dt);
      piece.rotation.x += d.spin.x * dt;          // ひらひら回る
      piece.rotation.y += d.spin.y * dt;
      piece.rotation.z += d.spin.z * dt;
      if (d.life <= 0) piece.visible = false;
    }
  },
};
