/* Real-time procedural weather state machine. All visuals are interpolated. */
(function () {
  'use strict';
  const RG = window.RG;

  const C = (hex) => new THREE.Color(hex);

  const PRESETS = {
    clear: {
      key: 'clear', name: '晴朗', icon: '☀', note: '能见度极佳',
      fogColor: C(0x9fc0d5), fogDensity: 0.00135,
      skyTop: C(0x1e5d9b), skyHorizon: C(0xbcd8e6), cloudColor: C(0xdde8ea),
      cloudCover: 0.18, cloudDark: 0.06, sunColor: C(0xfff0ca),
      sunIntensity: 3.15, hemiSky: C(0xa8d5f5), hemiGround: C(0x656343),
      hemiIntensity: 1.32, exposure: 1.04, sunElevation: 0.62, sunAzimuth: 0.72,
      rain: 0, wetness: 0.02, headlights: 0.05, lightningRate: 0,
      fogTint: 'rgba(140,185,205,.08)'
    },
    overcast: {
      key: 'overcast', name: '阴云密布', icon: '☁', note: '光线正在变暗',
      fogColor: C(0x8b999f), fogDensity: 0.0032,
      skyTop: C(0x51626d), skyHorizon: C(0x9ca8ab), cloudColor: C(0x899597),
      cloudCover: 0.82, cloudDark: 0.35, sunColor: C(0xe7e4d2),
      sunIntensity: 0.9, hemiSky: C(0x849aa6), hemiGround: C(0x484c40),
      hemiIntensity: 0.96, exposure: 0.9, sunElevation: 0.57, sunAzimuth: 0.5,
      rain: 0.04, wetness: 0.16, headlights: 0.34, lightningRate: 0,
      fogTint: 'rgba(125,145,150,.14)'
    },
    rain: {
      key: 'rain', name: '暴雨', icon: '🌧', note: '路面湿滑 · 能见度低',
      fogColor: C(0x657278), fogDensity: 0.0055,
      skyTop: C(0x293b46), skyHorizon: C(0x6e7f84), cloudColor: C(0x59696e),
      cloudCover: 0.98, cloudDark: 0.62, sunColor: C(0xc6d4d2),
      sunIntensity: 0.32, hemiSky: C(0x68828d), hemiGround: C(0x394138),
      hemiIntensity: 0.74, exposure: 0.8, sunElevation: 0.52, sunAzimuth: 0.35,
      rain: 0.68, wetness: 0.72, headlights: 0.82, lightningRate: 0.08,
      fogTint: 'rgba(80,105,115,.22)'
    },
    storm: {
      key: 'storm', name: '雷暴', icon: '⛈', note: '闪电频繁 · 极速禁区',
      fogColor: C(0x364146), fogDensity: 0.0082,
      skyTop: C(0x0c151b), skyHorizon: C(0x3d4b50), cloudColor: C(0x27353b),
      cloudCover: 1.0, cloudDark: 0.94, sunColor: C(0x9fb1b8),
      sunIntensity: 0.06, hemiSky: C(0x435966), hemiGround: C(0x262e29),
      hemiIntensity: 0.52, exposure: 0.7, sunElevation: 0.44, sunAzimuth: 0.18,
      rain: 1.0, wetness: 1.0, headlights: 1.0, lightningRate: 1.0,
      fogTint: 'rgba(33,49,57,.28)'
    },
    fog: {
      key: 'fog', name: '浓雾', icon: '🌫', note: '视野极差 · 打开车灯',
      fogColor: C(0x7c8684), fogDensity: 0.0205,
      skyTop: C(0x6d7778), skyHorizon: C(0x929b99), cloudColor: C(0x8b9491),
      cloudCover: 0.88, cloudDark: 0.3, sunColor: C(0xe0e4d4),
      sunIntensity: 0.22, hemiSky: C(0x9ba7a3), hemiGround: C(0x4b4b3f),
      hemiIntensity: 0.82, exposure: 0.86, sunElevation: 0.5, sunAzimuth: 0.4,
      rain: 0.08, wetness: 0.52, headlights: 1.0, lightningRate: 0,
      fogTint: 'rgba(175,183,180,.35)'
    }
  };

  RG.WEATHER_PRESETS = PRESETS;

  // Score thresholds deliberately keep the first storm around 25-35 seconds
  // of a normal run. After the first full cycle, storms and fog alternate.
  const STAGES = [
    { score: 0, key: 'clear', next: 'overcast', nextName: '云层聚集' },
    { score: 320, key: 'overcast', next: 'rain', nextName: '暴雨逼近' },
    { score: 820, key: 'rain', next: 'storm', nextName: '雷电警报' },
    { score: 1450, key: 'storm', next: 'fog', nextName: '浓雾生成' },
    { score: 2250, key: 'fog', next: 'storm', nextName: '雷暴回潮' },
    { score: 3150, key: 'storm', next: 'fog', nextName: '浓雾回潮' }
  ];

  function clonePreset(src) {
    return {
      key: src.key, name: src.name, icon: src.icon, note: src.note,
      fogColor: src.fogColor.clone(), fogDensity: src.fogDensity,
      skyTop: src.skyTop.clone(), skyHorizon: src.skyHorizon.clone(),
      cloudColor: src.cloudColor.clone(), cloudCover: src.cloudCover,
      cloudDark: src.cloudDark, sunColor: src.sunColor.clone(),
      sunIntensity: src.sunIntensity, hemiSky: src.hemiSky.clone(),
      hemiGround: src.hemiGround.clone(), hemiIntensity: src.hemiIntensity,
      exposure: src.exposure, sunElevation: src.sunElevation, sunAzimuth: src.sunAzimuth,
      rain: src.rain, wetness: src.wetness, headlights: src.headlights,
      lightningRate: src.lightningRate, fogTint: src.fogTint
    };
  }

  function mixPresets(a, b, t) {
    const out = clonePreset(a);
    // Copy identity from the destination only after the visual transition ends.
    out.key = t >= 0.999 ? b.key : a.key;
    out.name = t >= 0.999 ? b.name : a.name;
    out.icon = t >= 0.999 ? b.icon : a.icon;
    out.note = t >= 0.999 ? b.note : a.note;
    out.fogColor.copy(a.fogColor).lerp(b.fogColor, t);
    out.skyTop.copy(a.skyTop).lerp(b.skyTop, t);
    out.skyHorizon.copy(a.skyHorizon).lerp(b.skyHorizon, t);
    out.cloudColor.copy(a.cloudColor).lerp(b.cloudColor, t);
    out.sunColor.copy(a.sunColor).lerp(b.sunColor, t);
    out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
    out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
    const scalars = ['fogDensity', 'cloudCover', 'cloudDark', 'sunIntensity',
      'hemiIntensity', 'exposure', 'sunElevation', 'sunAzimuth', 'rain',
      'wetness', 'headlights', 'lightningRate'];
    for (const k of scalars) out[k] = RG.lerp(a[k], b[k], t);
    return out;
  }

  class WeatherSystem {
    constructor() {
      this.defs = PRESETS;
      this.current = clonePreset(PRESETS.clear);
      this.source = clonePreset(PRESETS.clear);
      this.target = clonePreset(PRESETS.clear);
      this.stateKey = 'clear';
      this.transition = 1;
      this.transitionDuration = 4.2;
      this.elapsed = 0;
      this.flash = 0;
      this.secondaryFlash = 0;
      this.nextStrike = 1.8;
      this.onLightning = null;
      this.onChange = null;
      this.score = 0;
      this.pendingKey = 'clear';
    }

    stageForScore(score) {
      let stage = STAGES[0];
      for (let i = 0; i < STAGES.length; i++) {
        if (score >= STAGES[i].score) stage = STAGES[i];
      }
      // Endless continuation: alternate storm and fog with a rising intensity.
      let next = null;
      if (score >= 4050) {
        const loop = Math.floor((score - 4050) / 1050);
        const key = loop % 2 === 0 ? 'storm' : 'fog';
        const nextKey = key === 'storm' ? 'fog' : 'storm';
        return {
          key,
          score: 4050 + loop * 1050,
          nextKey,
          nextScore: 4050 + (loop + 1) * 1050,
          nextName: nextKey === 'fog' ? '浓雾回潮' : '雷暴回潮'
        };
      }
      for (let i = 0; i < STAGES.length - 1; i++) {
        if (stage === STAGES[i]) {
          next = STAGES[i + 1];
          break;
        }
      }
      if (!next) next = { score: 4050, key: 'storm', nextName: '雷暴回潮' };
      return {
        key: stage.key,
        score: stage.score,
        nextKey: STAGES[STAGES.indexOf(stage) + 1] ? STAGES[STAGES.indexOf(stage) + 1].key : 'storm',
        nextScore: next.score,
        nextName: next.nextName || STAGES[STAGES.indexOf(stage)].nextName
      };
    }

    setScore(score, immediate) {
      this.score = score;
      const info = this.stageForScore(score);
      if (info.key !== this.pendingKey || immediate) {
        this.pendingKey = info.key;
        if (immediate) {
          this.current = clonePreset(PRESETS[info.key]);
          this.source = clonePreset(PRESETS[info.key]);
          this.target = clonePreset(PRESETS[info.key]);
          this.stateKey = info.key;
          this.transition = 1;
          this.nextStrike = 1.2;
          return;
        }
        this.transitionTo(info.key, info);
      }
    }

    transitionTo(key, info) {
      this.source = clonePreset(this.current);
      // Preserve visual continuity from the current interpolated values.
      this.source.fogColor.copy(this.current.fogColor);
      this.target = clonePreset(PRESETS[key]);
      this.stateKey = key;
      this.transition = 0;
      this.transitionDuration = key === 'fog' ? 5.8 : key === 'storm' ? 4.8 : 4.0;
      if (this.onChange) this.onChange(info || this.stageForScore(this.score));
    }

    forceClear() {
      this.current = clonePreset(PRESETS.clear);
      this.source = clonePreset(PRESETS.clear);
      this.target = clonePreset(PRESETS.clear);
      this.stateKey = 'clear';
      this.pendingKey = 'clear';
      this.transition = 1;
      this.flash = 0;
      this.nextStrike = 6;
    }

    update(dt) {
      this.elapsed += dt;
      if (this.transition < 1) {
        this.transition = Math.min(1, this.transition + dt / this.transitionDuration);
        const t = this.transition;
        const eased = t * t * (3 - 2 * t);
        this.current = mixPresets(this.source, this.target, eased);
      } else if (this.current.key !== this.target.key) {
        this.current = clonePreset(this.target);
      }

      this.flash = Math.max(0, this.flash - dt * 3.4);
      this.secondaryFlash = Math.max(0, this.secondaryFlash - dt * 5.2);

      if (this.current.lightningRate > 0.15) {
        this.nextStrike -= dt;
        if (this.nextStrike <= 0) {
          this.nextStrike = RG.rand(5.5, 12.5) / Math.max(.4, this.current.lightningRate);
          this.flash = 1.1;
          this.secondaryFlash = RG.rand(.5, .95);
          if (this.onLightning) this.onLightning();
        }
      } else {
        this.nextStrike = Math.max(this.nextStrike, 2);
      }
      return this.current;
    }

    getHeadlightLevel() {
      return this.current.headlights;
    }

    describeNext(score) {
      const info = this.stageForScore(score);
      const remaining = Math.max(0, info.nextScore - score);
      const currentSpan = Math.max(1, info.nextScore - info.score);
      return {
        name: info.nextName,
        key: info.nextKey,
        remaining,
        progress: RG.clamp((score - info.score) / currentSpan, 0, 1)
      };
    }
  }

  RG.WeatherSystem = WeatherSystem;
})();
