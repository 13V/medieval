// ============================================================================
// audio.js — tiny WebAudio synth for SFX (no asset files). Muteable.
// ============================================================================
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.vol = 0.22;
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.vol;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    this._ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.vol;
  }

  _blip(freq, dur, type = 'square', vol = 1, slideTo = null) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  shoot() { this._blip(440, 0.07, 'square', 0.4, 300); }
  cannon() { this._blip(120, 0.18, 'sawtooth', 0.7, 60); }
  catapult() { this._blip(90, 0.22, 'sawtooth', 0.7, 50); }
  frost() { this._blip(950, 0.13, 'sine', 0.35, 1350); }
  place() { this._blip(520, 0.1, 'triangle', 0.6, 720); }
  upgrade() { this._blip(600, 0.13, 'triangle', 0.6, 1050); }
  deny() { this._blip(180, 0.12, 'square', 0.4, 120); }
  coin() { this._blip(1250, 0.05, 'square', 0.18); }
  hitCastle() { this._blip(150, 0.26, 'sawtooth', 0.8, 70); }
  ability() { this._blip(300, 0.3, 'sawtooth', 0.5, 1200); }
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._blip(f, 0.22, 'triangle', 0.6), i * 130)); }
  lose() { [392, 311, 233, 175].forEach((f, i) => setTimeout(() => this._blip(f, 0.26, 'sawtooth', 0.6), i * 150)); }
}
