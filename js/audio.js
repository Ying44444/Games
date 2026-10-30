/* Procedural audio: engine, wind, rain, thunder and impacts. No audio assets. */
(function () {
  'use strict';
  const RG = window.RG;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.started = false;
      this.muted = false;
      this.noiseBuffer = null;
      this.engine = null;
      this.windGain = null;
      this.rainGain = null;
      this.rainFilter = null;
      this.lastThunder = -10;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        const ctx = this.ctx = new AC();
        const master = this.master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.72;
        master.connect(ctx.destination);

        this.noiseBuffer = this.createNoise(2.5);

        // Engine: two detuned oscillators through a lowpass.
        const engineGain = ctx.createGain();
        engineGain.gain.value = 0;
        const engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 380;
        engineFilter.Q.value = 1.4;
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        o1.type = 'sawtooth';
        o2.type = 'square';
        o1.frequency.value = 42;
        o2.frequency.value = 84;
        o1.connect(engineFilter);
        o2.connect(engineFilter);
        engineFilter.connect(engineGain);
        engineGain.connect(master);
        o1.start();
        o2.start();
        this.engine = { o1, o2, gain: engineGain, filter: engineFilter };

        // Wind noise.
        const wind = ctx.createBufferSource();
        wind.buffer = this.noiseBuffer;
        wind.loop = true;
        const windF = ctx.createBiquadFilter();
        windF.type = 'bandpass';
        windF.frequency.value = 720;
        windF.Q.value = 0.7;
        this.windGain = ctx.createGain();
        this.windGain.gain.value = 0;
        wind.connect(windF).connect(this.windGain).connect(master);
        wind.start();

        // Rain hiss.
        const rain = ctx.createBufferSource();
        rain.buffer = this.noiseBuffer;
        rain.loop = true;
        this.rainFilter = ctx.createBiquadFilter();
        this.rainFilter.type = 'lowpass';
        this.rainFilter.frequency.value = 2600;
        this.rainFilter.Q.value = 0.3;
        this.rainGain = ctx.createGain();
        this.rainGain.gain.value = 0;
        rain.connect(this.rainFilter).connect(this.rainGain).connect(master);
        rain.start();

        this.started = true;
      } catch (err) {
        console.warn('Audio unavailable:', err);
      }
    }

    createNoise(seconds) {
      const ctx = this.ctx;
      const length = Math.floor(ctx.sampleRate * seconds);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.88 + white * 0.12;
        data[i] = last * 1.4 + white * 0.25;
      }
      return buffer;
    }

    setMuted(muted) {
      this.muted = muted;
      if (this.master) {
        this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.ctx.currentTime, 0.06);
      }
    }

    update(speedRatio, boosting, rainAmount, active) {
      if (!this.ctx || !this.engine) return;
      const t = this.ctx.currentTime;
      const base = active ? 38 + speedRatio * 165 + (boosting ? 24 : 0) : 30;
      this.engine.o1.frequency.setTargetAtTime(base, t, 0.08);
      this.engine.o2.frequency.setTargetAtTime(base * 1.505 + (boosting ? 8 : 0), t, 0.08);
      this.engine.filter.frequency.setTargetAtTime(260 + speedRatio * 1250 + (boosting ? 650 : 0), t, 0.12);
      this.engine.gain.gain.setTargetAtTime(active ? 0.022 + speedRatio * 0.055 : 0.0, t, 0.12);
      this.windGain.gain.setTargetAtTime(active ? 0.006 + speedRatio * 0.04 : 0.0, t, 0.18);
      this.rainGain.gain.setTargetAtTime(rainAmount * 0.14, t, 0.7);
      this.rainFilter.frequency.setTargetAtTime(rainAmount > 0.7 ? 1700 : 3200, t, 0.5);
    }

    impact(strength) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const s = Math.max(0.2, Math.min(1.5, strength || 1));
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900 + s * 600, t);
      filter.frequency.exponentialRampToValueAtTime(90, t + 0.34);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.24 * s, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t);
      src.stop(t + 0.42);

      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(34, t + 0.32);
      og.gain.setValueAtTime(0.34 * s, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(og).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.36);
    }

    crash() {
      this.impact(1.65);
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 800 + i * 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.1, t + i * 0.025);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 + i * 0.06);
        src.connect(f).connect(g).connect(this.master);
        src.start(t + i * 0.025);
        src.stop(t + 0.5);
      }
    }

    pickup() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const notes = [523.25, 659.25, 880];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t + i * 0.07);
        gain.gain.linearRampToValueAtTime(0.08, t + i * 0.07 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.23);
        osc.connect(gain).connect(this.master);
        osc.start(t + i * 0.07);
        osc.stop(t + i * 0.07 + 0.25);
      });
    }

    thunder(distance) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime + 0.05;
      const close = distance === undefined ? Math.random() : distance;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(close < .4 ? 640 : 260, t);
      f.frequency.exponentialRampToValueAtTime(55, t + 2.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12 + (1 - close) * 0.16, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 2.8);

      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(52, t);
      osc.frequency.exponentialRampToValueAtTime(23, t + 2.2);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(0.12, t + 0.15);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      osc.connect(og).connect(this.master);
      osc.start(t);
      osc.stop(t + 2.5);
    }

    chimeWeather() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(174, t + .4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + .03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + .6);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + .62);
    }

    silenceEngine() {
      if (!this.ctx || !this.engine) return;
      const t = this.ctx.currentTime;
      this.engine.gain.gain.setTargetAtTime(0.0, t, 0.12);
      if (this.windGain) this.windGain.gain.setTargetAtTime(0.0, t, 0.12);
      if (this.rainGain) this.rainGain.gain.setTargetAtTime(0.006, t, 0.3);
    }
  }

  RG.AudioEngine = AudioEngine;
})();
