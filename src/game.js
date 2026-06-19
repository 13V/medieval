// ============================================================================
// game.js — Three.js setup, game state machine, input, economy, main loop.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPostFX } from './postfx.js';
import { createSky } from './sky.js';
import { createClouds } from './clouds.js';
import { createWater } from './water.js';
import { createFoliage } from './foliage.js';
import { createAtmosphere } from './atmosphere.js';
import { createWildlife } from './wildlife.js';
import { createAnimProps } from './animprops.js';

import { Assets } from './assets.js';
import { Board } from './board.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Effects } from './effects.js';
import { WaveManager } from './waves.js';
import { Enemy, Tower, Projectile, PROJECTILES } from './entities.js';
import {
  MODELS, TOWERS, TOWER_ORDER, ENEMIES, ABILITIES, ECONOMY, CASTLE, COLORS, generateWaves,
} from './config.js';

const now = () => performance.now() / 1000;

// Clean vertical gradient sky (screen-space) — no atmospheric horizon glare.
function makeSkyGradient() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#5b9bd9');  // zenith
  grad.addColorStop(0.55, '#9fcdee');
  grad.addColorStop(1.0, '#dcefff');  // horizon
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Game {
  constructor(container) {
    this.container = container;
    this.assets = new Assets();
    this.audio = new Audio();
    this.waves = generateWaves();

    this._setupRenderer();
    this._setupScene();
    this._setupInput();

    this.postfx = createPostFX(this.renderer, this.scene, this.camera);

    this.hud = new Hud(this);
    this.effects = new Effects(this.scene, this.camera, this.renderer);

    // state
    this.state = 'loading';
    this.speed = 1;            // 0 paused, 1 normal, 2 fast
    this.gold = 0;
    this.castleHp = CASTLE.hp;
    this.waveIndex = 0;
    this.enemies = [];
    this.towers = [];
    this.projectiles = [];
    this.board = null;
    this.waveManager = new WaveManager(this);

    this.selectedTowerType = null;
    this.armedAbility = null;
    this.selectedTower = null;
    this.cdReady = { arrowstorm: 0, frostnova: 0 };
    this.prepTimer = 0;
    this.shakeAmt = 0;
    this.muted = false;
    this._kills = 0;
    this._leaked = 0;

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._loop());
    window.addEventListener('resize', () => this._onResize());
  }

  // -------------------------------------------------------------- setup
  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Reinhard keeps the bright cartoon palette saturated (ACES washes low-poly colours out).
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.container.appendChild(this.renderer.domElement);
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    // Sky dome handles background — no flat color needed.
    // Fog color: light sky-blue matching the horizon; near/far tuned so board
    // edges fade into haze rather than darkness.
    this.scene.fog = new THREE.Fog(0xcfe8f8, 170, 480);

    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400);
    this.camera.position.set(0, 16, 18);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.05;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 60;

    // ---- Clean gradient sky (no atmospheric horizon glare) ---------------
    this.scene.background = makeSkyGradient();

    // Sun direction (elevation 28°, azimuth 135° south-east) drives the key light.
    const phi = THREE.MathUtils.degToRad(90 - 28);
    const theta = THREE.MathUtils.degToRad(135);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    // ---- Lights ----------------------------------------------------------
    // Hemisphere: warm sky / earthy ground
    const hemi = new THREE.HemisphereLight(0xcfeaff, 0x6f9a52, 0.95);
    this.scene.add(hemi);

    // Directional sun: warm, crisp shadows, position aligned with sky sun
    const sun = new THREE.DirectionalLight(0xfff2d4, 2.5);
    sun.position.copy(sunDir).multiplyScalar(50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 26;
    sun.shadow.camera.left   = -d; sun.shadow.camera.right  = d;
    sun.shadow.camera.top    =  d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near   = 1;  sun.shadow.camera.far    = 90;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    // Soft ambient — kept very low so hemisphere + sun do the heavy lifting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.26));

    // Cool fill light from the opposite side for form/depth — no shadows
    const fill = new THREE.DirectionalLight(0x9bb8d8, 0.35);
    fill.position.set(-sunDir.x, sunDir.y * 0.5, -sunDir.z).multiplyScalar(40);
    this.scene.add(fill);

    // ---- Placement / range indicators ------------------------------------
    const ringGeo = new THREE.RingGeometry(0.94, 1.0, 56);
    this.rangeRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COLORS.range, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.visible = false;
    this.scene.add(this.rangeRing);

    this.ghost = new THREE.Mesh(new THREE.CircleGeometry(0.9, 6), new THREE.MeshBasicMaterial({ color: COLORS.hoverOk, transparent: true, opacity: 0.4, depthWrite: false }));
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  _setupInput() {
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();

    const dom = this.renderer.domElement;
    let downX = 0, downY = 0, dragging = false;
    dom.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; dragging = false; });
    dom.addEventListener('pointermove', (e) => {
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) dragging = true;
      this._onHover(e);
    });
    dom.addEventListener('pointerup', (e) => {
      if (!dragging) this._onClick(e);
    });
    dom.addEventListener('pointerleave', () => { this.ghost.visible = false; });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._clearSelections();
      else if (e.key === ' ') { e.preventDefault(); if (this.state === 'prep') this.onStartButton(); }
    });
  }

  // -------------------------------------------------------------- loading
  async load() {
    const manifest = [
      MODELS.tileGrass, MODELS.castle, ...MODELS.decoTrees,
      ...TOWER_ORDER.map((id) => TOWERS[id].model),
      ...Object.values(ENEMIES).map((e) => e.model),
      ...Object.values(PROJECTILES),
    ];
    await this.assets.loadAll(manifest, (done, total) => {
      this.hud.loading(done / total, `Loading assets… ${done}/${total}`);
    });
    this.board = new Board(this.scene, this.assets);
    this.board.build();
    this._frameCamera();

    // ambient visual modules (each returns { update(dt, camera), dispose() })
    this.fx = [
      createSky(this.scene, this.board),
      createWater(this.scene, this.board),
      createClouds(this.scene, this.board),
      createFoliage(this.scene, this.board),
      createAtmosphere(this.scene, this.board),
      createWildlife(this.scene, this.board),
      createAnimProps(this.scene, this.board),
    ];

    this.hud.hideLoading();
    this.hud.showStart();
    this.state = 'menu';
  }

  _frameCamera() {
    // Look from the valley (front, -Z) up the slope toward the castle + mountain (+Z).
    const R = this.board.radius;
    const by = this.board.baseY || 0;
    this.camera.position.set(0, by + R * 0.7, -R * 1.5);
    this.controls.target.set(0, by + 2.2, R * 0.25);
    this.controls.minDistance = R * 0.5;
    this.controls.maxDistance = R * 3.2;
    this.controls.update();
  }

  // -------------------------------------------------------------- game flow
  start() { this.audio.resume(); this.hud.hideStart(); this.hud.hideEnd(); this._beginGame(); }
  restart() { this.start(); }

  _beginGame() {
    for (const e of this.enemies) e._remove?.();
    for (const t of this.towers) t.dispose();
    for (const p of this.projectiles) p._remove?.();
    this.enemies = []; this.towers = []; this.projectiles = [];
    if (this.board) for (const cell of this.board.cells.values()) if (!cell.deco) cell.occupied = false;

    this.gold = ECONOMY.startGold;
    this.castleHp = CASTLE.hp;
    this.waveIndex = 0;
    this._kills = 0; this._leaked = 0;
    this.cdReady = { arrowstorm: 0, frostnova: 0 };
    this._clearSelections();
    this.hud.setGold(this.gold);
    this.hud.setCastle(this.castleHp, CASTLE.hp);
    this.hud.setSpeed(1); this.speed = 1;
    this._enterPrep();
  }

  _enterPrep() {
    this.state = 'prep';
    const wave = this.waves[this.waveIndex];
    this.prepTimer = wave.prep;
    this.hud.setWave(this.waveIndex + 1, this.waves.length);
    this.hud.setWaveProgress(0);
    this.hud.setStartButton(true, '▶ START WAVE');
    const label = wave.isBoss ? '⚠ BOSS WAVE — prepare!' : 'Build &amp; upgrade — wave incoming';
    this.hud.setWaveState(`Prep ${Math.ceil(this.prepTimer)}s`);
    this.hud.toast(wave.isBoss ? '⚠ Boss wave next!' : `Wave ${this.waveIndex + 1} — prepare your defenses`);
  }

  onStartButton() {
    if (this.state !== 'prep') return;
    const bonus = Math.ceil(this.prepTimer) * ECONOMY.callEarlyBonusPerSec;
    if (bonus > 0) { this.gold += bonus; this.hud.setGold(this.gold); this.hud.toast(`Called early! +${bonus} gold`); }
    this._startWave();
  }

  _startWave() {
    this.state = 'wave';
    this.hud.setStartButton(false);
    this.hud.setWaveState('Wave in progress');
    this.waveManager.begin(this.waves[this.waveIndex]);
  }

  _onWaveCleared() {
    const reward = 25 + this.waveIndex * 6;
    this.gold += reward;
    this.hud.setGold(this.gold);
    this.hud.toast(`Wave cleared! +${reward} gold`);
    this.waveIndex++;
    if (this.waveIndex >= this.waves.length) this._victory();
    else this._enterPrep();
  }

  _victory() { this._end(true); }
  _defeat() { this._end(false); }

  _end(win) {
    this.state = 'ended';
    this.hud.setStartButton(false);
    win ? this.audio.win() : this.audio.lose();
    let stars = 0;
    if (win) stars = this.castleHp >= CASTLE.hp ? 3 : this.castleHp >= CASTLE.hp * 0.5 ? 2 : 1;
    const stats =
      `Waves survived: <b>${Math.min(this.waveIndex, this.waves.length)}/${this.waves.length}</b><br>` +
      `Enemies slain: <b>${this._kills}</b><br>` +
      `Castle HP: <b>${Math.max(0, Math.ceil(this.castleHp))}/${CASTLE.hp}</b>`;
    this.hud.showEnd(win, stats, stars);
  }

  // -------------------------------------------------------------- spawns / callbacks
  spawnEnemy(type, hpMul) { this.enemies.push(new Enemy(this, type, hpMul)); }

  spawnProjectile(tower, target) {
    this.projectiles.push(new Projectile(this, tower, target));
    const k = tower.def.projectile;
    if (k === 'arrow') this.audio.shoot();
    else if (k === 'cannonball') this.audio.cannon();
    else if (k === 'catapult') this.audio.catapult();
    else this.audio.frost();
  }

  onEnemyKilled(e) {
    this.gold += e.gold;
    this._kills++;
    this.hud.setGold(this.gold);
  }

  onEnemyReachedCastle(e) {
    const dmg = e.isBoss ? 6 : e.type === 'brute' ? 2 : 1;
    this.castleHp -= dmg;
    this._leaked++;
    this.audio.hitCastle();
    this.addShake(0.28);
    this.effects.pop(this.board.castlePos, { color: 0xff5a4a, size: 1.6, life: 0.4 });
    this.hud.setCastle(this.castleHp, CASTLE.hp);
    if (this.castleHp <= 0 && this.state !== 'ended') this._defeat();
  }

  addShake(a) { this.shakeAmt = Math.min(0.6, this.shakeAmt + a); }

  // -------------------------------------------------------------- input handlers
  _ray(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  _groundPoint(e) {
    this._ray(e);
    return this.raycaster.ray.intersectPlane(this.groundPlane, this._hit) ? this._hit : null;
  }

  // Raycast the actual (elevated) tiles. Returns { point, data } or null.
  _pickTerrain(e) {
    this._ray(e);
    const hits = this.raycaster.intersectObjects(this.board.tilePickables, true);
    if (!hits.length) return null;
    return { point: hits[0].point, data: this.board.tileData(hits[0].object) };
  }

  _onHover(e) {
    if (this.state !== 'prep' && this.state !== 'wave') { this.ghost.visible = false; return; }
    if (!this.selectedTowerType) { if (!this.selectedTower) this.ghost.visible = false; return; }
    const hit = this._pickTerrain(e);
    if (!hit || !hit.data || hit.data.isPath) { this.ghost.visible = false; this.rangeRing.visible = false; return; }
    const cell = this.board.getBuildable(hit.data.col, hit.data.row);
    const cost = TOWERS[this.selectedTowerType].levels[0].cost;
    if (cell && this.gold >= cost) {
      this.ghost.visible = true;
      this.ghost.position.copy(cell.pos); this.ghost.position.y += 0.12;
      this.ghost.material.color.set(COLORS.hoverOk);
      this._showRange(cell.pos, TOWERS[this.selectedTowerType].levels[0].range);
    } else if (cell) {
      this.ghost.visible = true;
      this.ghost.position.copy(cell.pos); this.ghost.position.y += 0.12;
      this.ghost.material.color.set(COLORS.hoverBad);
      this.rangeRing.visible = false;
    } else {
      this.ghost.visible = false;
      this.rangeRing.visible = false;
    }
  }

  _onClick(e) {
    if (this.state !== 'prep' && this.state !== 'wave') return;

    // selecting a built tower takes priority (when not placing/aiming)
    if (!this.selectedTowerType && !this.armedAbility) {
      this._ray(e);
      const tHits = this.raycaster.intersectObjects(this.towers.map((t) => t.obj), true);
      if (tHits.length) {
        const tower = this.towers.find((t) => this._owns(t.obj, tHits[0].object));
        if (tower) { this._selectBuiltTower(tower); return; }
      }
    }

    const hit = this._pickTerrain(e);
    if (!hit) { this._deselectTower(); return; }

    if (this.armedAbility) { this._castAbility(this.armedAbility, hit.point); return; }

    if (this.selectedTowerType) {
      const cell = hit.data && !hit.data.isPath ? this.board.getBuildable(hit.data.col, hit.data.row) : null;
      if (cell) this._placeTower(this.selectedTowerType, cell);
      else { this.audio.deny(); this.hud.toast('Build on a green plot beside the road'); }
      return;
    }

    this._deselectTower();
  }

  _owns(root, obj) { let o = obj; while (o) { if (o === root) return true; o = o.parent; } return false; }

  // -------------------------------------------------------------- towers
  selectTowerType(id) {
    this._deselectTower();
    this.armedAbility = null; this.hud.armAbility(null);
    this.selectedTowerType = this.selectedTowerType === id ? null : id;
    this.hud.selectTower(this.selectedTowerType);
    this.hud.hint(this.selectedTowerType ? `Tap a green plot to build a ${TOWERS[id].name} tower` : null);
    if (!this.selectedTowerType) { this.ghost.visible = false; this.rangeRing.visible = false; }
  }

  _placeTower(id, cell) {
    const cost = TOWERS[id].levels[0].cost;
    if (this.gold < cost) { this.audio.deny(); this.hud.toast('Not enough gold'); return; }
    const tower = new Tower(this, id, cell);
    this.board.occupy(cell);
    this.towers.push(tower);
    this.gold -= cost;
    this.hud.setGold(this.gold);
    this.audio.place();
    this.effects.pop(cell.pos, { color: 0xffe080, size: 0.8, life: 0.3 });
  }

  _selectBuiltTower(tower) {
    this.selectedTowerType = null; this.hud.selectTower(null);
    this.armedAbility = null; this.hud.armAbility(null);
    this.selectedTower = tower;
    this.hud.showTowerPanel(tower);
    this.hud.hint(null);
    this._showRange(tower.obj.position, tower.stats.range);
    this.ghost.visible = false;
  }

  _deselectTower() {
    this.selectedTower = null;
    this.hud.hideTowerPanel();
    this.rangeRing.visible = false;
  }

  upgradeSelected() {
    const t = this.selectedTower;
    if (!t || !t.canUpgrade()) return;
    const cost = t.upgradeCost();
    if (this.gold < cost) { this.audio.deny(); this.hud.toast('Not enough gold'); return; }
    this.gold -= cost;
    t.upgrade();
    this.audio.upgrade();
    this.hud.setGold(this.gold);
    this.hud.showTowerPanel(t);
    this._showRange(t.obj.position, t.stats.range);
    this.effects.pop(t.obj.position, { color: 0x9fe6ff, size: 0.9, life: 0.3 });
  }

  sellSelected() {
    const t = this.selectedTower;
    if (!t) return;
    this.gold += t.sellValue();
    this.board.free(t.cell);
    t.dispose();
    this.towers = this.towers.filter((x) => x !== t);
    this.audio.coin();
    this.hud.setGold(this.gold);
    this._deselectTower();
  }

  _showRange(pos, range) {
    this.rangeRing.visible = true;
    this.rangeRing.position.set(pos.x, pos.y + 0.14, pos.z);
    this.rangeRing.scale.setScalar(range);
  }

  // -------------------------------------------------------------- abilities
  armAbility(id) {
    if (now() < this.cdReady[id]) { this.audio.deny(); this.hud.toast(`${ABILITIES[id].name} on cooldown`); return; }
    this.selectedTowerType = null; this.hud.selectTower(null);
    this._deselectTower();
    this.armedAbility = this.armedAbility === id ? null : id;
    this.hud.armAbility(this.armedAbility);
    this.hud.hint(this.armedAbility ? `Tap the battlefield to cast ${ABILITIES[id].name}` : null);
  }

  _castAbility(id, p) {
    if (now() < this.cdReady[id]) return;
    const a = ABILITIES[id];
    this.cdReady[id] = now() + a.cooldown;
    this.armedAbility = null; this.hud.armAbility(null); this.hud.hint(null);
    this.audio.ability();
    this.effects.ring(p, { radius: a.radius, color: a.color, life: 0.6 });
    this.effects.pop(p, { color: a.color, size: a.radius, life: 0.5 });
    const r2 = a.radius * a.radius;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.obj.position.x - p.x, dz = e.obj.position.z - p.z;
      if (dx * dx + dz * dz <= r2) {
        if (a.damage) e.takeDamage(a.damage);
        if (a.slow) e.applySlow(a.slow.amount, a.slow.duration);
      }
    }
    if (id === 'arrowstorm') this.addShake(0.2);
  }

  _clearSelections() {
    this.selectedTowerType = null; this.hud.selectTower(null);
    this.armedAbility = null; this.hud.armAbility(null);
    this._deselectTower();
    this.ghost.visible = false;
    this.hud.hint(null);
  }

  // -------------------------------------------------------------- speed / mute
  setSpeed(n) { this.speed = n; this.hud.setSpeed(n); if (n > 0) this.audio.resume(); }
  toggleMute() { this.muted = !this.muted; this.audio.setMuted(this.muted); this.hud.setMute(this.muted); }

  // -------------------------------------------------------------- loop
  _loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const sdt = this.speed === 0 ? 0 : dt * (this.speed === 2 ? 2 : 1);

    if (this.state === 'prep' && sdt > 0) {
      this.prepTimer -= sdt;
      this.hud.setWaveState(`Prep ${Math.max(0, Math.ceil(this.prepTimer))}s`);
      if (this.prepTimer <= 0) this._startWave();
    }

    if ((this.state === 'wave' || this.state === 'prep') && sdt > 0) {
      if (this.state === 'wave') this.waveManager.update(sdt);
      for (const t of this.towers) t.update(sdt, this.enemies);
      for (const e of this.enemies) e.update(sdt);
      for (const p of this.projectiles) p.update(sdt);
      this.enemies = this.enemies.filter((e) => e.alive);
      this.projectiles = this.projectiles.filter((p) => p.alive);

      if (this.state === 'wave' && this.waveManager.allSpawned && this.enemies.length === 0) {
        this._onWaveCleared();
      } else if (this.state === 'wave') {
        const total = this.waveManager.events.length || 1;
        const remaining = this.enemies.length + (total - this.waveManager.idx);
        this.hud.setWaveProgress(1 - remaining / (total + 0.001));
      }
    }

    // ability cooldown UI
    for (const id of Object.keys(this.cdReady)) {
      const cd = ABILITIES[id].cooldown;
      const frac = Math.max(0, Math.min(1, (this.cdReady[id] - now()) / cd));
      this.hud.setAbilityCooldown(id, frac, frac > 0);
    }

    this.effects.update(dt);
    if (this.fx) for (const f of this.fx) f.update(dt, this.camera);
    this.controls.update();

    // camera shake
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= 0.86;
    }

    this.postfx.composer.render();
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.postfx.setSize(innerWidth, innerHeight);
  }
}
