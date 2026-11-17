// =====================================================
//  world.js ― 3D空間（光・浮島・足場・雲）を作る
// =====================================================

const World = {
  colliders: [],  // ぶつかる物のリスト（プレイヤーが乗ったり、ぶつかったりする）
  ramps: [],      // 坂道のリスト
  clouds: [],     // 動かす雲
  spinners: [],   // 回る飾り（風車など）
  floaters: [],   // ふわふわ動く飾り（気球・飛行船）
  sun: null,      // 太陽の光（影をつくる）
  spawnPoint: new THREE.Vector3(0, 0, 5), // スタート地点
  time: 0,

  create(scene) {
    this.createLights(scene);
    this.createDecorations(scene);
    // コース（足場と障害物）は course.js で作る
    return this;
  },

  // ----- 光 -----
  createLights(scene) {
    // 空と地面からのやわらかい光
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9ab8ff, 0.75);
    scene.add(hemi);

    // 太陽の光（影をつける）
    const sun = new THREE.DirectionalLight(0xfff2dd, 0.85);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // 遠くをかすませて奥行きを出す
    scene.fog = new THREE.Fog(0xcfeaff, 140, 520); // 遠くまで見えるようにして、広さを感じさせる
  },

  // ----- 箱の足場を置く（topY は上の面の高さ） -----
  addBlock(scene, x, topY, z, w, h, d, color) {
    const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, topY - h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // 上の面に明るい色の板をのせて、ポップに見せる
    const light = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35);
    const topMesh = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.04, 0.14, d + 0.04),
      new THREE.MeshStandardMaterial({ color: light, roughness: 0.5 })
    );
    topMesh.position.set(x, topY - 0.065, z);
    topMesh.receiveShadow = true;
    scene.add(topMesh);

    // ぶつかり判定用の箱（最小の角と最大の角）
    this.colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(x - w / 2, topY - h, z - d / 2),
        new THREE.Vector3(x + w / 2, topY, z + d / 2)
      ),
      mesh: mesh,
    });
    return mesh;
  },

  // ----- 坂道（奥＝z が小さい方へ向かって上る・下る） -----
  //   zNear・yNear：手前のはしの位置と高さ
  //   zFar・yFar  ：奥のはしの位置と高さ
  //   slide       ：坂の下へ引っぱられる強さ（大きいほどよく滑る）
  addRamp(scene, x, width, zNear, yNear, zFar, yFar, slide, color) {
    const dz = zNear - zFar;
    const dy = yNear - yFar;
    const length = Math.hypot(dz, dy);
    const thick = 0.6;
    const angle = -Math.asin(dy / length);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, thick, length),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.15, metalness: 0.1 })
    );
    mesh.rotation.x = angle;
    // 上の面がちょうど坂の高さに来るように、厚みの半分だけ下げる
    const normalY = Math.cos(angle);
    const normalZ = Math.sin(angle);
    mesh.position.set(
      x,
      (yNear + yFar) / 2 - normalY * thick / 2,
      (zNear + zFar) / 2 - normalZ * thick / 2
    );
    mesh.receiveShadow = true;
    scene.add(mesh);

    // 坂の上に白い矢印のしま模様（滑る方向が分かるように）
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    for (let i = 1; i < length / 3; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, 0.02, 0.4), stripeMat);
      stripe.position.set(0, thick / 2 + 0.01, -length / 2 + i * 3);
      mesh.add(stripe);
    }

    const ramp = {
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: zFar,
      maxZ: zNear,
      slide: slide,
      downhillZ: yFar < yNear ? -1 : 1, // 坂の下はどっち向きか
      heightAt(z) {
        const t = (zNear - z) / (zNear - zFar);
        return yNear + (yFar - yNear) * t;
      },
    };
    this.ramps.push(ramp);
    return ramp;
  },

  // ----- 足場のふちの柵（落ちにくくする＋遊園地っぽく見せる） -----
  //  mode："sides" … 左右だけ / "start" … 前以外の3辺 / "goal" … 手前以外の3辺
  addRails(scene, x, topY, z, w, d, mode) {
    const colors = [0xff5fa2, 0xffffff];
    const h = 0.7;
    const post = (px, pz, i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, h, 10),
        new THREE.MeshStandardMaterial({ color: colors[i % 2], roughness: 0.5 }));
      m.position.set(px, topY + h / 2, pz);
      m.castShadow = true;
      scene.add(m);
    };
    const rail = (cx, cz, len, alongX) => {
      const m = new THREE.Mesh(
        alongX ? new THREE.BoxGeometry(len, 0.25, 0.3) : new THREE.BoxGeometry(0.3, 0.25, len),
        new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4 }));
      m.position.set(cx, topY + h, cz);
      m.castShadow = true;
      scene.add(m);
      // ぶつかり判定（柵の高さまで）
      const hx = alongX ? len / 2 : 0.2;
      const hz = alongX ? 0.2 : len / 2;
      this.colliders.push({
        box: new THREE.Box3(new THREE.Vector3(cx - hx, topY, cz - hz), new THREE.Vector3(cx + hx, topY + h + 0.1, cz + hz)),
        mesh: m,
      });
      const n = Math.max(2, Math.round(len / 2.5));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len * i) / n;
        post(alongX ? cx + t : cx, alongX ? cz : cz + t, i);
      }
    };
    const hw = w / 2 - 0.2;
    const hd = d / 2 - 0.2;
    rail(x - hw, z, d - 0.4, false); // 左
    rail(x + hw, z, d - 0.4, false); // 右
    if (mode === "start") rail(x, z + hd, w - 0.4, true); // スタート島の後ろ
    if (mode === "goal") rail(x, z - hd, w - 0.4, true);  // ゴール島の奥
  },

  // ----- 浮島（上が草の箱 ＋ 下に岩のとがった部分） -----
  addIsland(scene, x, topY, z, w, d, color) {
    this.addBlock(scene, x, topY, z, w, 1.2, d, color);
    const rockH = Math.max(w, d) * 0.7;
    const rock = new THREE.Mesh(
      new THREE.ConeGeometry(w / Math.SQRT2, rockH, 4),
      new THREE.MeshStandardMaterial({ color: 0xb98b5e, roughness: 0.9, flatShading: true })
    );
    rock.rotation.y = Math.PI / 4; // 四角錐の向きを箱にそろえる
    rock.rotation.x = Math.PI;     // 下向きにする
    rock.scale.z = d / w;
    rock.position.set(x, topY - 1.2 - rockH / 2, z);
    scene.add(rock);
  },

  // ----- 木（ぶつかり判定は幹だけ） -----
  addTree(scene, x, groundY, z) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.3, 1.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x9c6b3f })
    );
    trunk.position.set(x, groundY + 0.7, z);
    trunk.castShadow = true;
    scene.add(trunk);

    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x4fc46a, roughness: 0.8, flatShading: true })
    );
    leaves.position.set(x, groundY + 2.1, z);
    leaves.castShadow = true;
    scene.add(leaves);

    this.colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(x - 0.3, groundY, z - 0.3),
        new THREE.Vector3(x + 0.3, groundY + 1.4, z + 0.3)
      ),
      mesh: trunk,
    });
  },

  // ----- 飾り（雲と遠くの島。ぶつからない） -----
  createDecorations(scene) {
    // 毎回同じ配置になるように、決まった順番の乱数を使う
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x333344, roughness: 1, flatShading: true,
    });
    for (let i = 0; i < 40; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rand() * 3);
      for (let j = 0; j < puffs; j++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 + rand() * 1.5, 0), cloudMat);
        puff.position.set(j * 2 - puffs, rand() * 1.2, rand() * 1.5);
        cloud.add(puff);
      }
      const side = rand() < 0.5 ? -1 : 1;
      cloud.position.set(side * (30 + rand() * 80), -20 + rand() * 40, 40 - rand() * 300);
      cloud.userData.baseY = cloud.position.y;
      cloud.userData.offset = rand() * 10;
      scene.add(cloud);
      this.clouds.push(cloud);
    }

    this.createBigScenery(scene, rand);

    // 遠くに浮かぶ島
    const farColors = [0x7ed957, 0xffd23f, 0xff9ecb, 0x8fe3ff];
    for (let i = 0; i < 16; i++) {
      const size = 5 + rand() * 6;
      const group = new THREE.Group();
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(size, size * 0.9, 1.2, 10),
        new THREE.MeshStandardMaterial({ color: farColors[i % 4], flatShading: true })
      );
      const rock = new THREE.Mesh(
        new THREE.ConeGeometry(size * 0.9, size * 1.4, 10),
        new THREE.MeshStandardMaterial({ color: 0xb98b5e, flatShading: true })
      );
      rock.rotation.x = Math.PI;
      rock.position.y = -0.6 - size * 0.7;
      group.add(top, rock);
      const side = i % 2 === 0 ? 1 : -1;
      group.position.set(side * (40 + rand() * 30), -15 + rand() * 20, 20 - i * 17);
      scene.add(group);
    }
  },

  // ----- (x, z) の真下にある足場の高さ（maxY より上の足場は無視）。なければ null -----
  // CPU が「この先に足場があるか」を調べるのに使う
  groundHeightAt(x, z, maxY) {
    let best = null;
    for (const c of this.colliders) {
      if (c.disabled) continue;
      const b = c.box;
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= maxY) {
        if (best === null || b.max.y > best) best = b.max.y;
      }
    }
    for (const r of this.ramps) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
        const y = r.heightAt(z);
        if (y <= maxY && (best === null || y > best)) best = y;
      }
    }
    return best;
  },

  // ----- 大きな背景（コースを広く・大きく感じさせる飾り。ぶつからない） -----
  createBigScenery(scene, rand) {
    const mat = (c, extra) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, flatShading: true }, extra || {}));
    const pop = [0xff5fa2, 0xffd23f, 0x5ccfe6, 0xb48cff, 0xffa94d, 0x7ed957];

    // 1. 下に広がる雲の海（空の上にいる感じ）
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 1 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -42, -110);
    scene.add(sea);
    const puffMat = mat(0xffffff, { emissive: 0x2a2a3a });
    for (let i = 0; i < 70; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + rand() * 10, 1), puffMat);
      puff.position.set((rand() - 0.5) * 500, -42 + rand() * 4, 120 - rand() * 520);
      puff.scale.y = 0.45;
      scene.add(puff);
    }

    // 2. 遠くにそびえる、巨大なカラフルな塔とアスレチック
    const towerSpots = [[-70, -40], [80, -70], [-90, -150], [95, -190], [-60, -260], [70, -300], [0, -330]];
    towerSpots.forEach(([x, z], i) => {
      const g = new THREE.Group();
      const h = 40 + rand() * 40;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(8, 11, h, 12), mat(pop[i % 6]));
      base.position.y = h / 2 - 40;
      g.add(base);
      // 塔のまわりのしま模様の輪
      for (let k = 0; k < 4; k++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(10.5 - k * 0.6, 1, 8, 24), mat(pop[(i + k + 1) % 6]));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -40 + h * (0.25 + k * 0.2);
        g.add(ring);
      }
      // てっぺんの円盤とドーム
      const top = new THREE.Mesh(new THREE.CylinderGeometry(16, 13, 3, 20), mat(0xffffff));
      top.position.y = h - 40;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(pop[(i + 2) % 6]));
      dome.position.y = h - 38.5;
      g.add(top, dome);
      // 回る風車（遠くでも動いているのが見える）
      const wheel = new THREE.Group();
      for (let b = 0; b < 4; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(2, 16, 0.6), mat(pop[(i + b) % 6]));
        blade.position.y = 8;
        const holder = new THREE.Group();
        holder.rotation.z = (b * Math.PI) / 2;
        holder.add(blade);
        wheel.add(holder);
      }
      wheel.position.set(0, h - 30, 9);
      g.add(wheel);
      this.spinners.push({ obj: wheel, speed: 0.5 + rand() * 0.6 });
      g.position.set(x, 0, z);
      g.lookAt(0, 0, z); // 風車をコースの方へ向ける
      scene.add(g);
    });

    // 3. 遠くに浮かぶ、ほかのステージ（チェック模様の大きな円形アリーナ）
    const arenaSpots = [[-120, -90, -8], [130, -130, -12], [-140, -230, -5], [120, 10, -15]];
    arenaSpots.forEach(([x, z, y], i) => {
      const g = new THREE.Group();
      for (let k = 0; k < 8; k++) {
        const slice = new THREE.Mesh(new THREE.CylinderGeometry(28, 28, 2, 16, 1, false, (k * Math.PI) / 4, Math.PI / 4),
          mat(k % 2 ? 0x8fd3ff : 0x5ccfe6));
        g.add(slice);
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(28, 1.2, 8, 40), mat(pop[i % 6]));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1;
      const under = new THREE.Mesh(new THREE.ConeGeometry(26, 30, 16), mat(0xb98b5e));
      under.rotation.x = Math.PI;
      under.position.y = -16;
      g.add(rim, under);
      g.position.set(x, y, z);
      scene.add(g);
    });

    // 4. 気球と飛行船（ゆっくり動く）
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const c = pop[i % 6];
      const balloon = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), mat(c));
      balloon.scale.y = 1.2;
      const stripe = new THREE.Mesh(new THREE.SphereGeometry(5.05, 16, 4, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.16), mat(0xffffff));
      stripe.scale.y = 1.2;
      const basket = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2.4), mat(0x9c6b3f));
      basket.position.y = -8;
      g.add(balloon, stripe, basket);
      const side = i % 2 === 0 ? -1 : 1;
      g.position.set(side * (45 + rand() * 60), 15 + rand() * 25, 30 - i * 40);
      scene.add(g);
      this.floaters.push({ obj: g, baseY: g.position.y, offset: rand() * 10, drift: 0 });
    }
    const blimp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 12), mat(0xffffff));
    body.scale.set(3, 1, 1);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(6.1, 6.1, 4, 20), mat(0xff5fa2));
    band.rotation.z = Math.PI / 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 0.6), mat(0x5ccfe6));
    fin.position.x = -16;
    blimp.add(body, band, fin);
    blimp.position.set(-60, 45, -120);
    scene.add(blimp);
    this.floaters.push({ obj: blimp, baseY: 45, offset: 0, drift: 2.5 });
  },

  // ----- 毎フレームの更新（雲をゆらゆら動かす） -----
  update(dt) {
    this.time += dt;
    for (const sp of this.spinners) sp.obj.rotation.z += sp.speed * dt;
    for (const f of this.floaters) {
      f.obj.position.y = f.baseY + Math.sin(this.time * 0.4 + f.offset) * 1.5;
      if (f.drift) {
        f.obj.position.x += f.drift * dt;
        if (f.obj.position.x > 160) f.obj.position.x = -160;
      }
    }
    for (const cloud of this.clouds) {
      cloud.position.y = cloud.userData.baseY + Math.sin(this.time * 0.5 + cloud.userData.offset) * 0.6;
    }
  },
};
