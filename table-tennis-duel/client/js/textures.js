// =====================================================
//  textures.js ― 画像ファイルを使わず、プログラムで模様（テクスチャ）を描く
// =====================================================

const Textures = {
  // キャンバスに描いて、Three.js で使える形にする
  make(width, height, draw) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext("2d"), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 8; // ななめから見てもぼやけにくくする
    return texture;
  },

  // 体育館の木の床（板が並んだ模様）
  woodFloor() {
    const tex = this.make(1024, 1024, (g, w, h) => {
      const plankW = 64;  // 板の幅
      let seed = 3;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let x = 0; x < w; x += plankW) {
        let y = -rand() * 400;
        while (y < h) {
          const len = 260 + rand() * 300;
          const tone = 150 + rand() * 30;
          g.fillStyle = `rgb(${tone + 40}, ${tone - 5}, ${tone - 60})`;
          g.fillRect(x, y, plankW, len);
          // 木目
          g.strokeStyle = "rgba(90, 50, 20, 0.12)";
          for (let i = 0; i < 6; i++) {
            const gx = x + 6 + rand() * (plankW - 12);
            g.beginPath();
            g.moveTo(gx, y);
            g.bezierCurveTo(gx + 4, y + len * 0.3, gx - 4, y + len * 0.6, gx + 2, y + len);
            g.stroke();
          }
          // 板のつなぎ目
          g.fillStyle = "rgba(60, 35, 15, 0.5)";
          g.fillRect(x, y, plankW, 2);
          y += len;
        }
        g.fillStyle = "rgba(60, 35, 15, 0.45)";
        g.fillRect(x, 0, 2, h);
      }
    });
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },

  // ネットの網目（すきまは透明）
  netMesh() {
    const tex = this.make(512, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "rgba(20, 30, 60, 0.9)";
      g.lineWidth = 2;
      for (let x = 0; x <= w; x += 8) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let y = 0; y <= h; y += 8) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
    });
    return tex;
  },

  // コートを囲むフェンス（文字入り）
  barrier(text) {
    return this.make(1024, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#1a2f6b");
      grad.addColorStop(1, "#0f1d45");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#ff8c1a";
      g.fillRect(0, h - 14, w, 14);
      g.fillStyle = "#ffffff";
      g.font = "bold 92px Helvetica, Arial, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, w / 2, h / 2 - 4);
    });
  },
};
