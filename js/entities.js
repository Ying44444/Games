/* Player vehicle and GPU point particles. */
(function () {
  'use strict';
  const RG = window.RG;

  class ParticlePool {
    constructor(scene, max, additive) {
      this.max = max || 320;
      this.cursor = 0;
      this.particles = [];
      const positions = new Float32Array(this.max * 3);
      const colors = new Float32Array(this.max * 3);
      const sizes = new Float32Array(this.max);
      const alphas = new Float32Array(this.max);
      for (let i = 0; i < this.max; i++) {
        this.particles.push({
          active: false, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0,
          gravity: -8, drag: 1, size: 1, growth: 0
        });
        positions[i * 3 + 1] = -9999;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: `
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aAlpha;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vColor = aColor;
            vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(aSize * (300.0 / max(1.0, -mv.z)), 0.0, 76.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vec2 p = gl_PointCoord - 0.5;
            float d = length(p);
            float a = smoothstep(0.5, 0.03, d) * vAlpha;
            if (a < 0.004) discard;
            gl_FragColor = vec4(vColor, a);
          }
        `
      });
      this.points = new THREE.Points(geo, mat);
      this.points.frustumCulled = false;
      scene.add(this.points);
      this.geo = geo;
      this.posAttr = geo.attributes.position;
      this.colorAttr = geo.attributes.aColor;
      this.sizeAttr = geo.attributes.aSize;
      this.alphaAttr = geo.attributes.aAlpha;
    }

    emit(pos, count, opts) {
      const o = opts || {};
      const colors = o.colors || [0xffa040];
      const colorObjs = colors.map((c) => new THREE.Color(c));
      for (let n = 0; n < count; n++) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.max;
        const p = this.particles[i];
        const spread = o.spread || 0.35;
        p.active = true;
        p.life = RG.rand(o.life ? o.life[0] : 0.35, o.life ? o.life[1] : 0.8);
        p.maxLife = p.life;
        const speed = RG.rand(o.speed ? o.speed[0] : 2, o.speed ? o.speed[1] : 8);
        const theta = Math.random() * RG.TAU;
        const up = RG.rand(o.upMin === undefined ? -0.2 : o.upMin, o.upMax === undefined ? 0.75 : o.upMax);
        const horiz = Math.sqrt(Math.max(0, 1 - up * up));
        p.vx = Math.cos(theta) * horiz * speed + (o.vx || 0);
        p.vy = up * speed + (o.vy || 0);
        p.vz = Math.sin(theta) * horiz * speed + (o.vz || 0);
        p.gravity = o.gravity === undefined ? -14 : o.gravity;
        p.drag = o.drag === undefined ? 1.8 : o.drag;
        p.size = RG.rand(o.size ? o.size[0] : 0.22, o.size ? o.size[1] : 0.7);
        p.growth = o.growth || 0;
        this.posAttr.array[i * 3] = pos.x + RG.rand(-spread, spread);
        this.posAttr.array[i * 3 + 1] = pos.y + RG.rand(-spread * 0.4, spread * 0.8);
        this.posAttr.array[i * 3 + 2] = pos.z + RG.rand(-spread, spread);
        const c = colorObjs[Math.floor(Math.random() * colorObjs.length)];
        this.colorAttr.array[i * 3] = c.r;
        this.colorAttr.array[i * 3 + 1] = c.g;
        this.colorAttr.array[i * 3 + 2] = c.b;
        this.sizeAttr.array[i] = p.size;
        this.alphaAttr.array[i] = 0;
      }
      this.colorAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
    }

    update(dt) {
      let changed = false;
      for (let i = 0; i < this.max; i++) {
        const p = this.particles[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          this.alphaAttr.array[i] = 0;
          this.posAttr.array[i * 3 + 1] = -9999;
          changed = true;
          continue;
        }
        const drag = Math.max(0, 1 - p.drag * dt);
        p.vx *= drag;
        p.vz *= drag;
        p.vy = p.vy * drag + p.gravity * dt;
        this.posAttr.array[i * 3] += p.vx * dt;
        this.posAttr.array[i * 3 + 1] += p.vy * dt;
        this.posAttr.array[i * 3 + 2] += p.vz * dt;
        if (this.posAttr.array[i * 3 + 1] < 0.05 && p.gravity < 0) {
          this.posAttr.array[i * 3 + 1] = 0.05;
          p.vy *= -0.18;
          p.vx *= 0.7;
          p.vz *= 0.7;
        }
        const k = p.life / p.maxLife;
        this.alphaAttr.array[i] = Math.min(1, k * 2.2);
        this.sizeAttr.array[i] = p.size * (1 + p.growth * (1 - k));
        changed = true;
      }
      if (changed) {
        this.posAttr.needsUpdate = true;
        this.alphaAttr.needsUpdate = true;
        this.sizeAttr.needsUpdate = true;
      }
    }
  }

  RG.ParticlePool = ParticlePool;

  class PlayerCar {
    constructor(scene, envMap) {
      this.scene = scene;
      this.envMap = envMap;
      this.root = new THREE.Group();
      this.bodyPivot = new THREE.Group();
      this.root.add(this.bodyPivot);
      this.wheelSpin = 0;
      this.headlightLevel = 0.1;
      this.time = 0;
      this.createMaterials();
      this.build();
      scene.add(this.root);
    }

    createMaterials() {
      this.paint = new THREE.MeshPhysicalMaterial({
        color: 0x9e1022, metalness: 0.68, roughness: 0.24,
        clearcoat: 1, clearcoatRoughness: 0.075,
        envMap: this.envMap, envMapIntensity: 1.35
      });
      this.paintDark = new THREE.MeshPhysicalMaterial({
        color: 0x3a090d, metalness: 0.6, roughness: 0.28,
        clearcoat: 0.8, envMap: this.envMap, envMapIntensity: 1.1
      });
      this.carbon = new THREE.MeshStandardMaterial({
        color: 0x121418, metalness: 0.52, roughness: 0.5,
        envMap: this.envMap, envMapIntensity: 0.6
      });
      this.glass = new THREE.MeshPhysicalMaterial({
        color: 0x071015, metalness: 0.22, roughness: 0.06,
        transparent: true, opacity: 0.88, envMap: this.envMap,
        envMapIntensity: 1.7, clearcoat: 1
      });
      this.rubber = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.92, metalness: 0.02 });
      this.rim = new THREE.MeshStandardMaterial({ color: 0x9ba3a5, roughness: 0.28, metalness: 0.9, envMap: this.envMap });
      this.headMat = new THREE.MeshStandardMaterial({
        color: 0xfff6dc, emissive: 0xffe8b5, emissiveIntensity: 4.2, roughness: 0.2
      });
      this.tailMat = new THREE.MeshStandardMaterial({
        color: 0x4b0506, emissive: 0xff1b10, emissiveIntensity: 2.2, roughness: 0.4
      });
      this.flameMat = new THREE.MeshBasicMaterial({
        color: 0x65c7ff, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      this.lightConeMat = new THREE.MeshBasicMaterial({
        color: 0xffe4b5, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
    }

    build() {
      const extrude = (shape, depth, bevel) => {
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: depth,
          bevelEnabled: true,
          bevelSegments: 3,
          bevelSize: bevel,
          bevelThickness: bevel * 0.8,
          curveSegments: 4
        });
        geo.translate(0, 0, -depth / 2);
        geo.rotateY(-Math.PI / 2);
        return geo;
      };

      const bodyShape = new THREE.Shape();
      bodyShape.moveTo(-2.2, 0.28);
      bodyShape.lineTo(-2.16, 0.55);
      bodyShape.lineTo(-1.62, 0.7);
      bodyShape.lineTo(0.55, 0.76);
      bodyShape.lineTo(1.45, 0.66);
      bodyShape.lineTo(2.16, 0.53);
      bodyShape.lineTo(2.24, 0.34);
      bodyShape.lineTo(1.15, 0.24);
      bodyShape.lineTo(-1.2, 0.24);
      bodyShape.closePath();
      const body = new THREE.Mesh(extrude(bodyShape, 1.82, 0.08), this.paint);
      body.castShadow = true;
      body.receiveShadow = true;
      this.bodyPivot.add(body);

      const glassShape = new THREE.Shape();
      glassShape.moveTo(-1.46, 0.72);
      glassShape.lineTo(-1.03, 1.19);
      glassShape.lineTo(0.28, 1.2);
      glassShape.lineTo(0.92, 0.74);
      glassShape.closePath();
      const glass = new THREE.Mesh(extrude(glassShape, 1.49, 0.055), this.glass);
      glass.castShadow = false;
      this.bodyPivot.add(glass);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.43, 0.045, 1.12), this.paintDark);
      roof.position.set(0, 1.255, -0.4);
      roof.castShadow = true;
      this.bodyPivot.add(roof);

      const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 1.7), this.carbon);
      hoodStripe.position.set(0, 0.76, 1.15);
      this.bodyPivot.add(hoodStripe);

      const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.07, 0.43), this.carbon);
      splitter.position.set(0, 0.26, 2.2);
      splitter.castShadow = true;
      this.bodyPivot.add(splitter);

      const rearDiffuser = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.4), this.carbon);
      rearDiffuser.position.set(0, 0.28, -2.12);
      this.bodyPivot.add(rearDiffuser);

      for (const side of [-1, 1]) {
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 2.2), this.carbon);
        skirt.position.set(side * 0.94, 0.29, 0);
        this.bodyPivot.add(skirt);

        const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.11, 0.22), this.paintDark);
        mirror.position.set(side * 0.86, 0.9, 0.54);
        mirror.castShadow = true;
        this.bodyPivot.add(mirror);

        const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.07), this.carbon);
        post.position.set(side * 0.63, 0.91, -1.92);
        this.bodyPivot.add(post);
      }

      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.45), this.carbon);
      wing.position.set(0, 1.11, -2.02);
      wing.rotation.x = -0.07;
      wing.castShadow = true;
      this.bodyPivot.add(wing);

      // Wheels.
      this.wheels = [];
      this.frontWheelPivots = [];
      const tireGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.31, 18);
      tireGeo.rotateZ(Math.PI / 2);
      const rimGeo = new THREE.CylinderGeometry(0.235, 0.235, 0.325, 12);
      rimGeo.rotateZ(Math.PI / 2);
      for (const [z, isFront] of [[1.37, true], [-1.33, false]]) {
        for (const side of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set(side * 0.92, 0.37, z);
          const wheel = new THREE.Group();
          const tire = new THREE.Mesh(tireGeo, this.rubber);
          tire.castShadow = true;
          wheel.add(tire);
          const rim = new THREE.Mesh(rimGeo, this.rim);
          wheel.add(rim);
          for (let k = 0; k < 5; k++) {
            const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.335, 0.035, 0.26), this.rim);
            spoke.position.y = 0.16;
            spoke.rotation.x = k / 5 * RG.TAU;
            spoke.rotation.z = Math.PI / 2;
            wheel.add(spoke);
          }
          pivot.add(wheel);
          this.bodyPivot.add(pivot);
          this.wheels.push(wheel);
          if (isFront) this.frontWheelPivots.push(pivot);
        }
      }

      // Lights.
      this.headGlows = [];
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.06), this.headMat);
        lamp.position.set(side * 0.61, 0.61, 2.22);
        this.bodyPivot.add(lamp);
        const glow = RG.createSprite(RG.World ? null : null, 0xffe3b0, 0.58, 0.8);
        glow.position.set(side * 0.61, 0.62, 2.28);
        glow.material.map = null;
        this.bodyPivot.add(glow);
        this.headGlows.push(glow);
      }
      const tail = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.14, 0.05), this.tailMat);
      tail.position.set(0, 0.65, -2.23);
      this.bodyPivot.add(tail);
      this.tailGlow = RG.createSprite(null, 0xff2a18, 2.35, 0.68);
      this.tailGlow.scale.set(2.25, 0.72, 1);
      this.tailGlow.position.set(0, 0.64, -2.33);
      this.bodyPivot.add(this.tailGlow);

      // Headlight volumes.
      this.lightCones = [];
      const coneGeo = new THREE.ConeGeometry(2.2, 25, 20, 1, true);
      coneGeo.rotateX(-Math.PI / 2);
      for (const side of [-1, 1]) {
        const cone = new THREE.Mesh(coneGeo, this.lightConeMat);
        cone.position.set(side * 0.58, 0.58, 14.6);
        cone.rotation.x = 0.015;
        cone.scale.x = 0.8;
        this.bodyPivot.add(cone);
        this.lightCones.push(cone);
      }

      // Exhaust flame.
      this.flames = [];
      const flameGeo = new THREE.ConeGeometry(0.13, 1.15, 7);
      flameGeo.rotateX(-Math.PI / 2);
      for (const side of [-1, 1]) {
        const flame = new THREE.Mesh(flameGeo, this.flameMat);
        flame.position.set(side * 0.42, 0.31, -2.55);
        flame.visible = false;
        this.bodyPivot.add(flame);
        this.flames.push(flame);
      }

      // Hero fill light keeps the car readable during storms.
      this.heroLight = new THREE.PointLight(0x9fc7e8, 12, 20, 2);
      this.heroLight.position.set(0, 4.1, -2.8);
      this.root.add(this.heroLight);

      // Real, shadowless headlight beams.
      this.spotlights = [];
      for (const side of [-1, 1]) {
        const spot = new THREE.SpotLight(0xffe1a3, 0, 92, 0.33, 0.62, 1.35);
        spot.position.set(side * 0.58, 0.66, 2.0);
        spot.target.position.set(side * 1.5, 0.2, 33);
        this.root.add(spot);
        this.root.add(spot.target);
        spot.castShadow = false;
        this.spotlights.push(spot);
      }

      this.root.traverse((o) => {
        if (o.isMesh && o !== glass) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      // Volumetric/transparent effects should never write to the shadow map.
      for (const c of this.lightCones) c.castShadow = false;
      for (const f of this.flames) f.castShadow = false;
    }

    setGlowTexture(tex) {
      for (const g of this.headGlows) g.material.map = tex;
      this.tailGlow.material.map = tex;
      for (const g of this.headGlows) g.material.needsUpdate = true;
      this.tailGlow.material.needsUpdate = true;
    }

    setHeadlights(level) {
      this.headlightLevel = level;
      const intensity = 60 + level * 620;
      for (const s of this.spotlights) s.intensity = intensity;
      this.lightConeMat.opacity = 0.014 + level * 0.055;
      this.lightCones.forEach((c) => { c.visible = level > 0.08; });
      this.heroLight.intensity = 5 + level * 12;
      const glowScale = 0.35 + level * 0.55;
      this.headGlows.forEach((g) => g.scale.set(glowScale, glowScale, 1));
    }

    setTailLevel(level) {
      this.tailMat.emissiveIntensity = 0.9 + level * 4.2;
      if (this.tailGlow) this.tailGlow.material.opacity = 0.2 + level * 0.6;
    }

    update(dt, state) {
      this.time += dt;
      this.root.visible = !state.hidden;
      this.root.position.set(state.x, 0.025 + (state.bob || 0), state.z);
      this.root.rotation.y = state.yaw;
      this.bodyPivot.rotation.z = RG.damp(this.bodyPivot.rotation.z, -state.steer * 0.035, 8, dt);
      this.bodyPivot.rotation.x = RG.damp(this.bodyPivot.rotation.x, (state.pitch || 0), 6, dt);
      this.bodyPivot.position.y = Math.sin(this.time * 8.5) * 0.008 * Math.min(1, state.speed / 35);
      this.wheelSpin += state.speed * dt / 0.37;
      for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
      for (const p of this.frontWheelPivots) p.rotation.y = RG.damp(p.rotation.y, state.steer * 0.27, 12, dt);
      const boosting = state.boost;
      for (const f of this.flames) {
        f.visible = boosting;
        if (boosting) {
          const flicker = 0.75 + Math.random() * 0.55;
          f.scale.set(0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.4, flicker);
          f.material.opacity = 0.45 + Math.random() * 0.25;
        }
      }
      this.setTailLevel(state.brake ? 1 : state.boost ? 0.32 : 0.16);
      if (this.lightCones[0]) {
        const sway = Math.sin(this.time * 2.1) * 0.006;
        this.lightCones[0].rotation.z = sway;
        this.lightCones[1].rotation.z = -sway;
      }
    }

    setVisible(v) {
      this.root.visible = v;
    }
  }

  RG.PlayerCar = PlayerCar;
})();
