/* DEADLINE - main game loop, player state, collisions and UI. */
(function () {
  'use strict';
  const RG = window.RG;
  const $ = (id) => document.getElementById(id);

  const dom = {
    canvas: $('game-canvas'),
    hud: $('hud'),
    score: $('scoreValue'), comboTag: $('comboTag'), best: $('bestValue'), distance: $('distanceValue'),
    muteBtn: $('muteBtn'), weatherIcon: $('weatherIcon'), weatherName: $('weatherName'),
    weatherNext: $('weatherNext'), weatherFill: $('weatherFill'), weatherNextLabel: $('weatherNextLabel'),
    stageLabel: $('stageLabel'), threatValue: $('threatValue'),
    healthValue: $('healthValue'), healthFill: $('healthFill'), healthTrack: document.querySelector('.health-track'),
    comboValue: $('comboValue'), comboFill: $('comboFill'), boostHint: $('boostHint'),
    speedValue: $('speedValue'), speedArc: $('speedArc'), gearValue: $('gearValue'),
    toastLayer: $('toastLayer'), weatherAlert: $('weatherAlert'), alertIcon: $('alertIcon'), alertName: $('alertName'),
    startScreen: $('startScreen'), startBtn: $('startBtn'), startBest: $('startBest'),
    pauseScreen: $('pauseScreen'), resumeBtn: $('resumeBtn'), pauseRestartBtn: $('pauseRestartBtn'),
    gameoverScreen: $('gameoverScreen'), restartBtn: $('restartBtn'), homeBtn: $('homeBtn'),
    finalScore: $('finalScore'), finalDistance: $('finalDistance'), finalKills: $('finalKills'),
    finalCombo: $('finalCombo'), newRecord: $('newRecord'), gameoverText: $('gameoverText'),
    damageFlash: $('damage-flash'), lightningFlash: $('lightning-flash'), hurtVignette: $('hurt-vignette'),
    wetOverlay: $('wet-overlay'), speedFx: $('speed-fx'), touch: $('touchControls'),
    touchLeft: $('touchLeft'), touchRight: $('touchRight'), touchBoost: $('touchBoost'),
    bootError: $('bootError')
  };

  const input = { left: false, right: false, brake: false, boost: false };
  const game = {
    state: 'menu',
    z: 0,
    runStartZ: 0,
    score: 0,
    displayScore: -1,
    health: 100,
    speed: 24,
    lateral: 0,
    lateralVel: 0,
    distance: 0,
    combo: 1,
    comboTimer: 0,
    maxCombo: 1,
    kills: 0,
    invuln: 0,
    shake: 0,
    boosting: false,
    braking: false,
    steer: 0,
    deathTimer: 0,
    best: 0,
    newBest: false,
    runTime: 0,
    particleTimer: 0,
    pickupTimer: 4,
    lastToast: 0
  };

  let renderer, scene, camera, world, weather, playerCar, audio;
  let addParticles, normalParticles;
  let traffic = [], zombies = [], pickups = [];
  let clock;
  let elapsed = 0;
  let camLook = new THREE.Vector3();
  let cameraSnapped = false;
  let alertTimer = 0;
  let rafId = 0;
  let quality;
  const tempVec = new THREE.Vector3();
  const tempLook = new THREE.Vector3();
  const playerPos = { x: 0, y: 0, z: 0, speed: 0 };
  const SPEED_RING = 358;

  init();

  function init() {
    try {
      buildRenderer();
      buildScene();
      bindUI();
      bindInput();
      prepareMenu();
      clock = new THREE.Clock();
      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && game.state === 'playing') togglePause(true);
      });
      rafId = requestAnimationFrame(loop);
    } catch (err) {
      console.error(err);
      dom.bootError.classList.add('show');
      dom.bootError.querySelector('p').textContent = String(err && err.message ? err.message : err);
    }
  }

  function buildRenderer() {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 720;
    quality = { mobile: touch || small, shadowSize: (touch || small) ? 1024 : 2048 };
    renderer = new THREE.WebGLRenderer({
      canvas: dom.canvas,
      antialias: !quality.mobile,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.mobile ? 1.35 : 1.8));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 1500);
    camera.position.set(0, 4.5, -10);
  }

  function buildScene() {
    world = new RG.World(scene, renderer, quality);
    weather = new RG.WeatherSystem();
    playerCar = new RG.PlayerCar(scene, world.envMap);
    playerCar.setGlowTexture(world.glowTex);
    audio = new RG.AudioEngine();
    addParticles = new RG.ParticlePool(scene, quality.mobile ? 280 : 460, true);
    normalParticles = new RG.ParticlePool(scene, quality.mobile ? 240 : 380, false);

    const trafficCount = quality.mobile ? 9 : 14;
    const zombieCount = quality.mobile ? 11 : 16;
    for (let i = 0; i < trafficCount; i++) {
      traffic.push(new RG.TrafficCar(scene, world.envMap, world.glowTex));
    }
    for (let i = 0; i < zombieCount; i++) {
      zombies.push(new RG.Zombie(scene, world.glowTex));
    }
    for (let i = 0; i < 3; i++) {
      pickups.push(new RG.Pickup(scene, world.glowTex));
    }

    weather.onChange = (info) => {
      const preset = RG.WEATHER_PRESETS[info.key] || weather.target;
      if (game.state === 'playing') {
        showWeatherAlert(preset);
        if (audio) {
          audio.init();
          audio.chimeWeather();
        }
      }
    };
    weather.onLightning = () => {
      const pos = currentPlayerPos();
      world.spawnLightning(pos);
      flashLightning();
      if (audio) {
        const delay = RG.rand(220, 1100);
        setTimeout(() => audio.thunder(RG.rand(0.15, 0.9)), delay);
      }
    };

    try {
      game.best = parseInt(localStorage.getItem('deadline_best') || '0', 10) || 0;
    } catch (e) { game.best = 0; }
    dom.best.textContent = RG.formatNumber(game.best);
    dom.startBest.textContent = RG.formatNumber(game.best);
    if (weather) weather.forceClear();
    world.setWetScreen(0);
    playerCar.setHeadlights(0.6);
    updateCamera(1, true);
  }

  /* ---------------- game preparation ---------------- */
  function prepareMenu() {
    game.state = 'menu';
    game.z = game.z || 0;
    game.lateral = 0;
    game.lateralVel = 0;
    game.speed = 24;
    game.score = 0;
    game.health = 100;
    game.distance = 0;
    game.combo = 1;
    game.comboTimer = 0;
    game.kills = 0;
    game.maxCombo = 1;
    game.invuln = 0;
    game.shake = 0;
    game.deathTimer = 0;
    game.runTime = 0;
    input.left = input.right = input.brake = input.boost = false;
    weather.forceClear();
    hideOverlays();
    dom.startScreen.classList.add('is-visible');
    dom.hud.classList.add('is-hidden');
    dom.touch.style.display = 'none';
    dom.startBest.textContent = RG.formatNumber(game.best);
    audio.silenceEngine();
    playerCar.setVisible(true);
    cameraSnapped = false;
    for (const z of zombies) { z.active = false; z.root.visible = false; }
    for (const p of pickups) p.hide();
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      car.spawn(game.z + 100 + i * 44 + RG.rand(-12, 12), i % 4, trafficTypeForScore(0));
    }
    updateWeatherHud(true);
    updateHud(true);
  }

  function startGame() {
    audio.init();
    game.state = 'playing';
    game.runStartZ = game.z;
    game.distance = 0;
    game.score = 0;
    game.displayScore = -1;
    game.health = 100;
    game.speed = 28;
    game.lateral = RG.clamp(game.lateral, -2, 2) * 0.3;
    game.lateralVel = 0;
    game.combo = 1;
    game.comboTimer = 0;
    game.maxCombo = 1;
    game.kills = 0;
    game.invuln = 1.2;
    game.shake = 0;
    game.deathTimer = 0;
    game.runTime = 0;
    game.pickupTimer = 5;
    game.newBest = false;
    input.left = input.right = input.brake = input.boost = false;
    weather.forceClear();
    updateWeatherHud(true);
    playerCar.setVisible(true);
    playerCar.bodyPivot.rotation.set(0, 0, 0);
    getHomeElementsForRun();

    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const z = game.z + 110 + i * 38 + RG.rand(-10, 18);
      car.spawn(z, i % 4, trafficTypeForScore(0));
    }
    for (const z of zombies) spawnZombie(z, true);
    for (const p of pickups) { p.hide(); p.respawnTimer = 0; }
    const firstPickup = pickups[0];
    firstPickup.spawn(game.z + 320, RG.pick(0, 1, 2, 3));
    for (let i = 1; i < pickups.length; i++) pickups[i].respawnTimer = RG.rand(12, 22);

    hideOverlays();
    dom.startScreen.classList.remove('is-visible');
    dom.hud.classList.remove('is-hidden');
    dom.touch.style.display = '';
    dom.toastLayer.innerHTML = '';
    cameraSnapped = false;
    showToast('IGNITION // 逃亡开始', false, 1.2);
  }

  function getHomeElementsForRun() {
    dom.gameoverScreen.classList.remove('is-visible');
    dom.pauseScreen.classList.remove('is-visible');
  }

  function hideOverlays() {
    dom.startScreen.classList.remove('is-visible');
    dom.pauseScreen.classList.remove('is-visible');
    dom.gameoverScreen.classList.remove('is-visible');
  }

  function goHome() {
    if (game.state === 'menu') return;
    game.best = Math.max(game.best, Math.floor(game.score));
    try { localStorage.setItem('deadline_best', String(game.best)); } catch (e) {}
    dom.best.textContent = RG.formatNumber(game.best);
    prepareMenu();
    dom.startBest.textContent = RG.formatNumber(game.best);
  }

  function togglePause(forcePause) {
    if (game.state === 'playing') {
      game.state = 'paused';
      dom.pauseScreen.classList.add('is-visible');
      audio.silenceEngine();
    } else if (game.state === 'paused' && !forcePause) {
      game.state = 'playing';
      dom.pauseScreen.classList.remove('is-visible');
      audio.init();
    }
  }

  function startDying() {
    if (game.state !== 'playing') return;
    game.state = 'dying';
    game.deathTimer = 1.65;
    game.shake = 2.4;
    game.speed *= 0.4;
    game.health = 0;
    audio.crash();
    audio.silenceEngine();
    const pos = currentPlayerPos();
    addParticles.emit(pos, quality.mobile ? 40 : 80, {
      colors: [0xffd08a, 0xff5824, 0xffb12b], speed: [5, 20], size: [0.25, 0.9],
      life: [0.4, 1.3], gravity: -10, drag: 1.1, spread: 1.0
    });
    normalParticles.emit(pos, quality.mobile ? 24 : 45, {
      colors: [0x282a28, 0x121312, 0x4a443a], speed: [1, 7], size: [0.8, 2.6],
      life: [1, 2.8], gravity: 0.8, drag: 1.4, spread: 1.3, upMin: 0.1, upMax: 1
    });
  }

  function finishRun() {
    game.state = 'gameover';
    game.newBest = Math.floor(game.score) > game.best;
    if (game.newBest) {
      game.best = Math.floor(game.score);
      try { localStorage.setItem('deadline_best', String(game.best)); } catch (e) {}
    }
    playerCar.setVisible(false);
    audio.silenceEngine();
    dom.finalScore.textContent = RG.formatNumber(game.score);
    dom.finalDistance.textContent = (game.distance / 1000).toFixed(1);
    dom.finalKills.textContent = RG.formatNumber(game.kills);
    dom.finalCombo.textContent = '×' + game.maxCombo;
    dom.newRecord.classList.toggle('show', game.newBest);
    dom.gameoverText.textContent = game.newBest
      ? '你刷新了自己的纪录。公路记住了你的车灯，但尸潮不会停下。'
      : '公路吞没了你的车灯。下一次，别让尸潮追上来。';
    dom.best.textContent = RG.formatNumber(game.best);
    dom.startBest.textContent = RG.formatNumber(game.best);
    dom.hud.classList.add('is-hidden');
    dom.touch.style.display = 'none';
    dom.gameoverScreen.classList.add('is-visible');
    updateHud(true);
  }

  /* ---------------- input ---------------- */
  function bindInput() {
    const downCodes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'ShiftRight'];
    window.addEventListener('keydown', (e) => {
      if (downCodes.includes(e.code)) e.preventDefault();
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') input.right = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') input.brake = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.boost = true;
      if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
      if (e.code === 'KeyM') toggleMute();
      if (e.code === 'KeyF') toggleFullscreen();
      if (e.code === 'Enter') {
        if (game.state === 'menu') startGame();
        else if (game.state === 'gameover') startGame();
      }
      if (e.code === 'KeyR' && game.state === 'gameover') startGame();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') input.right = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') input.brake = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.boost = false;
    });
    window.addEventListener('blur', () => {
      input.left = input.right = input.brake = input.boost = false;
    });

    bindTouchButton(dom.touchLeft, 'left');
    bindTouchButton(dom.touchRight, 'right');
    bindTouchButton(dom.touchBoost, 'boost');
  }

  function bindTouchButton(el, key) {
    if (!el) return;
    const on = (e) => {
      e.preventDefault();
      input[key] = true;
      el.classList.add('pressed');
      if (el.setPointerCapture && e.pointerId !== undefined) {
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
      }
    };
    const off = (e) => {
      if (e) e.preventDefault();
      input[key] = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', on, { passive: false });
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  function bindUI() {
    dom.startBtn.addEventListener('click', startGame);
    dom.resumeBtn.addEventListener('click', () => togglePause(false));
    dom.pauseRestartBtn.addEventListener('click', startGame);
    dom.restartBtn.addEventListener('click', startGame);
    dom.homeBtn.addEventListener('click', goHome);
    dom.muteBtn.addEventListener('click', toggleMute);
    dom.startScreen.addEventListener('pointerdown', (e) => {
      if (e.target === dom.startScreen || e.target.classList.contains('start-grid')) {
        // Intentionally do nothing; the ignition button is explicit.
      }
    });
  }

  function toggleMute() {
    if (!audio) return;
    audio.init();
    audio.setMuted(!audio.muted);
    dom.muteBtn.classList.toggle('muted', audio.muted);
    dom.muteBtn.textContent = audio.muted ? '×' : '♪';
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  /* ---------------- main loop ---------------- */
  function loop() {
    rafId = requestAnimationFrame(loop);
    const raw = Math.min(clock.getDelta(), 0.05);
    elapsed += raw;

    if (game.state === 'playing') {
      updatePlaying(raw);
      stepWorldVisuals(raw, true);
      updateCamera(raw, false);
      updateHud(false);
    } else if (game.state === 'menu') {
      updateMenu(raw);
      stepWorldVisuals(raw, false);
      updateCamera(raw, false);
      updateHud(false);
    } else if (game.state === 'dying') {
      updateDying(raw);
      stepWorldVisuals(raw, true);
      updateCamera(raw, false);
      updateHud(false);
    } else if (game.state === 'gameover') {
      updateGameOver(raw);
      stepWorldVisuals(raw, false);
      updateCamera(raw, false);
      updateHud(true);
    } else if (game.state === 'paused') {
      // Keep the last frame alive and very gently breathing.
      stepWorldVisuals(raw * 0.08, false);
      updateCamera(raw * 0.15, false);
    }
    renderer.render(scene, camera);
  }

  function updateMenu(dt) {
    game.speed = RG.damp(game.speed, 26, 1.0, dt);
    game.z += game.speed * dt;
    game.lateralVel = RG.damp(game.lateralVel, 0, 4, dt);
    game.lateral *= Math.exp(-3 * dt);
    playerPos.x = RG.roadCenter(game.z) + game.lateral;
    playerPos.z = game.z;
    playerPos.speed = game.speed;
    weather.update(dt);
    updateTraffic(dt);
    const ste = 0;
    playerCar.update(dt, {
      x: playerPos.x, z: game.z, yaw: RG.roadYaw(game.z), steer: ste,
      speed: game.speed, boost: false, brake: false, pitch: 0, hidden: false
    });
    playerCar.setHeadlights(0.5);
    addParticles.update(dt);
    normalParticles.update(dt);
  }

  function updatePlaying(dt) {
    game.runTime += dt;
    game.invuln = Math.max(0, game.invuln - dt);
    game.shake = Math.max(0, game.shake - dt * 2.3);
    game.comboTimer = Math.max(0, game.comboTimer - dt);
    if (game.comboTimer <= 0 && game.combo > 1) {
      game.combo = 1;
      updateHud(false);
    }

    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    game.steer = steer;
    game.braking = input.brake;
    game.boosting = input.boost && !input.brake && game.speed > 12;

    const weatherDef = weather.current;
    const grip = 1 - weatherDef.wetness * 0.24;
    const targetLat = steer * (9.2 + Math.min(5.5, game.speed * 0.05)) * grip;
    game.lateralVel = RG.damp(game.lateralVel, targetLat, steer ? 7.2 : 5.4, dt);
    game.lateral += game.lateralVel * dt;
    if (Math.abs(game.lateral) > RG.PLAYER_LIMIT) {
      game.lateral = RG.clamp(game.lateral, -RG.PLAYER_LIMIT, RG.PLAYER_LIMIT);
      game.lateralVel *= -0.12;
      game.health = Math.max(0, game.health - dt * 1.8);
      game.shake = Math.max(game.shake, 0.2);
    }

    const baseSpeed = baseSpeedForScore(game.score);
    let target = baseSpeed;
    if (game.boosting) target += 17;
    if (input.brake) target = Math.min(target, 13);
    const layer = input.brake ? 3.2 : game.boosting ? 2.35 : 0.95;
    game.speed = RG.damp(game.speed, target, layer, dt);
    const beforeZ = game.z;
    game.z += game.speed * dt;
    game.distance += Math.max(0, game.z - beforeZ);

    const scoreGain = dt * (11 + game.speed * 1.25) * (1 + (game.combo - 1) * 0.12);
    game.score += scoreGain;
    weather.setScore(game.score);
    weather.update(dt);

    playerPos.x = RG.roadCenter(game.z) + game.lateral;
    playerPos.z = game.z;
    playerPos.speed = game.speed;

    updateTraffic(dt);
    updateZombies(dt);
    updatePickups(dt);
    checkTrafficCollisions();
    checkZombieCollisions();
    checkPickupCollisions();

    if (game.health <= 0) {
      startDying();
      return;
    }
    if (game.health < 34) {
      dom.hurtVignette.style.opacity = String(0.20 + (1 - game.health / 34) * 0.5 + Math.sin(elapsed * 4) * 0.06);
    } else {
      dom.hurtVignette.style.opacity = '0';
    }

    const yaw = Math.atan2(RG.roadSlope(game.z) + game.lateralVel / Math.max(12, game.speed), 1);
    const pitch = game.boosting ? 0.018 : input.brake ? 0.03 : 0;
    playerCar.update(dt, {
      x: playerPos.x, z: game.z, yaw: yaw, steer: steer, speed: game.speed,
      boost: game.boosting, brake: input.brake, pitch: pitch, hidden: false
    });
    playerCar.setHeadlights(weather.current.headlights);

    updateBoostFx(dt);
    addParticles.update(dt);
    normalParticles.update(dt);
    spawnSpeedParticles(dt);
  }

  function updateDying(dt) {
    game.deathTimer -= dt;
    game.speed = RG.damp(game.speed, 0, 1.6, dt);
    game.z += game.speed * dt;
    game.lateralVel = RG.damp(game.lateralVel, 0, 3, dt);
    game.lateral = RG.clamp(game.lateral + game.lateralVel * dt, -RG.PLAYER_LIMIT, RG.PLAYER_LIMIT);
    game.shake = Math.max(0, game.shake - dt * 0.8);
    playerPos.x = RG.roadCenter(game.z) + game.lateral;
    playerPos.z = game.z;
    playerPos.speed = game.speed;
    updateTraffic(dt);
    updateZombies(dt);
    updatePickups(dt);
    weather.update(dt);

    if (game.deathTimer > 0.4 && Math.random() < dt * 25) {
      const pos = currentPlayerPos();
      normalParticles.emit(pos, 2, {
        colors: [0x1b1c1a, 0x32312b, 0x0f0f0f], speed: [0.4, 2.6], size: [0.5, 1.8],
        life: [0.7, 1.8], gravity: 0.7, drag: 1.2, spread: 0.8, upMin: 0.2, upMax: 1
      });
    }
    addParticles.update(dt);
    normalParticles.update(dt);
    if (Math.random() < dt * 8) {
      addParticles.emit(currentPlayerPos(), 4, {
        colors: [0xffa343, 0xff4e1f], speed: [1, 4], size: [0.25, 0.7],
        life: [0.25, 0.7], gravity: -4, drag: 1.2, spread: 0.7
      });
    }

    const yaw = RG.roadYaw(game.z);
    playerCar.update(dt, {
      x: playerPos.x, z: game.z, yaw: yaw, steer: 0, speed: game.speed,
      boost: false, brake: false, pitch: 0.06, hidden: false
    });
    playerCar.setHeadlights(weather.current.headlights);
    if (game.deathTimer <= 0) finishRun();
  }

  function updateGameOver(dt) {
    game.lateralVel = RG.damp(game.lateralVel, 0, 1, dt);
    game.speed = RG.damp(game.speed, 0, 2, dt);
    addParticles.update(dt);
    normalParticles.update(dt);
    weather.update(dt * 0.3);
  }

  function stepWorldVisuals(dt, active) {
    const headlights = weather.current.headlights;
    playerCar.setHeadlights(headlights);
    const w = weather.current;
    world.setWetScreen(w.wetness);
    world.update(dt, playerPos, camera, elapsed, weather);
    if (audio) {
      audio.update(RG.clamp(game.speed / 80, 0, 1), game.boosting && active, w.rain, active && game.state !== 'paused');
    }
    dom.wetOverlay.style.opacity = String(w.wetness * 0.72);
    dom.speedFx.style.opacity = String(RG.clamp((game.speed - 34) / 55, 0, 1) * 0.9);
  }

  /* ---------------- world entities ---------------- */
  function baseSpeedForScore(score) {
    const difficulty = Math.min(1, score / 4000);
    let base = 29 + difficulty * 27;
    if (score > 4000) base += Math.min(12, (score - 4000) / 700);
    return Math.min(70, base);
  }

  function trafficTypeForScore(score) {    const r = Math.random();
    if (score > 2200) {
      if (r < 0.18) return 'truck';
      if (r < 0.4) return 'van';
      if (r < 0.7) return 'sedan';
      return 'hatch';
    }
    if (score > 900) {
      if (r < 0.1) return 'truck';
      if (r < 0.3) return 'van';
      if (r < 0.68) return 'sedan';
      return 'hatch';
    }
    if (r < 0.06) return 'van';
    if (r < 0.55) return 'sedan';
    return 'hatch';
  }

  function findTrafficRespawn(car) {
    for (let attempt = 0; attempt < 7; attempt++) {
      const lane = RG.randInt(0, 3);
      const z = game.z + RG.rand(220, 560);
      let conflict = false;
      for (const other of traffic) {
        if (other === car || !other.active) continue;
        if (other.lane === lane && Math.abs(other.z - z) < 34) { conflict = true; break; }
      }
      if (!conflict) {
        car.spawn(z, lane, trafficTypeForScore(game.score));
        return;
      }
    }
    car.spawn(game.z + RG.rand(300, 620), RG.randInt(0, 3), trafficTypeForScore(game.score));
  }

  function updateTraffic(dt) {
    for (const car of traffic) {
      if (!car.active) continue;
      car.update(dt);
      if (car.z < game.z - 95 || car.z > game.z + 920) findTrafficRespawn(car);
    }
  }

  function checkTrafficCollisions() {
    const px = RG.roadCenter(game.z) + game.lateral;
    for (const car of traffic) {
      if (!car.active) continue;
      const dz = car.z - game.z;
      const carX = RG.roadCenter(car.z) + car.laneOffset;
      const lateralGap = Math.abs(carX - px);

      if (!car.passed && dz < -3.0) {
        car.passed = true;
        if (lateralGap > 1.2 && lateralGap < 4.1 && dz > -8 && game.invuln <= 0) {
          awardNearMiss(car);
        }
      }
      if (dz > 8) car.passed = false;

      const hitZ = Math.abs(dz) < (car.length / 2 + 2.25 - 0.15);
      const hitX = lateralGap < (car.width / 2 + 0.95) * 0.9;
      if (hitZ && hitX && game.invuln <= 0 && car.cool <= 0 && game.state === 'playing') {
        collideWithTraffic(car, carX, px);
      }
    }
  }

  function collideWithTraffic(car, carX, px) {
    const damage = car.damage * RG.rand(0.82, 1.16);
    game.health = Math.max(0, game.health - damage);
    game.speed *= 0.32;
    game.invuln = 1.15;
    game.shake = 1.25;
    car.cool = 3.2;
    if (game.combo > 1) showToast('连击中断', true, 1.1);
    game.combo = 1;
    game.comboTimer = 0;
    const dir = Math.sign(px - carX) || RG.signNoZero();
    game.lateralVel = dir * 7.5;
    game.lateral = RG.clamp(game.lateral + dir * 1.1, -RG.PLAYER_LIMIT, RG.PLAYER_LIMIT);
    game.z = Math.min(game.z, car.z - car.length / 2 - 2.2);

    const p = { x: (px + carX) / 2, y: 0.7, z: car.z - car.length / 2 };
    addParticles.emit(p, quality.mobile ? 15 : 28, {
      colors: [0xfff3bd, 0xff9c35, 0xff4b1d], speed: [3, 13], size: [0.14, 0.55],
      life: [0.25, 0.8], gravity: -12, drag: 1.3, spread: 0.6, upMin: 0.05, upMax: 1
    });
    normalParticles.emit(p, 8, {
      colors: [0x242321, 0x3d3b34, 0x8f887b], speed: [1, 4], size: [0.6, 1.7],
      life: [0.5, 1.4], gravity: 1.4, drag: 1.5, spread: 0.8, upMin: 0.1, upMax: 1
    });
    audio.crash();
    flashDamage();
    if (game.health <= 0) startDying();
  }

  function awardNearMiss(car) {
    const points = Math.floor(36 * game.combo);
    game.score += points;
    increaseCombo();
    game.shake = Math.max(game.shake, 0.12);
    if (elapsed - game.lastToast > 0.9) {
      showToast(`擦肩而过 <strong>+${points}</strong>`, false, 1.1);
      game.lastToast = elapsed;
    }
  }

  function increaseCombo() {
    game.combo = Math.min(10, game.combo + 1);
    game.comboTimer = 4.8;
    game.maxCombo = Math.max(game.maxCombo, game.combo);
  }

  function pickZombieType(score) {
    const r = Math.random();
    if (score < 300) {
      return r < 0.82 ? 'walker' : 'runner';
    }
    if (score < 850) {
      if (r < 0.52) return 'walker';
      if (r < 0.82) return 'runner';
      if (r < 0.94) return 'toxic';
      return 'brute';
    }
    if (score < 1700) {
      if (r < 0.34) return 'walker';
      if (r < 0.67) return 'runner';
      if (r < 0.84) return 'toxic';
      return 'brute';
    }
    if (r < 0.22) return 'walker';
    if (r < 0.5) return 'runner';
    if (r < 0.72) return 'toxic';
    return 'brute';
  }

  function spawnZombie(zombie, initial) {
    const type = pickZombieType(game.score);
    const min = initial ? 105 : 170;
    const max = initial ? 590 : 560;
    const z = game.z + RG.rand(min, max) + (initial ? RG.rand(0, 120) : 0);
    let lateral;
    if (Math.random() < 0.72) lateral = RG.pick(RG.LANES) + RG.rand(-0.7, 0.7);
    else lateral = RG.rand(-6.9, 6.9);
    zombie.spawn(z, lateral, type, 1 + Math.min(0.6, game.score / 8000));
    zombie.respawnTimer = 0;
  }

  function updateZombies(dt) {
    for (const zombie of zombies) {
      if (!zombie.active) {
        if (zombie.respawnTimer > 0) {
          zombie.respawnTimer -= dt;
          if (zombie.respawnTimer <= 0) spawnZombie(zombie, false);
        }
        continue;
      }
      zombie.update(dt, game.z, elapsed);
      if (zombie.z < game.z - 85 || zombie.z > game.z + 800) {
        spawnZombie(zombie, false);
      }
    }
  }

  function checkZombieCollisions() {
    const px = RG.roadCenter(game.z) + game.lateral;
    for (const zombie of zombies) {
      if (!zombie.active) continue;
      const dz = game.z - zombie.z;
      if (Math.abs(dz) > 2.7) continue;
      const zx = RG.roadCenter(zombie.z) + zombie.lateral;
      if (Math.abs(zx - px) > 1.55) continue;
      const info = RG.ZOMBIE_TYPES[zombie.type];
      const points = Math.floor(info.score * game.combo);
      game.score += points;
      game.kills++;
      game.health = Math.max(0, game.health - info.damage);
      game.speed *= zombie.type === 'brute' ? 0.55 : 0.77;
      game.shake = Math.max(game.shake, zombie.type === 'brute' ? 1.2 : 0.72);
      increaseCombo();
      const p = currentPlayerPos();
      const hitPos = { x: zx, y: 1.1, z: zombie.z };
      addParticles.emit(hitPos, quality.mobile ? 12 : 24, {
        colors: zombie.type === 'toxic' ? [0x8aff55, 0x3fff30, 0xc6ff98] : [0xa33b24, 0x742616, 0x3c1610],
        speed: [2, 9], size: [0.15, 0.6], life: [0.35, 1.0], gravity: -10,
        drag: 1.2, spread: 0.6, upMin: 0.1, upMax: 1
      });
      if (zombie.type === 'toxic') {
        addParticles.emit(hitPos, 25, {
          colors: [0x8aff55, 0x57ff27, 0xd1ffab], speed: [1, 7], size: [0.3, 1.2],
          life: [0.5, 1.5], gravity: -1.5, drag: 1.4, spread: 1.2, upMin: 0, upMax: 1
        });
      }
      if (elapsed - game.lastToast > 0.65) {
        showToast(`撞飞 ${info.name} <strong>+${points}</strong>`, false, 1.15);
        game.lastToast = elapsed;
      }
      audio.impact(0.75);
      zombie.kill();
      zombie.respawnTimer = RG.rand(0.8, 2.0);
      if (game.health <= 0) {
        startDying();
        return;
      }
    }
  }

  function updatePickups(dt) {
    game.pickupTimer -= dt;
    let activeCount = 0;
    for (const p of pickups) {
      if (p.active) {
        p.update(dt, elapsed);
        activeCount++;
        if (p.z < game.z - 40) {
          p.hide();
          p.respawnTimer = RG.rand(5, 10);
        }
      } else if (p.respawnTimer === undefined) {
        p.respawnTimer = RG.rand(10, 20);
      } else if (p.respawnTimer > 0) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0 && activeCount < 2) {
          p.spawn(game.z + RG.rand(250, 520), RG.pick(RG.LANES) + RG.rand(-0.4, 0.4));
          activeCount++;
        }
      }
    }
    if (activeCount < 1 && game.pickupTimer <= 0) {
      game.pickupTimer = 9;
      const available = pickups.find((p) => !p.active);
      if (available) available.spawn(game.z + RG.rand(260, 480), RG.pick(RG.LANES));
    }
  }

  function checkPickupCollisions() {
    const px = RG.roadCenter(game.z) + game.lateral;
    for (const p of pickups) {
      if (!p.active) continue;
      const dz = game.z - p.z;
      if (Math.abs(dz) < 2.3) {
        const x = RG.roadCenter(p.z) + p.lateral;
        if (Math.abs(x - px) < 1.7) {
          game.health = Math.min(100, game.health + 26);
          game.score += 80 * game.combo;
          p.hide();
          p.respawnTimer = RG.rand(13, 22);
          audio.pickup();
          showToast('应急维修包 <strong>车体 +26</strong>', false, 1.4);
          dom.hurtVignette.style.opacity = '0';
        }
      }
    }
  }

  /* ---------------- particles and fx ---------------- */
  function spawnSpeedParticles(dt) {
    if (game.state !== 'playing') return;
    game.particleTimer -= dt;
    if (game.particleTimer > 0) return;
    game.particleTimer = weather.current.rain > 0.2 ? 0.045 : 0.11;
    if (game.boosting) {
      const p = currentPlayerPos();
      addParticles.emit({ x: p.x, y: 0.36, z: p.z - 2.65 }, 1, {
        colors: [0x75d5ff, 0xff6d24, 0xffd38a], speed: [1.2, 4.2],
        size: [0.12, 0.36], life: [0.12, 0.4], gravity: 0.5, drag: 2.4,
        spread: 0.22, upMin: -0.05, upMax: 0.3
      });
    }
    if (weather.current.rain > 0.25 && game.speed > 28) {
      const p = currentPlayerPos();
      normalParticles.emit({ x: p.x, y: 0.25, z: p.z - 1.3 }, 1, {
        colors: [0x93a8b3, 0xc3d7df], speed: [0.3, 2.2], size: [0.12, 0.44],
        life: [0.15, 0.5], gravity: -4, drag: 2, spread: 0.3, upMin: 0.15, upMax: 0.7
      });
    }
  }

  function updateBoostFx(dt) {
    dom.boostHint.classList.toggle('active', game.boosting);
    const kmh = game.speed * 3.6;
    const ratio = RG.clamp(kmh / 330, 0, 1);
    dom.speedArc.style.strokeDashoffset = String(SPEED_RING * (1 - ratio));
    dom.speedArc.style.stroke = game.boosting ? '#9ed8ff' : (game.health < 34 ? '#ff4d24' : '#ff673e');
    dom.speedValue.textContent = String(Math.round(kmh));
    dom.gearValue.textContent = input.brake ? 'B' : game.boosting ? 'S' : 'D';
    dom.boostHint.querySelector('b').textContent = game.boosting ? '涡轮全开' : '涡轮增压';
  }

  const currentPosVec = new THREE.Vector3();
  function currentPlayerPos() {
    currentPosVec.set(RG.roadCenter(game.z) + game.lateral, 0.5, game.z);
    return currentPosVec;
  }

  function flashDamage() {
    dom.damageFlash.style.transition = 'none';
    dom.damageFlash.style.opacity = '0.9';
    requestAnimationFrame(() => {
      dom.damageFlash.style.transition = 'opacity .55s ease';
      dom.damageFlash.style.opacity = '0';
    });
  }

  function flashLightning() {
    dom.lightningFlash.style.transition = 'none';
    dom.lightningFlash.style.opacity = '0.75';
    setTimeout(() => {
      dom.lightningFlash.style.opacity = '0.22';
      setTimeout(() => {
        dom.lightningFlash.style.transition = 'opacity .45s ease';
        dom.lightningFlash.style.opacity = '0';
      }, 80);
    }, 55);
  }

  function showWeatherAlert(preset) {
    if (!preset) return;
    dom.weatherAlert.classList.remove('danger', 'cold');
    if (preset.key === 'storm' || preset.key === 'rain') dom.weatherAlert.classList.add('danger');
    if (preset.key === 'fog') dom.weatherAlert.classList.add('cold');
    dom.alertIcon.textContent = preset.icon;
    dom.alertName.textContent = preset.name;
    dom.weatherAlert.classList.add('show');
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => dom.weatherAlert.classList.remove('show'), 3800);
  }

  function showToast(html, danger, duration) {
    const div = document.createElement('div');
    div.className = 'toast' + (danger ? ' danger' : '');
    div.innerHTML = html;
    dom.toastLayer.appendChild(div);
    while (dom.toastLayer.children.length > 3) dom.toastLayer.removeChild(dom.toastLayer.firstChild);
    const life = (duration || 1.5) * 1000;
    setTimeout(() => {
      div.classList.add('out');
      setTimeout(() => div.remove(), 380);
    }, life);
  }

  /* ---------------- camera ---------------- */
  function updateCamera(dt, snap) {
    const yaw = RG.roadYaw(game.z);
    const dirX = Math.sin(yaw);
    const dirZ = Math.cos(yaw);
    const carX = RG.roadCenter(game.z) + game.lateral;
    const chase = 8.6 + Math.min(3.6, game.speed * 0.032);
    const height = 3.3 + Math.min(1.4, game.speed * 0.018);
    const speedLean = game.steer * 0.24 * RG.clamp(game.speed / 55, 0, 1);
    tempVec.set(
      carX - dirX * chase + Math.cos(yaw) * speedLean,
      height,
      game.z - dirZ * chase - Math.sin(yaw) * speedLean
    );
    tempLook.set(
      RG.roadCenter(game.z + 32) + game.lateral * 0.4,
      1.15,
      game.z + 32
    );

    if (snap || !cameraSnapped) {
      camera.position.copy(tempVec);
      camLook.copy(tempLook);
      cameraSnapped = true;
    } else {
      const posK = 1 - Math.exp(-5.2 * dt);
      const lookK = 1 - Math.exp(-6.4 * dt);
      camera.position.lerp(tempVec, posK);
      camLook.lerp(tempLook, lookK);
    }

    const targetFov = 61 + RG.clamp((game.speed - 20) / 68, 0, 1) * 11 + (game.boosting ? 5 : 0);
    camera.fov = RG.damp(camera.fov, targetFov, 2.4, dt);
    camera.updateProjectionMatrix();
    camera.lookAt(camLook);

    if (game.shake > 0.01) {
      const s = game.shake * game.shake;
      camera.position.x += RG.rand(-1, 1) * s * 0.32;
      camera.position.y += RG.rand(-1, 1) * s * 0.22;
      camera.rotateZ(RG.rand(-1, 1) * s * 0.018);
    }
    if (game.boosting) {
      camera.rotateZ(RG.rand(-1, 1) * 0.0009);
    }
    camera.rotateZ(-game.steer * 0.007 * RG.clamp(game.speed / 55, 0, 1));
  }

  /* ---------------- HUD ---------------- */
  function updateHud(force) {
    const sc = Math.floor(game.score);
    if (force || sc !== game.displayScore) {
      dom.score.textContent = RG.formatNumber(sc);
      game.displayScore = sc;
      dom.score.classList.remove('bump');
      void dom.score.offsetWidth;
      dom.score.classList.add('bump');
    }
    const best = Math.max(game.best, sc);
    dom.best.textContent = RG.formatNumber(best);
    dom.distance.textContent = (game.distance / 1000).toFixed(1);
    const hp = Math.round(RG.clamp(game.health, 0, 100));
    dom.healthValue.innerHTML = hp + '<span>%</span>';
    dom.healthFill.style.width = hp + '%';
    dom.healthTrack.classList.toggle('low', hp < 34);
    dom.comboTag.classList.toggle('show', game.combo > 1);
    dom.comboTag.textContent = '×' + game.combo;
    dom.comboValue.textContent = '×' + game.combo;
    dom.comboFill.style.width = (game.combo > 1 ? (game.comboTimer / 4.8) * 100 : 0) + '%';
    const kmh = game.speed * 3.6;
    dom.speedValue.textContent = String(Math.round(kmh));
    const ratio = RG.clamp(kmh / 330, 0, 1);
    dom.speedArc.style.strokeDashoffset = String(SPEED_RING * (1 - ratio));
    dom.speedArc.style.stroke = game.boosting ? '#9ed8ff' : (hp < 34 ? '#ff4d24' : '#ff673e');
    dom.gearValue.textContent = input.brake ? 'B' : game.boosting ? 'S' : 'D';
    dom.boostHint.classList.toggle('active', game.boosting);

    const stageNum = Math.floor(game.score / 800) + 1;
    dom.stageLabel.textContent = '感染区 ' + String(stageNum).padStart(2, '0');
    dom.threatValue.textContent = game.score < 600 ? '低' : game.score < 1400 ? '警戒' : game.score < 2500 ? '高危' : '致命';
    updateWeatherHud(force);
  }

  function updateWeatherHud(force) {
    if (!weather) return;
    const preset = RG.WEATHER_PRESETS[weather.stateKey] || weather.target;
    dom.weatherIcon.textContent = preset.icon;
    dom.weatherName.textContent = preset.name;
    dom.weatherNext.textContent = preset.note;
    const info = weather.describeNext(game.score);
    dom.weatherFill.style.width = (info.progress * 100).toFixed(1) + '%';
    dom.weatherNextLabel.textContent = info.key === 'storm' ? '闪电警报' : info.key === 'fog' ? '浓雾逼近' : info.key === 'rain' ? '暴雨逼近' : '云层聚集';
  }

  /* ---------------- misc ---------------- */
  function onResize() {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const mobile = window.matchMedia('(pointer: coarse)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.8));
  }

  // Expose a tiny debug surface for testing without affecting normal play.
  window.DEADLINE = {
    game, weather: () => weather, world: () => world, player: () => playerCar,
    start: startGame, pause: togglePause, menu: goHome
  };

})();
