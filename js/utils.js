/* DEADLINE - shared helpers, procedural textures and road math */
(function () {
  'use strict';
  const RG = window.RG = window.RG || {};
  const TAU = Math.PI * 2;

  RG.TAU = TAU;
  RG.ROAD_HALF = 9;
  RG.SHOULDER = 3.2;
  RG.PLAYER_LIMIT = 7.45;
  RG.LANES = [-6.75, -2.25, 2.25, 6.75];
  RG.SCENERY_SPAN = 900;

  RG.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  RG.lerp = (a, b, t) => a + (b - a) * t;
  RG.invLerp = (a, b, v) => (v - a) / (b - a);
  RG.damp = (a, b, lambda, dt) => RG.lerp(a, b, 1 - Math.exp(-lambda * dt));
  RG.smoothstep = (a, b, v) => {
    const t = RG.clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  RG.rand = (a, b) => a + Math.random() * (b - a);
  RG.randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  RG.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  RG.signNoZero = () => Math.random() < 0.5 ? -1 : 1;
  RG.formatNumber = (n) => Math.floor(n).toLocaleString('en-US');
  RG.hueColor = (h, s, l) => new THREE.Color().setHSL(h, s, l);

  // Stable deterministic noise used by the terrain and vegetation.
  function hash2(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
  function valueNoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    return RG.lerp(RG.lerp(a, b, u), RG.lerp(c, d, u), v);
  }
  function fbm(x, y, octaves) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < (octaves || 4); i++) {
      sum += valueNoise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }
  RG.hash2 = hash2;
  RG.valueNoise = valueNoise;
  RG.fbm = fbm;

  // A gently winding highway. X is lateral, Z is distance down the road.
  RG.roadCenter = function (z) {
    return Math.sin(z * 0.00315) * 26
      + Math.sin(z * 0.0087 + 1.3) * 6.5
      + Math.sin(z * 0.022 + 0.7) * 1.6;
  };
  RG.roadSlope = function (z) {
    return 26 * 0.00315 * Math.cos(z * 0.00315)
      + 6.5 * 0.0087 * Math.cos(z * 0.0087 + 1.3)
      + 1.6 * 0.022 * Math.cos(z * 0.022 + 0.7);
  };
  RG.roadYaw = function (z) {
    return Math.atan2(RG.roadSlope(z), 1);
  };
  RG.laneX = function (z, lane) {
    return RG.roadCenter(z) + RG.LANES[lane];
  };

  // Height of the landscape relative to the road. lateralAbs is the distance
  // from the road centre line, not from the edge. The roadside ditch blends
  // into rolling, multi-frequency hills with a flat verge around the highway.
  RG.terrainHeight = function (z, lateralAbs) {
    const d = Math.max(0, lateralAbs - 11.9);
    const edgeBlend = RG.smoothstep(0, 3.6, d);
    const hillRamp = RG.smoothstep(5, 34, d);
    const macro = fbm(z * 0.0055 + 7.1, lateralAbs * 0.011 + 3.2, 4) - 0.5;
    const meso = fbm(z * 0.021 - 4.2, lateralAbs * 0.038 + 9.8, 4) - 0.5;
    const hummock = fbm(z * 0.061 + 5.5, lateralAbs * 0.092 + 1.1, 3) - 0.5;
    const micro = fbm(z * 0.085 + 1.7, lateralAbs * 0.17, 2) - 0.5;
    const ditch = -0.2 * Math.exp(-Math.pow((d - 1.3) / 1.9, 2));
    const rise = Math.pow(d / 100, 1.48) * 15.5;
    const hills = macro * (4.0 + Math.min(10.0, d * 0.16)) * hillRamp;
    const detail = meso * (0.65 + Math.min(2.4, d * 0.055)) * hillRamp;
    const bumps = hummock * (0.34 + Math.min(0.95, d * 0.022)) * hillRamp;
    const ripple = micro * (0.12 + Math.min(0.45, d * 0.008)) * edgeBlend;
    const ridge = Math.sin(z * 0.014 + lateralAbs * 0.028) * 0.38 * hillRamp;
    return -0.08 + ditch + rise * edgeBlend + hills + detail + bumps + ripple + ridge;
  };

  RG.makeCanvasTexture = function (w, h, draw, opts) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = (opts && opts.wrapX) ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapT = (opts && opts.wrapY) ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.colorSpace = (opts && opts.data) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    tex.anisotropy = (opts && opts.aniso) || 1;
    tex.needsUpdate = true;
    return tex;
  };

  RG.createAsphaltTexture = function (aniso) {
    return RG.makeCanvasTexture(768, 768, (ctx, w, h) => {
      ctx.fillStyle = '#3b3d42';
      ctx.fillRect(0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        const n = (Math.random() - 0.5) * 30;
        data[i] = RG.clamp(data[i] + n, 0, 255);
        data[i + 1] = RG.clamp(data[i + 1] + n, 0, 255);
        data[i + 2] = RG.clamp(data[i + 2] + n * 0.9, 0, 255);
      }
      ctx.putImageData(img, 0, 0);

      // Long, subtle tyre-wear bands.
      const wear = ['rgba(12,13,16,.22)', 'rgba(20,21,24,.18)', 'rgba(10,11,14,.15)', 'rgba(23,24,27,.19)'];
      for (let lane = 0; lane < 4; lane++) {
        const cx = (lane + 0.5) / 4 * w;
        for (let i = -1; i <= 1; i += 2) {
          const grad = ctx.createLinearGradient(cx + i * 22 - 14, 0, cx + i * 22 + 14, 0);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(0.5, wear[lane]);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(cx + i * 22 - 14, 0, 28, h);
        }
      }

      // Aggregate patches and cracks.
      for (let i = 0; i < 1500; i++) {
        ctx.fillStyle = `rgba(${Math.random() < .5 ? '22,23,26' : '88,90,94'},${RG.rand(0.025, 0.09)})`;
        const s = RG.rand(0.5, 3.5);
        ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < 11; i++) {
        let x = Math.random() * w, y = Math.random() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let j = 0; j < 6; j++) {
          x += RG.rand(-12, 12); y += RG.rand(6, 36);
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(12,12,14,${RG.rand(.08, .2)})`;
        ctx.stroke();
      }

      // Lanes. Texture spans exactly one road width (18 m), repeated down-road.
      const line = (x, dash) => {
        ctx.save();
        ctx.strokeStyle = 'rgba(218,218,204,.8)';
        ctx.lineWidth = Math.max(5, w * 0.0085);
        ctx.setLineDash(dash ? [w * 0.085, w * 0.052] : []);
        ctx.beginPath();
        ctx.moveTo(x, -h * 0.1);
        ctx.lineTo(x, h * 1.1);
        ctx.stroke();
        ctx.restore();
      };
      line(w * 0.028, false);
      line(w * 0.972, false);
      line(w * 0.25, true);
      line(w * 0.5, true);
      line(w * 0.75, true);

      // Worn paint.
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = 'rgba(48,49,51,.35)';
        const lx = w * (Math.random() < .1 ? .028 : Math.random() > .9 ? .972 : RG.pick([.25, .5, .75]));
        ctx.fillRect(lx + RG.rand(-4, 4), Math.random() * h, RG.rand(2, 9), RG.rand(2, 12));
      }

      // Shoulder soot.
      const edge = ctx.createLinearGradient(0, 0, w, 0);
      edge.addColorStop(0, 'rgba(10,11,13,.3)');
      edge.addColorStop(.06, 'rgba(0,0,0,0)');
      edge.addColorStop(.94, 'rgba(0,0,0,0)');
      edge.addColorStop(1, 'rgba(10,11,13,.3)');
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, w, h);
    }, { wrapY: true, aniso: aniso });
  };

  RG.createAsphaltRoughness = function () {
    return RG.makeCanvasTexture(256, 512, (ctx, w, h) => {
      ctx.fillStyle = '#b8b8b8';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 450; i++) {
        const g = Math.floor(RG.rand(90, 225));
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.beginPath();
        ctx.ellipse(Math.random() * w, Math.random() * h, RG.rand(2, 32), RG.rand(1, 10), Math.random() * Math.PI, 0, TAU);
        ctx.fill();
      }
    }, { wrapY: true, data: true });
  };

  RG.createGravelTexture = function (aniso) {    return RG.makeCanvasTexture(384, 384, (ctx, w, h) => {
      ctx.fillStyle = '#454743';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 8000; i++) {
        const g = Math.floor(RG.rand(42, 128));
        ctx.fillStyle = `rgba(${g},${g - 2},${g - 7},${RG.rand(.2, .8)})`;
        const s = RG.rand(.5, 3);
        ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
      }
      for (let i = 0; i < 350; i++) {
        ctx.fillStyle = `rgba(${Math.floor(RG.rand(70, 112))},${Math.floor(RG.rand(70, 108))},${Math.floor(RG.rand(58, 90))},${RG.rand(.2,.6)})`;
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, RG.rand(1, 4), 0, TAU);
        ctx.fill();
      }
    }, { wrapY: true, aniso: aniso });
  };

  RG.createGrassTexture = function (aniso) {
    return RG.makeCanvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#a9ad90';
      ctx.fillRect(0, 0, w, h);

      // Broad dry / lush patches. Vertex colours add the very large-scale
      // tint; this layer keeps the tiled texture from reading as flat paint.
      for (let i = 0; i < 120; i++) {
        const g = ctx.createRadialGradient(
          Math.random() * w, Math.random() * h, 0,
          Math.random() * w, Math.random() * h, RG.rand(24, 130)
        );
        g.addColorStop(0, `rgba(${RG.randInt(82, 148)},${RG.randInt(92, 148)},${RG.randInt(55, 96)},${RG.rand(.07,.19)})`);
        g.addColorStop(1, 'rgba(105,116,74,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // Fine blades, clumps and organic debris.
      for (let i = 0; i < 12000; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const len = RG.rand(1.5, 6.5);
        const hue = Math.random() < 0.18 ? RG.rand(28, 48) : RG.rand(62, 105);
        ctx.strokeStyle = `hsla(${hue}, ${RG.rand(16, 38)}%, ${RG.rand(19, 58)}%, ${RG.rand(.12, .43)})`;
        ctx.lineWidth = RG.rand(.45, 1.6);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + RG.rand(-1.6, 1.6), y - len);
        ctx.stroke();
      }
      for (let i = 0; i < 260; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillStyle = `rgba(${RG.randInt(72, 126)},${RG.randInt(74, 119)},${RG.randInt(50, 88)},${RG.rand(.18,.5)})`;
        ctx.beginPath();
        ctx.ellipse(x, y, RG.rand(1, 4.5), RG.rand(.6, 2.4), Math.random() * Math.PI, 0, TAU);
        ctx.fill();
      }
      // Small dry tufts add a readable scale cue that survives mipmapping.
      for (let i = 0; i < 95; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.strokeStyle = `hsla(${RG.rand(34, 52)}, ${RG.rand(22, 40)}%, ${RG.rand(28, 48)}%, ${RG.rand(.2, .5)})`;
        ctx.lineWidth = RG.rand(.7, 1.6);
        for (let b = 0; b < 4; b++) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + RG.rand(-4, 4), y - RG.rand(3, 10));
          ctx.stroke();
        }
      }
      // Occasional pale rocks / dry stalks.
      for (let i = 0; i < 55; i++) {
        ctx.fillStyle = `rgba(${RG.randInt(120, 175)},${RG.randInt(120, 170)},${RG.randInt(100, 145)},${RG.rand(.14,.38)})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, RG.rand(1, 4), RG.rand(1, 3));
      }
    }, { wrapX: true, wrapY: true, aniso: aniso });
  };

  RG.createGlowTexture = function () {
    return RG.makeCanvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(.18, 'rgba(255,255,255,.92)');
      g.addColorStop(.45, 'rgba(255,255,255,.26)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  };

  RG.createSprite = function (tex, color, scale, opacity) {
    const mat = new THREE.SpriteMaterial({
      map: tex, color: color, transparent: true, opacity: opacity === undefined ? 1 : opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale, scale, 1);
    return sprite;
  };

  RG.createSignTexture = function (title, sub, accent) {
    return RG.makeCanvasTexture(1024, 384, (ctx, w, h) => {
      ctx.fillStyle = '#0d1a12';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = accent || '#c9e9b3';
      ctx.lineWidth = 12;
      ctx.strokeRect(20, 20, w - 40, h - 40);
      ctx.strokeStyle = 'rgba(255,255,255,.2)';
      ctx.lineWidth = 2;
      ctx.strokeRect(38, 38, w - 76, h - 76);
      ctx.fillStyle = accent || '#c9e9b3';
      ctx.font = '700 64px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(title, 75, 150);
      ctx.fillStyle = 'rgba(235,245,225,.65)';
      ctx.font = '28px "Cascadia Mono", monospace';
      ctx.fillText(sub, 78, 216);
      ctx.fillStyle = 'rgba(255,77,36,.9)';
      ctx.fillRect(78, 262, 130, 7);
      ctx.font = '20px "Cascadia Mono", monospace';
      ctx.fillStyle = 'rgba(255,255,255,.34)';
      ctx.fillText('EVACUATION ROUTE  //  KEEP MOVING', 78, 316);
      // Weathering.
      for (let i = 0; i < 130; i++) {
        ctx.fillStyle = `rgba(0,0,0,${RG.rand(.03,.16)})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, RG.rand(3, 60), RG.rand(1, 4));
      }
    });
  };

  RG.disposeObject = function (obj) {
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.isMesh && child.material) {
        // Materials are shared by design, so only geometry is released.
      }
      if (child.isSprite && child.material) {
        // Sprite materials are created per object in a few places; leave texture alive.
      }
    });
  };

  RG.lerpColor = function (out, a, b, t) {
    out.r = RG.lerp(a.r, b.r, t);
    out.g = RG.lerp(a.g, b.g, t);
    out.b = RG.lerp(a.b, b.b, t);
    return out;
  };

})();
