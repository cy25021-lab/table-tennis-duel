// =====================================================
//  effects.js ― 演出（打った瞬間の光と火花、バウンドの波紋）
//  使い回せるように、最初にまとめて作っておく
// =====================================================

class Effects {
  constructor(scene) {
    // 光の輪（打った瞬間・バウンド）
    this.rings = [];
    for (let i = 0; i < 12; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.7, 1, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.visible = false;
      ring.userData = { life: 0, maxLife: 1, size: 1 };
      scene.add(ring);
      this.rings.push(ring);
    }
    // 火花（小さな光の粒）
    this.sparks = [];
    for (let i = 0; i < 60; i++) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false })
      );
      spark.visible = false;
      spark.userData = { life: 0, vel: new THREE.Vector3() };
      scene.add(spark);
      this.sparks.push(spark);
    }
  }

  // 光の輪を1つ出す（flat = true なら台の上に寝かせる）
  ring(pos, color, size, life, flat, facingZ) {
    const ring = this.rings.find(r => r.userData.life <= 0);
    if (!ring) return;
    ring.position.set(pos[0], pos[1], pos[2]);
    ring.rotation.set(flat ? -Math.PI / 2 : 0, facingZ ? 0 : 0, 0);
    ring.material.color.set(color);
    ring.userData = { life: life, maxLife: life, size: size };
    ring.visible = true;
  }

  // 打った瞬間
  hit(pos, power, smash) {
    const color = smash ? 0xff5a36 : 0xffffff;
    this.ring(pos, color, 0.12 + power * 0.18 + (smash ? 0.15 : 0), 0.25, false);
    const count = Math.round(6 + power * 10 + (smash ? 12 : 0));
    let made = 0;
    for (const s of this.sparks) {
      if (made >= count) break;
      if (s.userData.life > 0) continue;
      s.position.set(pos[0], pos[1], pos[2]);
      const speed = 0.8 + Math.random() * (1.5 + power * 2);
      s.userData.vel.set((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(speed);
      s.userData.life = 0.25 + Math.random() * 0.2;
      s.material.color.set(smash ? 0xff7a40 : 0xffd27a);
      s.visible = true;
      made++;
    }
  }

  // 台で跳ねたとき（台の上に広がる波紋）
  bounce(pos) {
    this.ring([pos[0], Physics.C.TABLE_TOP + 0.003, pos[2]], 0xffffff, 0.09, 0.35, true);
  }

  update(dt) {
    for (const r of this.rings) {
      const d = r.userData;
      if (d.life <= 0) continue;
      d.life -= dt;
      const t = 1 - Math.max(0, d.life) / d.maxLife; // 0 → 1
      const s = d.size * (0.3 + t);
      r.scale.set(s, s, s);
      r.material.opacity = (1 - t) * 0.8;
      if (d.life <= 0) r.visible = false;
    }
    for (const s of this.sparks) {
      const d = s.userData;
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vel.y -= 6 * dt;
      s.position.addScaledVector(d.vel, dt);
      s.material.opacity = Math.min(1, d.life * 4);
      if (d.life <= 0) s.visible = false;
    }
  }
}
