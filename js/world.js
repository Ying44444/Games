/* Procedural world: sky, highway chunks, terrain, vegetation, weather visuals. */
(function () {
  'use strict';
  const RG = window.RG;
  const CHUNK_LEN = 120;
  const CHUNK_COUNT = 8;
  const TEX_LEN = 24;

  class World {
    constructor(scene, renderer, quality) {
      this.scene = scene;
      this.renderer = renderer;
      this.quality = quality || { mobile: false, shadowSize: 2048 };
      this.chunks = [];
      this.maxChunkEnd = 0;
      this.sunDir = new THREE.Vector3(0.45, 0.72, 0.52).normalize();
      this.time = 0;
      this.boltTime = 0;
      this.envMap = null;

      scene.fog = new THREE.FogExp2(0x9fc0d5, 0.0014);
      scene.background = new THREE.Color(0x9fc0d5);

      this.createEnvironment();
      this.createLights();
      this.createSky();
      this.createMaterials();
      this.initChunks(0);
      this.createVegetation();
      this.createRain();
      this.createLightning();
      this.createGantries();
    }

    /* ---------------- environment / lighting ---------------- */
    createEnvironment() {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      const sky = ctx.createLinearGradient(0, 0, 0, 512);
      sky.addColorStop(0, '#2c5f8d');
      sky.addColorStop(0.42, '#87b1cb');
      sky.addColorStop(0.52, '#d4dfdc');
      sky.addColorStop(0.58, '#77765f');
      sky.addColorStop(1, '#21231f');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 1024, 512);
      const sun = ctx.createRadialGradient(700, 178, 4, 700, 178, 130);
      sun.addColorStop(0, 'rgba(255,248,220,1)');
      sun.addColorStop(0.08, 'rgba(255,244,205,.7)');
      sun.addColorStop(0.4, 'rgba(255,220,155,.18)');
      sun.addColorStop(1, 'rgba(255,220,155,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, 1024, 512);
      ctx.globalAlpha = 0.12;
      for (let i = 0; i < 75; i++) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(Math.random() * 1024, 40 + Math.random() * 190, RG.rand(20, 100), RG.rand(4, 18), 0, 0, RG.TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const tex = new THREE.CanvasTexture(canvas);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        pmrem.compileEquirectangularShader();
        this.envMap = pmrem.fromEquirectangular(tex).texture;
        pmrem.dispose();
      } catch (err) {
        console.warn('Could not generate environment map:', err);
        this.envMap = tex;
      }
      tex.dispose();
    }

    createLights() {
      const sun = new THREE.DirectionalLight(0xfff0ca, 3.1);
      sun.position.set(80, 130, 90);
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
      sun.shadow.camera.left = -92;
      sun.shadow.camera.right = 92;
      sun.shadow.camera.top = 92;
      sun.shadow.camera.bottom = -92;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 310;
      sun.shadow.bias = -0.00035;
      sun.shadow.normalBias = 0.035;
      sun.shadow.radius = 2.5;
      this.scene.add(sun);
      this.scene.add(sun.target);
      this.sun = sun;

      const hemi = new THREE.HemisphereLight(0xa8d5f5, 0x656343, 1.3);
      this.scene.add(hemi);
      this.hemi = hemi;

      const ambient = new THREE.AmbientLight(0x7f8c96, 0.24);
      this.scene.add(ambient);
      this.ambient = ambient;
    }

    createSky() {
      const uniforms = {
        uTopColor: { value: new THREE.Color(0x1e5d9b) },
        uHorizonColor: { value: new THREE.Color(0xbcd8e6) },
        uCloudColor: { value: new THREE.Color(0xdde8ea) },
        uSunColor: { value: new THREE.Color(0xfff0ca) },
        uSunDirection: { value: this.sunDir.clone() },
        uCloudCover: { value: 0.18 },
        uCloudDark: { value: 0.06 },
        uTime: { value: 0 },
        uFlash: { value: 0 }
      };
      const vertexShader = `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;
      const fragmentShader = `
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uCloudColor;
        uniform vec3 uSunColor;
        uniform vec3 uSunDirection;
        uniform float uCloudCover;
        uniform float uCloudDark;
        uniform float uTime;
        uniform float uFlash;
        varying vec3 vDir;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += noise(p) * a;
            p = p * 2.03 + vec2(17.1, 9.2);
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.62));

          float sunAmt = max(dot(dir, normalize(uSunDirection)), 0.0);
          col += uSunColor * pow(sunAmt, 120.0) * 0.42;
          col += uSunColor * smoothstep(0.9995, 0.9999, sunAmt) * 1.3;

          vec2 cloudUv = dir.xz / (max(dir.y, 0.025) + 0.24);
          float n1 = fbm(cloudUv * 1.35 + vec2(uTime * 0.004, uTime * 0.0018));
          float n2 = fbm(cloudUv * 3.35 - vec2(uTime * 0.007, 0.0));
          float shape = n1 * 0.73 + n2 * 0.27;
          float cover = smoothstep(0.78 - uCloudCover * 0.48, 0.98 - uCloudCover * 0.24, shape);
          cover *= smoothstep(0.0, 0.14, dir.y);
          vec3 cloud = mix(uCloudColor * 1.35, uCloudColor * 0.43, n2 + uCloudDark * 0.6);
          cloud += uSunColor * pow(sunAmt, 8.0) * 0.12 * (1.0 - uCloudDark);
          col = mix(col, cloud, cover * (0.5 + uCloudCover * 0.45));

          col = mix(col, uHorizonColor, (1.0 - smoothstep(0.0, 0.16, dir.y)) * 0.58);
          if (dir.y < 0.0) col = mix(col, uHorizonColor * 0.64, clamp(-dir.y * 3.5, 0.0, 1.0));
          col += uFlash * vec3(0.63, 0.72, 0.9);

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `;
      this.skyUniforms = uniforms;
      this.skyMat = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
      });
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 20), this.skyMat);
      this.sky.frustumCulled = false;
      this.sky.renderOrder = -10;
      this.scene.add(this.sky);
    }

    createMaterials() {
      const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.asphaltTex = RG.createAsphaltTexture(aniso);
      this.asphaltRough = RG.createAsphaltRoughness();
      this.gravelTex = RG.createGravelTexture(aniso);
      this.grassTex = RG.createGrassTexture(aniso);
      this.glowTex = RG.createGlowTexture();

      this.roadMat = new THREE.MeshStandardMaterial({
        map: this.asphaltTex,
        roughnessMap: this.asphaltRough,
        roughness: 0.8,
        metalness: 0.08,
        color: 0xffffff,
        envMap: this.envMap,
        envMapIntensity: 0.35,
        dithering: true
      });
      this.shoulderMat = new THREE.MeshStandardMaterial({
        map: this.gravelTex,
        roughness: 0.98,
        metalness: 0.02,
        color: 0xa2a29a
      });
      this.railMat = new THREE.MeshStandardMaterial({
        color: 0x747b7d,
        roughness: 0.43,
        metalness: 0.76,
        envMap: this.envMap,
        envMapIntensity: 0.55,
        side: THREE.DoubleSide
      });
      this.markerMat = new THREE.MeshStandardMaterial({ color: 0x7b3521, roughness: 0.9 });
      this.postMat = new THREE.MeshStandardMaterial({
        color: 0x373e40,
        roughness: 0.62,
        metalness: 0.55
      });
      this.terrainMat = new THREE.MeshStandardMaterial({
        map: this.grassTex,
        bumpMap: this.grassTex,
        bumpScale: 0.32,
        vertexColors: true,
        roughness: 0.94,
        metalness: 0.0,
        side: THREE.DoubleSide
      });
      this.lampMat = new THREE.MeshStandardMaterial({
        color: 0x2e3436,
        roughness: 0.55,
        metalness: 0.65
      });
      this.bulbMat = new THREE.MeshStandardMaterial({
        color: 0xffdda0,
        emissive: 0xffb45e,
        emissiveIntensity: 2.4,
        roughness: 0.4
      });
      this.lampGlowMat = new THREE.SpriteMaterial({
        map: this.glowTex,
        color: 0xffb45e,
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true
      });
    }

    /* ---------------- highway chunks ---------------- */
    initChunks(centerZ) {
      for (const chunk of this.chunks) {
        this.scene.remove(chunk.group);
        RG.disposeObject(chunk.group);
      }
      this.chunks.length = 0;
      const base = Math.floor((centerZ - CHUNK_LEN * 2) / CHUNK_LEN) * CHUNK_LEN;
      let end = base;
      for (let i = 0; i < CHUNK_COUNT; i++) {
        const start = base + i * CHUNK_LEN;
        const chunk = this.buildChunk(start);
        this.chunks.push(chunk);
        end = start + CHUNK_LEN;
      }
      this.maxChunkEnd = end;
    }

    buildRoadGeometry(startZ) {
      const step = 4;
      const rows = Math.floor(CHUNK_LEN / step);
      const c0 = RG.roadCenter(startZ);
      const positions = [], uvs = [], indices = [];
      for (let i = 0; i <= rows; i++) {
        const lz = i * step;
        const wz = startZ + lz;
        const cx = RG.roadCenter(wz) - c0;
        positions.push(cx - RG.ROAD_HALF, 0.02, lz, cx + RG.ROAD_HALF, 0.02, lz);
        const v = wz / TEX_LEN;
        uvs.push(0, v, 1, v);
        if (i < rows) {
          const a = i * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    buildShoulderGeometry(startZ, side) {
      const step = 4;
      const rows = Math.floor(CHUNK_LEN / step);
      const c0 = RG.roadCenter(startZ);
      const positions = [], uvs = [], indices = [];
      const inner = RG.ROAD_HALF;
      const outer = RG.ROAD_HALF + RG.SHOULDER;
      for (let i = 0; i <= rows; i++) {
        const lz = i * step;
        const wz = startZ + lz;
        const cx = RG.roadCenter(wz) - c0;
        const x1 = cx + side * inner;
        const x2 = cx + side * outer;
        positions.push(x1, -0.035, lz, x2, -0.065, lz);
        const v = wz / 16;
        uvs.push(0, v, 1, v);
        if (i < rows) {
          const a = i * 2;
          if (side > 0) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          else indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    buildRailGeometry(startZ, side) {
      const step = 5;
      const rows = Math.floor(CHUNK_LEN / step);
      const c0 = RG.roadCenter(startZ);
      const positions = [], indices = [];
      const railX = RG.ROAD_HALF + 1.95;
      for (let i = 0; i <= rows; i++) {
        const lz = i * step;
        const wz = startZ + lz;
        const cx = RG.roadCenter(wz) - c0 + side * railX;
        positions.push(cx, 0.57, lz, cx, 0.94, lz);
        if (i < rows) {
          const a = i * 2;
          if (side > 0) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          else indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    buildTerrainGeometry(startZ, side) {
      const cols = 22;
      const rows = 26;
      const positions = [], colors = [], uvs = [], normals = [], indices = [];
      const c0 = RG.roadCenter(startZ);
      const color = new THREE.Color();
      const dryColor = new THREE.Color();
      const rockColor = new THREE.Color();
      const vergeColor = new THREE.Color();
      const normal = new THREE.Vector3();
      const sample = 0.55;
      for (let r = 0; r <= rows; r++) {
        const wz = startZ + (r / rows) * CHUNK_LEN;
        const localZ = (r / rows) * CHUNK_LEN;
        const cx = RG.roadCenter(wz) - c0;
        for (let c = 0; c <= cols; c++) {
          const t = c / cols;
          const lateral = 11.85 + Math.pow(t, 1.23) * 108;
          const x = cx + side * lateral;
          const y = RG.terrainHeight(wz, lateral);
          positions.push(x, y, localZ);
          uvs.push(lateral / 9 + (side > 0 ? 0 : 3.17), wz / 9);

          const hL = RG.terrainHeight(wz, lateral - sample);
          const hR = RG.terrainHeight(wz, lateral + sample);
          const hD = RG.terrainHeight(wz - sample, lateral);
          const hU = RG.terrainHeight(wz + sample, lateral);
          // The left side is mirrored across the road, so its lateral slope
          // points the opposite way in world space.
          normal.set(-side * (hR - hL) / (sample * 2), 1, -(hU - hD) / (sample * 2)).normalize();
          normals.push(normal.x, normal.y, normal.z);

          const macro = RG.fbm(wz * 0.011 + 13.2, lateral * 0.02 + 2.4, 4);
          const patch = RG.fbm(wz * 0.045 - 2.7, lateral * 0.075 + 7.1, 3);
          const fine = RG.fbm(wz * 0.34 + 1.8, lateral * 0.44 + 5.6, 2) - 0.5;
          const dry = RG.smoothstep(0.56, 0.8, RG.fbm(wz * 0.007 + 3.2, lateral * 0.013 + 8.9, 3));
          const slope = 1 - normal.y;
          const rocky = RG.smoothstep(0.52, 0.8, patch) * RG.smoothstep(0.05, 0.24, slope);
          const verge = 1 - RG.smoothstep(12.2, 18, lateral);
          color.setHSL(
            0.225 + macro * 0.05 + patch * 0.018 + fine * 0.012,
            0.3 + patch * 0.18,
            0.245 + macro * 0.1 + patch * 0.04 + fine * 0.035
          );
          if (dry > 0.01) {
            dryColor.setHSL(0.108 + macro * 0.025, 0.3, 0.3 + patch * 0.05);
            color.lerp(dryColor, dry * 0.46);
          }
          if (rocky > 0.01) {
            rockColor.setHSL(0.08, 0.12, 0.24 + patch * 0.07);
            color.lerp(rockColor, rocky * 0.38);
          }
          if (verge > 0.01) {
            vergeColor.setHSL(0.085, 0.28, 0.255);
            color.lerp(vergeColor, verge * 0.54);
          }
          colors.push(color.r, color.g, color.b);
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = r * (cols + 1) + c;
          const b = a + 1;
          const d = a + cols + 1;
          const e = d + 1;
          if (side > 0) indices.push(a, d, b, b, d, e);
          else indices.push(a, b, d, b, e, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setIndex(indices);
      return geo;
    }

    buildChunk(startZ) {
      const group = new THREE.Group();
      const index = Math.round(startZ / CHUNK_LEN);
      // Every piece of a chunk is built in chunk-local coordinates. Place the
      // whole group in the world so overlapping chunks can never stack up.
      group.position.set(RG.roadCenter(startZ), 0, startZ);

      const road = new THREE.Mesh(this.buildRoadGeometry(startZ), this.roadMat);
      road.receiveShadow = true;
      group.add(road);

      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(this.buildShoulderGeometry(startZ, side), this.shoulderMat);
        shoulder.receiveShadow = true;
        group.add(shoulder);

        const rail = new THREE.Mesh(this.buildRailGeometry(startZ, side), this.railMat);
        rail.castShadow = true;
        rail.receiveShadow = true;
        group.add(rail);

        const terrain = new THREE.Mesh(this.buildTerrainGeometry(startZ, side), this.terrainMat);
        terrain.receiveShadow = true;
        group.add(terrain);
      }

      // Guardrail posts.
      const postGeo = new THREE.BoxGeometry(0.12, 1.14, 0.12);
      const postCount = Math.floor(CHUNK_LEN / 11) + 1;
      const posts = new THREE.InstancedMesh(postGeo, this.postMat, postCount * 2);
      posts.castShadow = true;
      const dummy = new THREE.Object3D();
      let pi = 0;
      for (const side of [-1, 1]) {
        for (let i = 0; i < postCount; i++) {
          const lz = i * 11 + 2;
          const wz = startZ + lz;
          const cx = RG.roadCenter(wz) - RG.roadCenter(startZ) + side * (RG.ROAD_HALF + 1.95);
          dummy.position.set(cx, 0.45, lz);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          posts.setMatrixAt(pi++, dummy.matrix);
        }
      }
      posts.instanceMatrix.needsUpdate = true;
      group.add(posts);

      // Street lights, alternating sides each 120 m.
      if (index % 2 === 0 || index % 3 === 0) {
        const side = index % 2 === 0 ? 1 : -1;
        const lz = 54;
        const wz = startZ + lz;
        const cx = RG.roadCenter(wz) - RG.roadCenter(startZ);
        const light = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 8.8, 7), this.lampMat);
        pole.position.set(cx + side * 11.9, 4.4, lz);
        pole.castShadow = true;
        light.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.13, 0.13), this.lampMat);
        arm.position.set(cx + side * (11.9 - 2.05), 8.75, lz);
        arm.castShadow = true;
        light.add(arm);
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.36), this.bulbMat);
        bulb.position.set(cx + side * (11.9 - 4.12), 8.67, lz);
        light.add(bulb);
        const glow = new THREE.Sprite(this.lampGlowMat);
        glow.position.set(cx + side * (11.9 - 4.12), 8.65, lz);
        glow.scale.set(4.4, 4.4, 1);
        light.add(glow);
        group.add(light);
      }

      // Rusted roadside marker every chunk.
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 1.5, 0.08),
        this.markerMat
      );
      marker.position.set(
        RG.roadCenter(startZ + 34) - RG.roadCenter(startZ) - RG.ROAD_HALF - 2.5,
        0.72,
        34
      );
      marker.rotation.y = 0.1;
      group.add(marker);

      group.userData = { owned: true };
      this.scene.add(group);
      return { group, start: startZ, end: startZ + CHUNK_LEN };
    }

    recycleChunks(playerZ, force) {
      let changed = false;
      for (const chunk of this.chunks) {
        if (force || chunk.end < playerZ - 210) {
          this.scene.remove(chunk.group);
          RG.disposeObject(chunk.group);
          const newStart = this.maxChunkEnd;
          this.maxChunkEnd += CHUNK_LEN;
          const newChunk = this.buildChunk(newStart);
          Object.assign(chunk, newChunk);
          changed = true;
        }
      }
      return changed;
    }

    /* ---------------- vegetation ---------------- */
    createVegetation() {
      this.trees = [];
      const treeCount = this.quality.mobile ? 105 : 205;
      const pineCount = Math.round(treeCount * 0.58);
      const leafCount = treeCount - pineCount;

      const trunkGeo = new THREE.CylinderGeometry(0.23, 0.38, 1, 6);
      const coneGeo = new THREE.ConeGeometry(1, 1, 7);
      const crownGeo = new THREE.IcosahedronGeometry(1, 1);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x453b2f, roughness: 0.98, flatShading: true });
      const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true, vertexColors: false });
      const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true, vertexColors: false });
      const bushGeo = new THREE.IcosahedronGeometry(1, 0);
      const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, flatShading: true });
      const rockGeo = new THREE.DodecahedronGeometry(1, 0);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x7e7b6d, roughness: 0.98, flatShading: true });

      this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
      this.pineLow = new THREE.InstancedMesh(coneGeo, pineMat, pineCount);
      this.pineHigh = new THREE.InstancedMesh(coneGeo, pineMat, pineCount);
      this.leafCrowns = new THREE.InstancedMesh(crownGeo, leafMat, leafCount);
      this.bushes = new THREE.InstancedMesh(bushGeo, bushMat, this.quality.mobile ? 110 : 230);
      this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, this.quality.mobile ? 38 : 70);

      for (const mesh of [this.trunks, this.pineLow, this.pineHigh, this.leafCrowns, this.bushes, this.rocks]) {
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(mesh);
      }

      this.treeDummy = new THREE.Object3D();
      const recordTree = (type, index) => {
        const rec = {
          type, index, z: 0, side: 1, lateral: 20, scale: 1, rot: 0, color: new THREE.Color()
        };
        rec.z = -120 + ((index + Math.random() * 0.9) / (type === 'pine' ? pineCount : leafCount)) * (RG.SCENERY_SPAN + 160);
        rec.side = Math.random() < 0.5 ? -1 : 1;
        rec.lateral = 15.5 + Math.pow(Math.random(), 1.22) * 59;
        rec.scale = RG.rand(0.68, 1.55);
        rec.rot = RG.rand(0, RG.TAU);
        rec.color.setHSL(
          0.245 + RG.rand(-0.035, 0.04),
          0.28 + Math.random() * 0.18,
          0.17 + Math.random() * 0.09
        );
        if (type === 'leaf' && Math.random() < 0.18) rec.color.setHSL(0.11, 0.35, 0.27);
        this.trees.push(rec);
      };
      for (let i = 0; i < pineCount; i++) recordTree('pine', i);
      for (let i = 0; i < leafCount; i++) recordTree('leaf', i);
      this.assignTreeIndices();
      for (const rec of this.trees) this.placeTree(rec, true);

      this.bushRecords = [];
      for (let i = 0; i < this.bushes.count; i++) {
        const rec = { z: 0, side: 1, lateral: 14, scale: 1, rot: 0, color: new THREE.Color() };
        rec.z = -120 + (Math.random()) * (RG.SCENERY_SPAN + 160);
        rec.side = Math.random() < 0.5 ? -1 : 1;
        rec.lateral = 12.8 + Math.pow(Math.random(), 1.4) * 45;
        rec.scale = RG.rand(0.4, 1.25);
        rec.rot = RG.rand(0, RG.TAU);
        rec.color.setHSL(0.22 + RG.rand(-0.03, 0.05), 0.3, 0.16 + Math.random() * 0.1);
        this.bushRecords.push(rec);
        this.placeBush(rec, i, true);
      }

      this.rockRecords = [];
      for (let i = 0; i < this.rocks.count; i++) {
        const rec = { z: 0, side: 1, lateral: 16, scale: 1, rot: 0 };
        rec.z = -120 + Math.random() * (RG.SCENERY_SPAN + 160);
        rec.side = Math.random() < 0.5 ? -1 : 1;
        rec.lateral = 13 + Math.random() * 55;
        rec.scale = RG.rand(0.35, 2.1);
        rec.rot = RG.rand(0, RG.TAU);
        this.rockRecords.push(rec);
        this.placeRock(rec, i, true);
      }

      for (const mesh of [this.trunks, this.pineLow, this.pineHigh, this.leafCrowns, this.bushes, this.rocks]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }

    treeWorldPosition(rec, z) {
      return {
        x: RG.roadCenter(z) + rec.side * rec.lateral,
        y: RG.terrainHeight(z, rec.lateral)
      };
    }

    placeTree(rec, initial) {
      const pos = this.treeWorldPosition(rec, rec.z);
      const d = this.treeDummy;
      const s = rec.scale;
      const trunkH = (rec.type === 'pine' ? 3.7 : 3.2) * s;
      d.rotation.set(0, rec.rot, 0);
      d.position.set(pos.x, pos.y + trunkH / 2, rec.z);
      d.scale.set(0.8 * s, trunkH, 0.8 * s);
      d.updateMatrix();
      this.trunks.setMatrixAt(this.treeIndexFor(rec), d.matrix);

      if (rec.type === 'pine') {
        d.position.set(pos.x, pos.y + 5.25 * s, rec.z);
        d.scale.set(2.5 * s, 6.2 * s, 2.5 * s);
        d.updateMatrix();
        this.pineLow.setMatrixAt(rec.index, d.matrix);
        this.pineLow.setColorAt(rec.index, rec.color);
        d.position.set(pos.x, pos.y + 7.65 * s, rec.z);
        d.scale.set(1.55 * s, 4.2 * s, 1.55 * s);
        d.updateMatrix();
        this.pineHigh.setMatrixAt(rec.index, d.matrix);
        this.pineHigh.setColorAt(rec.index, rec.color);
      } else {
        d.position.set(pos.x, pos.y + 4.45 * s, rec.z);
        d.scale.set(2.9 * s, 2.4 * s, 2.9 * s);
        d.rotation.set(RG.rand(-0.05, 0.05), rec.rot, RG.rand(-0.04, 0.04));
        d.updateMatrix();
        this.leafCrowns.setMatrixAt(rec.index, d.matrix);
        this.leafCrowns.setColorAt(rec.index, rec.color);
      }

      if (!initial) {
        this.trunks.instanceMatrix.needsUpdate = true;
        if (rec.type === 'pine') {
          this.pineLow.instanceMatrix.needsUpdate = true;
          this.pineHigh.instanceMatrix.needsUpdate = true;
          if (this.pineLow.instanceColor) this.pineLow.instanceColor.needsUpdate = true;
          if (this.pineHigh.instanceColor) this.pineHigh.instanceColor.needsUpdate = true;
        } else {
          this.leafCrowns.instanceMatrix.needsUpdate = true;
          if (this.leafCrowns.instanceColor) this.leafCrowns.instanceColor.needsUpdate = true;
        }
      }
    }

    treeIndexFor(rec) {
      // Trunk indices are assigned after all records are created.
      return rec.trunkIndex;
    }

    placeBush(rec, index, initial) {
      const x = RG.roadCenter(rec.z) + rec.side * rec.lateral;
      const y = RG.terrainHeight(rec.z, rec.lateral);
      const d = this.treeDummy || new THREE.Object3D();
      d.position.set(x, y + rec.scale * 0.58, rec.z);
      d.rotation.set(RG.rand(-0.1, 0.1), rec.rot, RG.rand(-0.08, 0.08));
      d.scale.set(rec.scale * 1.55, rec.scale * 0.9, rec.scale * 1.4);
      d.updateMatrix();
      this.bushes.setMatrixAt(index, d.matrix);
      this.bushes.setColorAt(index, rec.color);
      if (!initial) {
        this.bushes.instanceMatrix.needsUpdate = true;
        if (this.bushes.instanceColor) this.bushes.instanceColor.needsUpdate = true;
      }
    }

    placeRock(rec, index, initial) {
      const x = RG.roadCenter(rec.z) + rec.side * rec.lateral;
      const y = RG.terrainHeight(rec.z, rec.lateral);
      const d = this.treeDummy || new THREE.Object3D();
      d.position.set(x, y + rec.scale * 0.2, rec.z);
      d.rotation.set(RG.rand(-0.2, 0.2), rec.rot, RG.rand(-0.2, 0.2));
      d.scale.set(rec.scale, rec.scale * RG.rand(0.5, 0.85), rec.scale * RG.rand(0.8, 1.3));
      d.updateMatrix();
      this.rocks.setMatrixAt(index, d.matrix);
      if (!initial) this.rocks.instanceMatrix.needsUpdate = true;
    }

    updateVegetation(playerZ) {
      let trunkDirty = false, pineDirty = false, leafDirty = false, bushDirty = false, rockDirty = false;
      for (const rec of this.trees) {
        let changed = false;
        while (rec.z < playerZ - 150) {
          rec.z += RG.SCENERY_SPAN;
          rec.side = Math.random() < 0.5 ? -1 : 1;
          rec.lateral = 15.5 + Math.pow(Math.random(), 1.22) * 59;
          rec.scale = RG.rand(0.68, 1.55);
          rec.rot = RG.rand(0, RG.TAU);
          rec.color.setHSL(0.245 + RG.rand(-0.035, 0.04), 0.28 + Math.random() * 0.18, 0.17 + Math.random() * 0.09);
          if (rec.type === 'leaf' && Math.random() < 0.18) rec.color.setHSL(0.11, 0.35, 0.27);
          this.placeTree(rec, false);
          changed = true;
        }
        if (changed) {
          trunkDirty = true;
          if (rec.type === 'pine') pineDirty = true;
          else leafDirty = true;
        }
      }
      for (let i = 0; i < this.bushRecords.length; i++) {
        const rec = this.bushRecords[i];
        if (rec.z < playerZ - 150) {
          rec.z += RG.SCENERY_SPAN;
          rec.side = Math.random() < 0.5 ? -1 : 1;
          rec.lateral = 12.8 + Math.pow(Math.random(), 1.4) * 45;
          rec.scale = RG.rand(0.4, 1.25);
          rec.color.setHSL(0.22 + RG.rand(-0.03, 0.05), 0.3, 0.16 + Math.random() * 0.1);
          this.placeBush(rec, i, false);
          bushDirty = true;
        }
      }
      for (let i = 0; i < this.rockRecords.length; i++) {
        const rec = this.rockRecords[i];
        if (rec.z < playerZ - 150) {
          rec.z += RG.SCENERY_SPAN;
          rec.side = Math.random() < 0.5 ? -1 : 1;
          rec.lateral = 13 + Math.random() * 55;
          rec.scale = RG.rand(0.35, 2.1);
          this.placeRock(rec, i, false);
          rockDirty = true;
        }
      }
      if (trunkDirty) this.trunks.instanceMatrix.needsUpdate = true;
      if (pineDirty) {
        this.pineLow.instanceMatrix.needsUpdate = true;
        this.pineHigh.instanceMatrix.needsUpdate = true;
      }
      if (leafDirty) this.leafCrowns.instanceMatrix.needsUpdate = true;
      if (this.trunks.instanceColor) this.trunks.instanceColor.needsUpdate = true;
    }

    assignTreeIndices() {
      let trunkIndex = 0;
      for (const rec of this.trees) rec.trunkIndex = trunkIndex++;
    }

    /* ---------------- rain ---------------- */
    createRain() {
      this.rainMax = this.quality.mobile ? 1100 : 2100;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(this.rainMax * 6);
      this.rainDrops = [];
      for (let i = 0; i < this.rainMax; i++) {
        this.rainDrops.push({
          x: RG.rand(-48, 48),
          y: RG.rand(0, 34),
          z: RG.rand(-55, 95),
          len: RG.rand(0.55, 1.9),
          speed: RG.rand(16, 29)
        });
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.rainGeo = geometry;
      this.rainMat = new THREE.LineBasicMaterial({
        color: 0xb9cede,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        blending: THREE.NormalBlending,
        fog: true
      });
      this.rain = new THREE.LineSegments(geometry, this.rainMat);
      this.rain.frustumCulled = false;
      this.rain.visible = false;
      this.scene.add(this.rain);
    }

    updateRain(dt, rainAmount, playerX, playerZ, speed) {
      const active = Math.floor(this.rainMax * Math.max(0.12, rainAmount));
      this.rain.visible = rainAmount > 0.025;
      this.rainMat.opacity = 0.18 + rainAmount * 0.29;
      this.rain.position.set(playerX, 0, playerZ);
      if (!this.rain.visible) return;
      const arr = this.rainGeo.attributes.position.array;
      const wind = 3.1 + speed * 0.045;
      for (let i = 0; i < this.rainMax; i++) {
        const d = this.rainDrops[i];
        d.y -= d.speed * dt;
        d.x += wind * dt;
        d.z -= 0.9 * dt;
        if (d.y < -0.3) {
          d.y = RG.rand(28, 38);
          d.x = RG.rand(-48, 48);
          d.z = RG.rand(-55, 95);
        }
        if (d.x > 49) d.x -= 98;
        if (d.z < -58) d.z += 153;
        if (d.z > 98) d.z -= 153;
        const o = i * 6;
        if (i < active) {
          arr[o] = d.x;
          arr[o + 1] = d.y;
          arr[o + 2] = d.z;
          arr[o + 3] = d.x - wind * 0.035;
          arr[o + 4] = d.y + d.len * (0.8 + Math.min(1.6, speed * 0.013));
          arr[o + 5] = d.z + 0.15;
        } else {
          arr[o] = 9000;
          arr[o + 1] = 9000;
          arr[o + 2] = 9000;
          arr[o + 3] = 9000;
          arr[o + 4] = 9000;
          arr[o + 5] = 9000;
        }
      }
      this.rainGeo.attributes.position.needsUpdate = true;
      this.rainGeo.setDrawRange(0, active * 2);
    }

    /* ---------------- lightning / signage ---------------- */
    createLightning() {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(20 * 3), 3));
      this.boltMat = new THREE.LineBasicMaterial({
        color: 0xeaf3ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
      });
      this.bolt = new THREE.Line(geo, this.boltMat);
      this.bolt.visible = false;
      this.bolt.frustumCulled = false;
      this.scene.add(this.bolt);
    }

    spawnLightning(playerPos) {
      const z = playerPos.z + RG.rand(120, 280);
      const x = RG.roadCenter(z) + RG.rand(-95, 95);
      const yTop = RG.rand(70, 100);
      const yBottom = 3;
      const points = new Float32Array(20 * 3);
      let px = x, pz = z;
      for (let i = 0; i < 20; i++) {
        const t = i / 19;
        const y = RG.lerp(yTop, yBottom, t);
        if (i > 0) {
          px += RG.rand(-6, 6) * Math.sin(t * Math.PI);
          pz += RG.rand(-3, 3);
        }
        points[i * 3] = px;
        points[i * 3 + 1] = y;
        points[i * 3 + 2] = pz;
      }
      const attr = this.bolt.geometry.attributes.position;
      attr.array.set(points);
      attr.needsUpdate = true;
      this.bolt.geometry.computeBoundingSphere();
      this.bolt.visible = true;
      this.boltMat.opacity = 1;
      this.boltTime = 0.16;
    }

    createGantries() {
      this.signTextures = [
        RG.createSignTexture('感染管制区', 'SECTOR 07  //  QUARANTINE ZONE', '#c6e6b3'),
        RG.createSignTexture('前方撤离点', 'EVACUATION POINT  //  5 KM', '#ffbb78')
      ];
      this.gantries = [];
      for (let i = 0; i < 2; i++) {
        const group = new THREE.Group();
        const metal = new THREE.MeshStandardMaterial({ color: 0x4b5050, roughness: 0.48, metalness: 0.7 });
        const postGeo = new THREE.BoxGeometry(0.38, 7.2, 0.38);
        const left = new THREE.Mesh(postGeo, metal);
        left.position.set(-10.7, 3.6, 0);
        left.castShadow = true;
        group.add(left);
        const right = new THREE.Mesh(postGeo, metal);
        right.position.set(10.7, 3.6, 0);
        right.castShadow = true;
        group.add(right);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(22.2, 0.32, 0.5), metal);
        beam.position.set(0, 7.1, 0);
        beam.castShadow = true;
        group.add(beam);
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(10.8, 4.05),
          new THREE.MeshStandardMaterial({
            map: this.signTextures[i],
            roughness: 0.56,
            metalness: 0.12,
            side: THREE.DoubleSide
          })
        );
        panel.position.set(0, 5.08, 0.28);
        panel.rotation.y = Math.PI;
        group.add(panel);
        const back = new THREE.Mesh(new THREE.BoxGeometry(11.0, 4.2, 0.12), metal);
        back.position.set(0, 5.08, 0.36);
        group.add(back);
        group.visible = false;
        this.scene.add(group);
        this.gantries.push({ group, z: 0, offset: 350 + i * 780 });
      }
    }

    placeGantries(playerZ) {
      for (let i = 0; i < this.gantries.length; i++) {
        const g = this.gantries[i];
        if (g.z < playerZ - 120 || g.z === 0) {
          g.z = playerZ + g.offset;
          g.group.position.set(RG.roadCenter(g.z), 0, g.z);
          g.group.rotation.y = RG.roadYaw(g.z);
          g.group.visible = true;
        }
      }
    }

    /* ---------------- per-frame update ---------------- */
    update(dt, playerPos, camera, elapsed, weatherSystem) {
      this.time += dt;
      const w = weatherSystem.current;
      const flash = Math.min(1.4, weatherSystem.flash + weatherSystem.secondaryFlash * 0.45);

      this.sky.position.copy(camera.position);
      this.skyUniforms.uTopColor.value.copy(w.skyTop);
      this.skyUniforms.uHorizonColor.value.copy(w.skyHorizon);
      this.skyUniforms.uCloudColor.value.copy(w.cloudColor);
      this.skyUniforms.uSunColor.value.copy(w.sunColor);
      this.skyUniforms.uCloudCover.value = w.cloudCover;
      this.skyUniforms.uCloudDark.value = w.cloudDark;
      this.skyUniforms.uTime.value = elapsed;
      this.skyUniforms.uFlash.value = flash;

      const elev = w.sunElevation;
      const az = w.sunAzimuth;
      this.sunDir.set(
        Math.cos(elev) * Math.sin(az),
        Math.sin(elev),
        Math.cos(elev) * Math.cos(az)
      ).normalize();
      this.skyUniforms.uSunDirection.value.copy(this.sunDir);

      const targetX = playerPos.x;
      const targetZ = playerPos.z + 20;
      this.sun.target.position.set(targetX, 0, targetZ);
      this.sun.target.updateMatrixWorld();
      this.sun.position.set(
        targetX + this.sunDir.x * 150,
        this.sunDir.y * 150,
        targetZ + this.sunDir.z * 150
      );
      this.sun.color.copy(w.sunColor);
      this.sun.intensity = w.sunIntensity * (1 + flash * 2.1);
      this.hemi.color.copy(w.hemiSky);
      this.hemi.groundColor.copy(w.hemiGround);
      this.hemi.intensity = w.hemiIntensity + flash * 0.6;
      this.ambient.color.copy(w.hemiSky);
      this.ambient.intensity = 0.12 + w.hemiIntensity * 0.09;

      this.scene.fog.color.copy(w.fogColor);
      this.scene.fog.density = w.fogDensity;
      this.scene.background.copy(w.fogColor);
      this.renderer.toneMappingExposure = w.exposure + flash * 0.18;

      this.roadMat.roughness = RG.lerp(0.82, 0.24, w.wetness);
      this.roadMat.metalness = RG.lerp(0.05, 0.2, w.wetness);
      this.roadMat.envMapIntensity = 0.25 + w.wetness * 0.95;
      this.roadMat.color.setRGB(
        RG.lerp(1, 0.62, w.wetness),
        RG.lerp(1, 0.65, w.wetness),
        RG.lerp(1, 0.7, w.wetness)
      );
      this.shoulderMat.color.setRGB(
        RG.lerp(0.68, 0.42, w.wetness),
        RG.lerp(0.68, 0.43, w.wetness),
        RG.lerp(0.64, 0.42, w.wetness)
      );
      this.bulbMat.emissiveIntensity = 0.55 + w.headlights * 4.2;
      this.lampGlowMat.opacity = 0.12 + w.headlights * 0.7;

      this.updateRain(dt, w.rain, playerPos.x, playerPos.z, playerPos.speed || 40);
      this.placeGantries(playerPos.z);
      this.updateVegetation(playerPos.z);

      let rebuilds = 0;
      while (this.chunks.some(c => c.end < playerPos.z - 210) && rebuilds < 4) {
        this.recycleChunks(playerPos.z, false);
        rebuilds++;
      }

      if (this.boltTime > 0) {
        this.boltTime -= dt;
        this.boltMat.opacity = Math.max(0, this.boltTime / 0.16);
        if (this.boltTime <= 0) this.bolt.visible = false;
      }

      return w.headlights;
    }

    setWetScreen(amount) {
      const el = document.getElementById('wet-overlay');
      if (el) el.style.opacity = String(amount * 0.75);
    }
  }

  RG.World = World;
})();
