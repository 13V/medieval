// ============================================================================
// waves.js — schedules enemy spawns for a single wave from its group defs.
// ============================================================================
export class WaveManager {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.events = [];
    this.idx = 0;
    this.time = 0;
    this.active = false;
    this.hpMul = 1;
  }

  begin(wave) {
    this.reset();
    this.active = true;
    this.hpMul = wave.hpMul;
    for (const g of wave.groups) {
      for (let i = 0; i < g.count; i++) {
        this.events.push({ t: g.delay + i * g.interval, type: g.type });
      }
    }
    this.events.sort((a, b) => a.t - b.t);
  }

  get allSpawned() { return this.idx >= this.events.length; }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    while (this.idx < this.events.length && this.events[this.idx].t <= this.time) {
      this.game.spawnEnemy(this.events[this.idx].type, this.hpMul);
      this.idx++;
    }
    if (this.allSpawned) this.active = false;
  }
}
