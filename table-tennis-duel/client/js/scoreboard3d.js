// =====================================================
//  scoreboard3d.js ― 体育館の壁にかかった電光スコアボード
//  両方のプレイヤーから見えるように、両はしの壁に1枚ずつかける
// =====================================================

class WallScoreboard {
  constructor(scene) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.last = "";

    const material = new THREE.MeshBasicMaterial({ map: this.texture });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.5, metalness: 0.4 });
    // 両はしの壁（プレイヤー1の正面＝奥の壁、プレイヤー2の正面＝手前の壁）
    [-1, 1].forEach(end => {
      const group = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.6, 0.2), frameMat);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.25), material);
      screen.position.z = 0.11;
      group.add(frame, screen);
      group.position.set(0, 5.6, end * 16.8);
      group.rotation.y = end === -1 ? 0 : Math.PI; // 台の方を向ける
      scene.add(group);
    });
    this.draw({ nameA: "PLAYER 1", nameB: "PLAYER 2", scoreA: 0, scoreB: 0, serve: 1, label: "TABLE TENNIS DUEL" });
  }

  // a … プレイヤー1、b … プレイヤー2
  draw(info) {
    const key = JSON.stringify(info);
    if (key === this.last) return; // 変わっていなければ描き直さない
    this.last = key;
    const g = this.canvas.getContext("2d");
    const W = this.canvas.width;
    const H = this.canvas.height;

    g.fillStyle = "#05070c";
    g.fillRect(0, 0, W, H);
    // 上の帯
    g.fillStyle = "#ff8c1a";
    g.fillRect(0, 0, W, 54);
    g.fillStyle = "#05070c";
    g.font = "bold 34px Helvetica, Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(info.label, W / 2, 28);

    // 名前
    g.font = "bold 40px Helvetica, Arial, sans-serif";
    g.fillStyle = "#ffffff";
    g.fillText(info.nameA, W * 0.25, 100);
    g.fillText(info.nameB, W * 0.75, 100);

    // 点数（電光掲示板ふうの黄色い数字）
    g.font = "bold 190px 'Courier New', monospace";
    g.fillStyle = "#ffd23f";
    g.shadowColor = "#ffb000";
    g.shadowBlur = 24;
    g.fillText(String(info.scoreA), W * 0.25, 250);
    g.fillText(String(info.scoreB), W * 0.75, 250);
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255, 255, 255, 0.4)";
    g.fillText("-", W / 2, 240);

    // サーブ権の印
    if (info.serve) {
      g.fillStyle = "#ff8c1a";
      g.beginPath();
      g.arc(info.serve === 1 ? W * 0.25 : W * 0.75, 355, 12, 0, Math.PI * 2);
      g.fill();
    }
    this.texture.needsUpdate = true;
  }
}
