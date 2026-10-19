// Tiny WebAudio synth for all game sounds (no asset files needed).

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Gain node that attenuates with distance from the listener and pans left/right.
  _out(dist = 0, pan = 0, vol = 1) {
    const g = this.ctx.createGain();
    g.gain.value = vol * Math.max(0, 1 - dist / 120) ** 1.6;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  _noise(dur, filterType, freq, q, vol, out, attack = 0.002, freqEnd = null) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  _tone(type, f0, f1, dur, vol, out, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, dist = 0, pan = 0) {
    if (!this.ctx) return;
    const out = this._out(dist, pan);
    switch (name) {
      case 'pistol':
        this._noise(0.25, 'lowpass', 3200, 0.7, 1.0, out, 0.001, 400);
        this._tone('square', 180, 40, 0.12, 0.35, out);
        break;
      case 'rifle':
        this._noise(0.35, 'lowpass', 4200, 0.8, 1.1, out, 0.001, 300);
        this._tone('sawtooth', 140, 30, 0.18, 0.4, out);
        break;
      case 'shotgun':
        this._noise(0.55, 'lowpass', 2600, 0.6, 1.2, out, 0.001, 150);
        this._tone('sawtooth', 90, 25, 0.3, 0.6, out);
        break;
      case 'bolt':
        this._noise(0.6, 'lowpass', 5200, 0.8, 1.2, out, 0.001, 200);
        this._tone('sawtooth', 120, 25, 0.3, 0.55, out);
        break;
      case 'dry':
        this._tone('square', 1800, 1200, 0.03, 0.15, out);
        break;
      case 'reload':
        this._tone('square', 900, 500, 0.05, 0.12, out);
        this._tone('square', 600, 300, 0.06, 0.12, out, 0.25);
        break;
      case 'pump':
        this._noise(0.12, 'bandpass', 1400, 2, 0.3, out);
        this._noise(0.12, 'bandpass', 900, 2, 0.3, out, 0.002);
        break;
      case 'swing':
        this._noise(0.18, 'bandpass', 900, 1.2, 0.25, out, 0.04, 2400);
        break;
      case 'chop':
        this._tone('triangle', 260, 120, 0.12, 0.5, out);
        this._noise(0.1, 'bandpass', 1200, 3, 0.4, out);
        break;
      case 'mine':
        this._tone('square', 900, 600, 0.08, 0.25, out);
        this._noise(0.12, 'highpass', 2500, 1, 0.35, out);
        break;
      case 'metal':
        this._tone('triangle', 520, 480, 0.25, 0.3, out);
        this._tone('triangle', 780, 700, 0.2, 0.15, out);
        break;
      case 'flesh':
        this._noise(0.12, 'lowpass', 700, 1, 0.6, out);
        this._tone('sine', 120, 60, 0.1, 0.4, out);
        break;
      case 'impact':
        this._noise(0.08, 'bandpass', 2000, 1.5, 0.25, out);
        break;
      case 'build':
        this._tone('triangle', 200, 140, 0.15, 0.45, out);
        this._noise(0.15, 'bandpass', 600, 2, 0.4, out);
        break;
      case 'break':
        this._noise(0.5, 'lowpass', 1200, 0.8, 0.7, out, 0.005, 100);
        this._tone('triangle', 140, 50, 0.4, 0.4, out);
        break;
      case 'groan': {
        const base = 70 + Math.random() * 50;
        this._tone('sawtooth', base, base * 0.7, 0.9 + Math.random() * 0.6, 0.18, out);
        this._noise(0.8, 'bandpass', 500 + Math.random() * 300, 4, 0.12, out, 0.1);
        break;
      }
      case 'zhit':
        this._noise(0.15, 'lowpass', 900, 1, 0.7, out);
        this._tone('sine', 90, 50, 0.15, 0.6, out);
        break;
      case 'bash':
        this._tone('triangle', 110, 70, 0.2, 0.6, out);
        this._noise(0.2, 'lowpass', 800, 1, 0.5, out);
        break;
      case 'step':
        this._noise(0.07, 'lowpass', 500 + Math.random() * 300, 1, 0.12, out);
        break;
      case 'pickup':
        this._tone('sine', 600, 900, 0.08, 0.12, out);
        break;
      case 'craft':
        this._tone('sine', 500, 800, 0.1, 0.15, out);
        this._tone('sine', 800, 1200, 0.1, 0.12, out, 0.08);
        break;
      case 'eat':
        this._noise(0.25, 'bandpass', 1500, 3, 0.2, out);
        break;
      case 'hurt':
        this._tone('sawtooth', 220, 110, 0.2, 0.25, out);
        break;
      case 'door':
        this._tone('triangle', 300, 180, 0.25, 0.25, out);
        break;
      case 'ui':
        this._tone('sine', 700, 700, 0.04, 0.08, out);
        break;
    }
  }
}
