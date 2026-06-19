// ============================================================================
// assets.js — glTF loading, caching, and instancing helpers.
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const ROOT = BASE + 'assets/gltf/';

export class Assets {
  constructor() {
    this.loader = new GLTFLoader().setPath(ROOT);
    this.cache = new Map();
  }

  async loadAll(paths, onProgress) {
    const uniq = [...new Set(paths)];
    let done = 0;
    await Promise.all(
      uniq.map(
        (p) =>
          new Promise((resolve, reject) => {
            this.loader.load(
              p,
              (gltf) => {
                this._prep(gltf.scene);
                this.cache.set(p, gltf.scene);
                done++;
                onProgress?.(done, uniq.length);
                resolve();
              },
              undefined,
              (err) => reject(new Error(`Failed to load ${p}: ${err?.message || err}`))
            );
          })
      )
    );
  }

  _prep(scene) {
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const m = o.material;
        if (m && m.map) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.anisotropy = 4;
        }
      }
    });
  }

  box(path) {
    const s = this.cache.get(path);
    return new THREE.Box3().setFromObject(s);
  }

  // Returns a fresh Group containing a clone of the model, scaled & optionally
  // ground-aligned (feet at y=0). cloneMaterials → unique materials for tinting.
  instance(path, { scale = 1, tint = null, groundAlign = true, cloneMaterials = false } = {}) {
    const src = this.cache.get(path);
    if (!src) throw new Error(`asset not loaded: ${path}`);
    const obj = src.clone(true);

    if (cloneMaterials || tint != null) {
      obj.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          if (tint != null) o.material.color = new THREE.Color(tint);
        }
      });
    }

    obj.scale.setScalar(scale);
    if (groundAlign) {
      const b = new THREE.Box3().setFromObject(obj);
      obj.position.y -= b.min.y;
    }

    const group = new THREE.Group();
    group.add(obj);
    return group;
  }
}

// Collect all mesh materials under an object (for tint / flash effects).
export function collectMaterials(obj) {
  const mats = [];
  obj.traverse((o) => {
    if (o.isMesh && o.material) mats.push(o.material);
  });
  return mats;
}
