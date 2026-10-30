/* Traffic, infected and pickups. */
(function () {
  'use strict';
  const RG = window.RG;

  /* ============================ TRAFFIC ============================ */
  const TRAFFIC_TYPES = {
    sedan: { len: 4.35, width: 1.84, bodyH: 0.54, cabinLen: 2.05, cabinW: 1.49, cabinH: 0.5, cabinZ: -0.3, wheelR: 0.34, speed: [19, 26], damage: 21 },
    hatch: { len: 3.85, width: 1.78, bodyH: 0.55, cabinLen: 1.9, cabinW: 1.43, cabinH: 0.55, cabinZ: -0.38, wheelR: 0.33, speed: [17, 23], damage: 19 },
    van: { len: 5.35, width: 2.05, bodyH: 0.78, cabinLen: 3.4, cabinW: 1.88, cabinH: 0.9, cabinZ: -0.38, wheelR: 0.38, speed: [15, 21], damage: 26 },
    truck: { len: 7.6, width: 2.34, bodyH: 0.62, cabinLen: 2.1, cabinW: 2.1, cabinH: 1.2, cabinZ: 0, wheelR: 0.46, speed: [12, 17], damage: 34 }
  };

  const trafficShared = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x081116, metalness: 0.35, roughness: 0.1, transparent: true, opacity: 0.82 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.95 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x777d7c, metalness: 0.8, roughness: 0.35 }),
    head: new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffedc0, emissiveIntensity: 3.1, roughness: 0.3 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x4b0505, emissive: 0xff170c, emissiveIntensity: 2.2, roughness: 0.4 }),
    cargo: new THREE.MeshStandardMaterial({ color: 0x9b9a8d, roughness: 0.76, metalness: 0.28 }),
    cargoStripe: new THREE.MeshStandardMaterial({ color: 0xb44524, roughness: 0.8 })
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
  wheelGeo.rotateZ(Math.PI / 2);

  class TrafficCar {
    constructor(scene, envMap, glowTex, color) {
      this.scene = scene;
      this.glowTex = glowTex;
      this.group = new THREE.Group();
      this.paint = new THREE.MeshStandardMaterial({
        color: color || 0x718089, metalness: 0.56, roughness: 0.34,
        envMap: envMap, envMapIntensity: 1.0
      });
      this.body = new THREE.Mesh(unitBox, this.paint);
      this.body.castShadow = true;
      this.body.receiveShadow = true;
      this.group.add(this.body);

      this.cabin = new THREE.Mesh(unitBox, trafficShared.glass);
      this.cabin.castShadow = true;
      this.group.add(this.cabin);

      this.roof = new THREE.Mesh(unitBox, this.paint);
      this.roof.castShadow = true;
      this.group.add(this.roof);

      this.cargo = new THREE.Mesh(unitBox, trafficShared.cargo);
      this.cargo.castShadow = true;
      this.cargo.visible = false;
      this.group.add(this.cargo);
      this.cargoStripe = new THREE.Mesh(unitBox, trafficShared.cargoStripe);
      this.cargoStripe.visible = false;
      this.group.add(this.cargoStripe);

      this.headLights = [];
      this.tailLights = [];
      for (const side of [-1, 1]) {
        const hl = new THREE.Mesh(unitBox, trafficShared.head);
        hl.castShadow = false;
        this.group.add(hl);
        this.headLights.push(hl);
        const tl = new THREE.Mesh(unitBox, trafficShared.tail);
        tl.castShadow = false;
        this.group.add(tl);
        this.tailLights.push(tl);
      }

      this.tailGlow = RG.createSprite(glowTex, 0xff1d13, 1.8, 0.55);
      this.group.add(this.tailGlow);

      this.wheels = [];
      for (let i = 0; i < 4; i++) {
        const wheel = new THREE.Group();
        const tire = new THREE.Mesh(wheelGeo, trafficShared.rubber);
        tire.castShadow = true;
        const rim = new THREE.Mesh(wheelGeo, trafficShared.rim);
        rim.scale.set(0.98, 0.55, 0.55);
        wheel.add(tire, rim);
        this.group.add(wheel);
        this.wheels.push(wheel);
      }

      this.group.visible = false;
      scene.add(this.group);
      this.z = 0;
      this.lane = 0;
      this.laneOffset = 0;
      this.speed = 20;
      this.length = 4.3;
      this.width = 1.8;
      this.type = 'sedan';
      this.damage = 20;
      this.active = false;
      this.passed = false;
      this.cool = 0;
      this.seed = Math.random() * 100;
      this.wheelRadius = 0.34;
      this.wheelSpin = 0;
      this.configure('sedan');
    }

    configure(type) {
      const cfg = TRAFFIC_TYPES[type] || TRAFFIC_TYPES.sedan;
      this.type = type;
      this.cfg = cfg;
      this.length = cfg.len;
      this.width = cfg.width;
      this.damage = cfg.damage;
      this.wheelRadius = cfg.wheelR;
      const bodyH = cfg.bodyH;

      if (type === 'truck') {
        this.body.scale.set(cfg.width, 1.45, 2.1);
        this.body.position.set(0, 0.5 + 1.45 / 2, cfg.len / 2 - 1.05);
        this.cabin.visible = false;
        this.roof.visible = false;
        this.cargo.visible = true;
        this.cargo.scale.set(2.2, 2.3, 4.7);
        this.cargo.position.set(0, 1.5, -0.65);
        this.cargoStripe.visible = true;
        this.cargoStripe.scale.set(2.205, 0.22, 4.71);
        this.cargoStripe.position.set(0, 1.05, -0.65);
      } else {
        this.body.scale.set(cfg.width, bodyH, cfg.len);
        this.body.position.set(0, 0.28 + bodyH / 2, 0);
        this.cabin.visible = true;
        this.roof.visible = true;
        this.cabin.scale.set(cfg.cabinW, cfg.cabinH, cfg.cabinLen);
        this.cabin.position.set(0, 0.28 + bodyH + cfg.cabinH / 2 - 0.03, cfg.cabinZ);
        this.roof.scale.set(cfg.cabinW + 0.035, 0.06, cfg.cabinLen * 0.92);
        this.roof.position.set(0, 0.28 + bodyH + cfg.cabinH - 0.02, cfg.cabinZ);
        this.cargo.visible = false;
        this.cargoStripe.visible = false;
      }

      const frontZ = cfg.len / 2;
      const rearZ = -cfg.len / 2;
      this.headLights.forEach((hl, i) => {
        const side = i === 0 ? -1 : 1;
        hl.scale.set(0.45, 0.16, 0.06);
        hl.position.set(side * (cfg.width / 2 - 0.31), 0.64, frontZ + 0.015);
      });
      this.tailLights.forEach((tl, i) => {
        const side = i === 0 ? -1 : 1;
        tl.scale.set(0.4, 0.14, 0.05);
        tl.position.set(side * (cfg.width / 2 - 0.28), type === 'truck' ? 0.62 : 0.66, rearZ - 0.02);
      });
      this.tailGlow.position.set(0, 0.64, rearZ - 0.06);
      this.tailGlow.scale.set(cfg.width * 1.1, 0.62, 1);

      const wx = cfg.width / 2 - 0.02;
      const wz = cfg.len / 2 - Math.min(1.35, cfg.len * 0.26);
      const wheelY = cfg.wheelR;
      const scale = cfg.wheelR;
      const positions = [[-wx, wheelY, wz], [wx, wheelY, wz], [-wx, wheelY, -wz], [wx, wheelY, -wz]];
      this.wheels.forEach((w, i) => {
        w.position.set(positions[i][0], positions[i][1], positions[i][2]);
        w.scale.set(scale, scale, scale);
      });
      this.group.userData.type = type;
    }

    spawn(z, lane, type) {
      this.configure(type);
      this.z = z;
      this.lane = lane;
      this.laneOffset = RG.LANES[lane] + RG.rand(-0.18, 0.18);
      this.speed = RG.rand(this.cfg.speed[0], this.cfg.speed[1]);
      this.active = true;
      this.passed = false;
      this.cool = 0;
      this.group.visible = true;
      this.seed = Math.random() * 50;
      this.paint.color.setHex(RG.pick([0x8d9694, 0x40494e, 0xb5b4a7, 0x2e4852, 0x6f2c28, 0x233c31, 0x8c7c5c, 0xc3c5c0]));
      this.paint.needsUpdate = true;
    }

    update(dt) {
      if (!this.active) return;
      this.cool = Math.max(0, this.cool - dt);
      this.z += this.speed * dt;
      const x = RG.laneX(this.z, this.lane) + (this.laneOffset - RG.LANES[this.lane]);
      this.group.position.set(x, 0.025, this.z);
      this.group.rotation.y = RG.roadYaw(this.z);
      this.wheelSpin += this.speed * dt / Math.max(0.2, this.wheelRadius);
      for (const w of this.wheels) w.children[0].rotation.x = this.wheelSpin;
      for (const w of this.wheels) w.children[1].rotation.x = this.wheelSpin;
      this.group.position.y = 0.025 + Math.sin(this.z * 0.7 + this.seed) * 0.004;
    }

    hide() {
      this.active = false;
      this.group.visible = false;
    }
  }

  TrafficCar.TYPES = TRAFFIC_TYPES;
  RG.TrafficCar = TrafficCar;
  RG.TRAFFIC_TYPES = TRAFFIC_TYPES;

  /* ============================ ZOMBIES ============================ */
  const ZOMBIE_TYPES = {
    walker: {
      name: '慢行者', dir: 1, speed: [0.5, 1.4], damage: 11, score: 110,
      scale: 1.0, anim: 3.4, skin: 0x778d52, shirt: 0x4c513a, pants: 0x272a24,
      glow: 0x789a3b, glowOpacity: 0, speedClass: '低速'
    },
    runner: {
      name: '疾行者', dir: -1, speed: [4.6, 7.8], damage: 9, score: 180,
      scale: 0.94, anim: 8.2, skin: 0x927d55, shirt: 0x672924, pants: 0x201f1d,
      glow: 0xc33d24, glowOpacity: 0, speedClass: '高速'
    },
    brute: {
      name: '暴君', dir: 1, speed: [0.2, 0.65], damage: 38, score: 340,
      scale: 1.55, anim: 1.9, skin: 0x65745a, shirt: 0x3d4036, pants: 0x24231e,
      glow: 0x9b2b1a, glowOpacity: 0, speedClass: '重装'
    },
    toxic: {
      name: '毒爆者', dir: 1, speed: [0.7, 1.5], damage: 24, score: 260,
      scale: 1.12, anim: 3.1, skin: 0x6e9a4a, shirt: 0x363b25, pants: 0x1e261c,
      glow: 0x74ff3a, glowOpacity: 0.55, speedClass: '腐蚀'
    }
  };
  RG.ZOMBIE_TYPES = ZOMBIE_TYPES;

  const zombieGeos = {
    head: new THREE.SphereGeometry(0.27, 9, 7),
    torso: new THREE.BoxGeometry(0.62, 0.82, 0.33),
    arm: new THREE.BoxGeometry(0.15, 0.58, 0.16),
    leg: new THREE.BoxGeometry(0.2, 0.69, 0.22),
    eye: new THREE.SphereGeometry(0.035, 5, 4)
  };
  const zombieMaterials = {
    eye: new THREE.MeshStandardMaterial({ color: 0x2b0603, emissive: 0xff2e12, emissiveIntensity: 4, roughness: 0.4 }),
    teeth: new THREE.MeshStandardMaterial({ color: 0xd6d3af, roughness: 0.65 })
  };
  const zombieSkinMats = {};
  const zombieShirtMats = {};
  const zombiePantsMats = {};
  for (const key of Object.keys(ZOMBIE_TYPES)) {
    const t = ZOMBIE_TYPES[key];
    zombieSkinMats[key] = new THREE.MeshStandardMaterial({
      color: t.skin, roughness: 0.86,
      emissive: key === 'toxic' ? 0x1a3b10 : 0x000000,
      emissiveIntensity: key === 'toxic' ? 0.8 : 0
    });
    zombieShirtMats[key] = new THREE.MeshStandardMaterial({ color: t.shirt, roughness: 0.96 });
    zombiePantsMats[key] = new THREE.MeshStandardMaterial({ color: t.pants, roughness: 0.94 });
  }

  class Zombie {
    constructor(scene, glowTex) {
      this.scene = scene;
      this.root = new THREE.Group();
      this.lean = new THREE.Group();
      this.root.add(this.lean);

      this.torso = new THREE.Mesh(zombieGeos.torso, zombieShirtMats.walker);
      this.torso.position.y = 1.18;
      this.torso.castShadow = true;
      this.lean.add(this.torso);

      this.head = new THREE.Mesh(zombieGeos.head, zombieSkinMats.walker);
      this.head.position.set(0.05, 1.77, 0.02);
      this.head.castShadow = true;
      this.lean.add(this.head);

      this.eyes = [];
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(zombieGeos.eye, zombieMaterials.eye);
        eye.position.set(side * 0.095, 1.81, 0.235);
        this.lean.add(eye);
        this.eyes.push(eye);
      }
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.075, 0.1), zombieMaterials.teeth);
      jaw.position.set(0, 1.66, 0.22);
      this.lean.add(jaw);

      this.arms = [];
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.4, 1.48, 0);
        const arm = new THREE.Mesh(zombieGeos.arm, zombieShirtMats.walker);
        arm.position.y = -0.27;
        arm.castShadow = true;
        pivot.add(arm);
        this.lean.add(pivot);
        this.arms.push(pivot);
      }
      this.legs = [];
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.17, 0.77, 0);
        const leg = new THREE.Mesh(zombieGeos.leg, zombiePantsMats.walker);
        leg.position.y = -0.34;
        leg.castShadow = true;
        pivot.add(leg);
        this.lean.add(pivot);
        this.legs.push(pivot);
      }

      this.glow = RG.createSprite(glowTex, 0x6bff3a, 2.4, 0);
      this.glow.position.set(0, 1.0, 0);
      this.lean.add(this.glow);

      this.root.visible = false;
      scene.add(this.root);

      this.active = false;
      this.type = 'walker';
      this.z = 0;
      this.lateral = 0;
      this.targetLateral = 0;
      this.zSpeed = 0;
      this.phase = Math.random() * 10;
      this.lateralSpeed = 0;
      this.damage = 10;
      this.score = 100;
      this.setType('walker');
    }

    setType(type) {
      this.type = type;
      const t = ZOMBIE_TYPES[type];
      this.torso.material = zombieShirtMats[type];
      this.head.material = zombieSkinMats[type];
      for (const arm of this.arms) arm.children[0].material = zombieShirtMats[type];
      for (const leg of this.legs) leg.children[0].material = zombiePantsMats[type];
      this.root.scale.setScalar(t.scale);
      this.damage = t.damage;
      this.score = t.score;
      this.glow.material.color.setHex(t.glow);
      this.glow.material.opacity = t.glowOpacity;
      this.glow.visible = t.glowOpacity > 0;
      this.eyes.forEach((e) => { e.material.emissiveIntensity = type === 'toxic' ? 5.5 : 4; });
    }

    spawn(z, lateral, type, speedVariance) {
      this.setType(type);
      this.active = true;
      this.z = z;
      this.lateral = RG.clamp(lateral, -7.1, 7.1);
      this.targetLateral = RG.clamp(this.lateral + RG.rand(-2.8, 2.8), -7.2, 7.2);
      const t = ZOMBIE_TYPES[type];
      this.zSpeed = t.dir * RG.rand(t.speed[0], t.speed[1]) * (speedVariance || 1);
      this.root.visible = true;
      this.phase = Math.random() * 10;
      this.lateralSpeed = 0;
      this.glow.material.opacity = t.glowOpacity;
    }

    update(dt, playerZ, elapsed) {
      if (!this.active) return;
      this.z += this.zSpeed * dt;
      const dx = this.targetLateral - this.lateral;
      this.lateral += dx * Math.min(1, dt * 0.5);
      if (Math.abs(dx) < 0.2) this.targetLateral = RG.clamp(this.lateral + RG.rand(-3, 3), -7.2, 7.2);
      const x = RG.roadCenter(this.z) + this.lateral;
      this.root.position.set(x, 0.03, this.z);
      const dir = this.zSpeed >= 0 ? 0 : Math.PI;
      this.root.rotation.y = dir + Math.sin(elapsed * 2 + this.phase) * 0.04;

      const t = ZOMBIE_TYPES[this.type];
      const animRate = t.anim * (this.type === 'brute' ? 0.8 : 1);
      this.phase += dt * animRate;
      const stride = this.type === 'brute' ? 0.36 : this.type === 'runner' ? 1.05 : 0.62;
      this.legs[0].rotation.x = Math.sin(this.phase) * stride;
      this.legs[1].rotation.x = -Math.sin(this.phase) * stride;
      const armBase = this.type === 'runner' ? -1.42 : this.type === 'brute' ? -0.5 : -1.05;
      this.arms[0].rotation.x = armBase + Math.sin(this.phase + 1.5) * 0.16;
      this.arms[1].rotation.x = armBase - Math.sin(this.phase + 1.5) * 0.16;
      this.arms[0].rotation.z = -0.12;
      this.arms[1].rotation.z = 0.12;
      this.lean.rotation.x = this.type === 'runner' ? -0.15 : this.type === 'brute' ? 0.06 : 0;
      this.lean.rotation.z = Math.sin(this.phase * 0.5) * 0.045;
      this.head.rotation.y = Math.sin(elapsed * 1.1 + this.phase) * 0.25;
      this.head.rotation.z = Math.sin(this.phase * 0.7) * 0.08;
      this.glow.material.opacity = t.glowOpacity * (0.75 + Math.sin(elapsed * 4 + this.phase) * 0.18);
      this.root.position.y = 0.03 + Math.abs(Math.sin(this.phase)) * 0.035;
    }

    kill() {
      this.active = false;
      this.root.visible = false;
    }
  }

  RG.Zombie = Zombie;

  /* ============================ PICKUPS ============================ */
  const pickupBodyMat = new THREE.MeshStandardMaterial({
    color: 0x0f3b23, emissive: 0x0e5c2a, emissiveIntensity: 0.7, roughness: 0.45, metalness: 0.3
  });
  const pickupCrossMat = new THREE.MeshStandardMaterial({
    color: 0xd7ffb2, emissive: 0x97ff5b, emissiveIntensity: 2.4, roughness: 0.3
  });
  const pickupRingMat = new THREE.MeshBasicMaterial({
    color: 0x8dff55, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });

  class Pickup {
    constructor(scene, glowTex) {
      this.group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), pickupBodyMat);
      body.castShadow = true;
      this.group.add(body);
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.47, 0.03), pickupCrossMat);
      crossV.position.set(0, 0, -0.462);
      this.group.add(crossV);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.16, 0.03), pickupCrossMat);
      crossH.position.set(0, 0, -0.462);
      this.group.add(crossH);
      const crossTopV = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.47, 0.03), pickupCrossMat);
      crossTopV.rotation.x = Math.PI / 2;
      crossTopV.position.set(0, 0.362, 0);
      this.group.add(crossTopV);
      const crossTopH = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.16, 0.03), pickupCrossMat);
      crossTopH.rotation.x = Math.PI / 2;
      crossTopH.position.set(0, 0.362, 0);
      this.group.add(crossTopH);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.025, 6, 28), pickupRingMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.02;
      this.group.add(ring);
      this.ring = ring;
      this.glow = RG.createSprite(glowTex, 0x77ff44, 3.0, 0.5);
      this.group.add(this.glow);
      this.group.visible = false;
      this.group.position.y = 0.5;
      scene.add(this.group);
      this.active = false;
      this.z = 0;
      this.lateral = 0;
      this.phase = Math.random() * 5;
    }

    spawn(z, lateral) {
      this.active = true;
      this.z = z;
      this.lateral = lateral;
      this.group.visible = true;
      this.group.position.set(RG.roadCenter(z) + lateral, 0.6, z);
    }

    update(dt, elapsed) {
      if (!this.active) return;
      this.phase += dt;
      const x = RG.roadCenter(this.z) + this.lateral;
      this.group.position.set(x, 0.62 + Math.sin(elapsed * 2 + this.phase) * 0.13, this.z);
      this.group.rotation.y = elapsed * 0.7 + this.phase;
      this.ring.rotation.z = elapsed * 0.9;
      this.glow.material.opacity = 0.35 + Math.sin(elapsed * 4 + this.phase) * 0.12;
    }

    hide() {
      this.active = false;
      this.group.visible = false;
    }
  }

  RG.Pickup = Pickup;
})();
