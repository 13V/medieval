// ============================================================================
// effects.js — game "juice": floating damage numbers (DOM), 3D hit/explosion
// pops, and expanding AoE rings.
// ============================================================================
import * as THREE from 'three';

const SPHERE = new THREE.SphereGeometry(1, 12, 12);

export class Effects {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.numbers = [];
    this.pops = [];

    this.layer = document.createElement('div');
    this.layer.id = 'fx-layer';
    document.body.appendChild(this.layer);

    this._v = new THREE.Vector3();
  }

  number(pos, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'dmg ' + cls;
    el.textContent = text;
    this.layer.appendChild(el);
    this.numbers.push({ el, pos: pos.clone(), age: 0, life: 0.9, rise: 1.6, drift: (Math.random() - 0.5) * 24 });
  }

  pop(pos, { color = 0xffffff, size = 0.6, life = 0.32 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(SPHERE, mat);
    m.position.copy(pos);
    m.position.y += 0.4;
    m.scale.setScalar(size * 0.3);
    this.scene.add(m);
    this.pops.push({ m, mat, age: 0, life, from: size * 0.3, to: size });
  }

  ring(pos, { radius = 3, color = 0x8fe0ff, life = 0.5 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const geo = new THREE.RingGeometry(radius * 0.55, radius * 0.72, 40);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.position.y += 0.15;
    this.scene.add(m);
    this.pops.push({ m, mat, geo, age: 0, life, from: 0.6, to: 1.0, isRing: true });
  }

  update(dt) {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;

    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      if (n.age >= n.life) { n.el.remove(); this.numbers.splice(i, 1); continue; }
      const k = n.age / n.life;
      this._v.copy(n.pos);
      this._v.y += 1.0 + k * n.rise;
      this._v.project(this.camera);
      const x = (this._v.x * 0.5 + 0.5) * w + n.drift * k;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      const visible = this._v.z < 1;
      n.el.style.display = visible ? 'block' : 'none';
      n.el.style.transform = `translate(-50%,-50%) translate(${x}px, ${y}px) scale(${1 + (1 - k) * 0.3})`;
      n.el.style.opacity = String(1 - k * k);
    }

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        this.scene.remove(p.m);
        p.mat.dispose();
        if (p.geo) p.geo.dispose();
        this.pops.splice(i, 1);
        continue;
      }
      const s = p.from + (p.to - p.from) * k;
      p.m.scale.setScalar(p.isRing ? s : s);
      p.mat.opacity = (p.isRing ? 0.8 : 0.95) * (1 - k);
    }
  }
}
