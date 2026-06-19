// ============================================================================
// board.js — builds the 3D hex board with ELEVATION: height-banded terraces,
// a winding road that ramps up to a castle on a raised plateau, rock "padding"
// on slopes, a water moat, and rich decoration. Exposes enemy waypoints (with
// height) and the buildable-cell map. Tiles are pickable for placement.
// ============================================================================
import * as THREE from 'three';
import { MODELS, COLORS, LEVEL } from './config.js';
import {
  SQRT3, offsetToWorld, generateSerpentinePath, boardExtents, cellKey, offsetNeighbors,
} from './hex.js';

const STEP = 0.8;        // world height per elevation tier (dramatic but gap-free at ≤1 adjacency)
const MAX_TIER = 3;      // 0..3 tiers — castle sits on a tall plateau
const BASE_LIFT = 2.6;   // raise the whole island onto a pedestal/hill above the water

function snap60(r) { return Math.round(r / (Math.PI / 3)) * (Math.PI / 3); }

function makeHexMesh(tileSize, material, height = 0.12) {
  const geo = new THREE.CylinderGeometry(tileSize * 0.995, tileSize * 0.995, height, 6, 1, false);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

export class Board {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.size = 1;
    this.step = STEP;
    this.baseY = BASE_LIFT;
    this.origin = new THREE.Vector3();
    this.pathPoints = [];      // THREE.Vector3[] enemy waypoints (y = terrain height)
    this.spawnPos = new THREE.Vector3();
    this.castlePos = new THREE.Vector3();
    this.cells = new Map();    // key -> { col,row,pos,height,occupied,grass,deco }
    this.heights = new Map();  // key -> tier (0..MAX_TIER) for every grid cell
    this.tilePickables = [];   // tile groups, for raycast placement/targeting
    this.radius = 10;
  }

  build() {
    const { cols, rows, corridorRows } = LEVEL;
    const gb = this.assets.box(MODELS.tileGrass);
    this.size = (gb.max.x - gb.min.x) / SQRT3; // pointy-top circumradius
    const s = this.size;
    const ox = -boardExtents(cols, rows, s).cx;
    const oz = -boardExtents(cols, rows, s).cz;
    this.origin.set(ox, 0, oz);
    const ext = boardExtents(cols, rows, s);
    this.radius = Math.max(ext.maxX - ext.minX, ext.maxZ - ext.minZ) / 2 + s;

    const path = generateSerpentinePath(cols, corridorRows);
    const pathKeys = new Set(path.map((c) => cellKey(c.col, c.row)));

    // world XZ of path ends (used as elevation anchors)
    const wOf = (cell) => { const w = offsetToWorld(cell.col, cell.row, s); return { x: w.x + ox, z: w.z + oz }; };
    const castleAnchor = wOf(path[path.length - 1]);
    const spawnAnchor = wOf(path[0]);
    const hillAnchor = (() => { const w = offsetToWorld(cols - 3, 4, s); return { x: w.x + ox, z: w.z + oz }; })();
    const colStep = SQRT3 * s;

    // ---- elevation field (≤1-tier adjacency by construction → no gaps) ----
    const tierAt = (c, r) => {
      const w = offsetToWorld(c, r, s);
      const wx = w.x + ox, wz = w.z + oz;
      const dCastle = Math.hypot(wx - castleAnchor.x, wz - castleAnchor.z) / colStep;
      const hCastle = MAX_TIER - Math.floor(dCastle / 2.0);          // castle plateau
      const dHill = Math.hypot(wx - hillAnchor.x, wz - hillAnchor.z) / colStep;
      const hHill = 1 - Math.floor(dHill / 1.8);                     // a green hill
      const edge = Math.min(c, cols - 1 - c, r, rows - 1 - r);       // 0 at border (beach)
      const base = Math.min(Math.max(hHill, 0), edge);              // terrain falls to water at edges
      return Math.max(0, Math.min(MAX_TIER, Math.max(hCastle, base))); // castle exempt from edge cap
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.heights.set(cellKey(c, r), tierAt(c, r));

    // ---- grass Summer texture (async; lusher green) ----
    const grassMats = [];
    new THREE.TextureLoader().load(MODELS.tileSummerTex, (tex) => {
      tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      for (const m of grassMats) { m.map = tex; m.color.set(0xffffff); m.needsUpdate = true; }
    });

    // ---- lay every tile at its elevation ----
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = cellKey(c, r);
        const isPath = pathKeys.has(k);
        const w = offsetToWorld(c, r, s);
        const y = BASE_LIFT + this.heights.get(k) * STEP;

        const tile = this.assets.instance(MODELS.tileGrass, { groundAlign: false, cloneMaterials: true });
        tile.position.set(w.x + ox, y, w.z + oz);
        tile.rotation.y = snap60((c * 2 + r) % 6 * (Math.PI / 3));

        if (isPath) {
          tile.traverse((o) => {
            if (o.isMesh) {
              o.material = new THREE.MeshStandardMaterial({ color: COLORS.path, roughness: 0.95, metalness: 0 });
              o.castShadow = true; o.receiveShadow = true;
            }
          });
        } else {
          tile.traverse((o) => { if (o.isMesh) { o.material.color.set(0x86c552); grassMats.push(o.material); } });
        }

        tile.userData = { isTile: true, key: k, col: c, row: r, isPath };
        this.group.add(tile);
        this.tilePickables.push(tile);

        if (!isPath) {
          this.cells.set(k, { col: c, row: r, pos: tile.position.clone(), height: this.heights.get(k), occupied: false, grass: tile, deco: false });
        }
      }
    }

    // ---- waypoints (with terrain height) ----
    this.pathPoints = path.map((c) => {
      const w = offsetToWorld(c.col, c.row, s);
      return new THREE.Vector3(w.x + ox, BASE_LIFT + this.heights.get(cellKey(c.col, c.row)) * STEP, w.z + oz);
    });
    this.spawnPos.copy(this.pathPoints[0]);
    this.castlePos.copy(this.pathPoints[this.pathPoints.length - 1]);

    // ---- castle on its plateau ----
    const castle = this.assets.instance(MODELS.castle, { scale: 1.2, groundAlign: true });
    castle.position.copy(this.castlePos);
    const prev = this.pathPoints[this.pathPoints.length - 2] || this.castlePos;
    castle.lookAt(prev.x, this.castlePos.y, prev.z);
    this.group.add(castle);
    this.castle = castle;

    this._buildWaterRing(cols, rows);
    this._decorate(cols, rows, pathKeys);
    this._rockyAccents(cols, rows, pathKeys);
    this._buildIslandBase();

    // ---- deep-water backdrop ----
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(this.radius * 10, this.radius * 10),
      new THREE.MeshStandardMaterial({ color: COLORS.waterBackdrop, roughness: 0.7, metalness: 0.15 })
    );
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -1.6;
    backdrop.receiveShadow = true;
    this.scene.add(backdrop);
  }

  // Rock "padding" on downhill slopes + a rocky skirt under the castle + shore framing.
  _rockyAccents(cols, rows, pathKeys) {
    const s = this.size;
    let seed = 1337;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
    const rocks = MODELS.decoRocks;
    const placeRock = (x, y, z, sc) => {
      const o = this.assets.instance(rocks[Math.floor(rng() * rocks.length)], { scale: sc, groundAlign: true });
      o.position.set(x, y, z);
      o.rotation.y = rng() * Math.PI * 2;
      this.group.add(o);
    };

    // 1) slope padding: where a cell is higher than a neighbour, drop a rock at the shared edge
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hk = this.heights.get(cellKey(c, r));
        const w = offsetToWorld(c, r, s);
        const cx = w.x + this.origin.x, cz = w.z + this.origin.z;
        for (const n of offsetNeighbors(c, r)) {
          const nk = cellKey(n.col, n.row);
          if (!this.heights.has(nk)) continue;
          if (hk - this.heights.get(nk) >= 1 && rng() < 0.5) {
            const nw = offsetToWorld(n.col, n.row, s);
            const mx = (cx + nw.x + this.origin.x) / 2;
            const mz = (cz + nw.z + this.origin.z) / 2;
            placeRock(mx, BASE_LIFT + (hk * STEP + this.heights.get(nk) * STEP) / 2 - 0.1, mz, 0.5 + rng() * 0.4);
          }
        }
      }
    }

    // 2) rocky skirt around the castle plateau (the "rocky peak")
    const cp = this.castlePos;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rng() * 0.3;
      const d = s * (1.0 + rng() * 0.5);
      placeRock(cp.x + Math.cos(a) * d, cp.y - 0.15, cp.z + Math.sin(a) * d, 0.6 + rng() * 0.6);
    }

    // 3) rocky shore: ring of larger rocks just outside the board border (grey cliffs)
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const d = this.radius * (1.02 + rng() * 0.18);
      placeRock(Math.cos(a) * d, BASE_LIFT - 0.8, Math.sin(a) * d, 0.9 + rng() * 1.1);
    }
  }

  // Solid earth + rock pedestal beneath the island (the "on a hill" look).
  _buildIslandBase() {
    const R = this.radius;
    const top = BASE_LIFT - 0.05;
    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 1.04, R * 0.94, 1.2, 11, 1),
      new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1, flatShading: true })
    );
    soil.position.y = top - 0.6;
    soil.receiveShadow = true; soil.castShadow = true;
    this.group.add(soil);

    const rockTop = top - 1.2, rockBottom = -0.6;
    const rock = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.94, R * 0.6, rockTop - rockBottom, 9, 1),
      new THREE.MeshStandardMaterial({ color: 0x8a8377, roughness: 1, flatShading: true })
    );
    rock.position.y = (rockTop + rockBottom) / 2;
    rock.receiveShadow = true; rock.castShadow = true;
    this.group.add(rock);
  }

  _buildWaterRing(cols, rows) {
    const s = this.size;
    const matDeep = new THREE.MeshStandardMaterial({ color: COLORS.waterDeep, roughness: 0.4, metalness: 0.35 });
    const matShallow = new THREE.MeshStandardMaterial({ color: COLORS.waterShallow, roughness: 0.35, metalness: 0.4 });
    const grid = new Set();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) grid.add(cellKey(c, r));

    for (let r = -3; r <= rows + 2; r++) {
      for (let c = -3; c <= cols + 2; c++) {
        if (grid.has(cellKey(c, r))) continue;
        const w = offsetToWorld(c, r, s);
        const wx = w.x + this.origin.x, wz = w.z + this.origin.z;
        const dist = Math.max(Math.abs(wx), Math.abs(wz));
        if (dist > this.radius * 1.85) continue;
        const mat = dist / (this.radius * 1.5) > 0.55 ? matDeep : matShallow;
        const mesh = makeHexMesh(s, mat, 0.4);
        mesh.position.set(wx, -0.42, wz);
        mesh.rotation.y = Math.floor(Math.random() * 6) * (Math.PI / 3);
        this.group.add(mesh);
      }
    }
  }

  _decorate(cols, rows, pathKeys) {
    let seed = 42;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
    const nature = MODELS.decoNature, rocks = MODELS.decoRocks;
    const castleProps = MODELS.decoCastleProps, spawnProps = MODELS.decoSpawnProps, waterPlants = MODELS.decoWaterPlants;
    const pick = (arr) => arr[Math.floor(rng() * arr.length)]; // picks once (avoids double-eval bugs)

    const placeOnCell = (col, row, model, opts = {}) => {
      const k = cellKey(col, row);
      if (pathKeys.has(k)) return false;
      const cell = this.cells.get(k);
      if (!cell || cell.occupied) return false;
      const obj = this.assets.instance(model, { scale: (opts.scaleMin ?? 0.85) + rng() * ((opts.scaleMax ?? 1.25) - (opts.scaleMin ?? 0.85)), groundAlign: true });
      obj.position.copy(cell.pos);
      if (opts.jitter) { obj.position.x += (rng() - 0.5) * this.size * 0.3; obj.position.z += (rng() - 0.5) * this.size * 0.3; }
      obj.rotation.y = rng() * Math.PI * 2;
      this.group.add(obj);
      cell.occupied = true; cell.deco = true;
      return true;
    };
    const placeWorld = (wx, wz, model, opts = {}) => {
      const obj = this.assets.instance(model, { scale: (opts.scaleMin ?? 0.8) + rng() * ((opts.scaleMax ?? 1.3) - (opts.scaleMin ?? 0.8)), groundAlign: true });
      obj.position.set(wx, opts.y ?? 0, wz);
      obj.rotation.y = rng() * Math.PI * 2;
      this.group.add(obj);
    };

    // lush border ring
    for (let c = 0; c < cols; c++) for (const r of [0, rows - 1]) {
      const k = cellKey(c, r);
      if (pathKeys.has(k) || !this.cells.has(k)) continue;
      placeOnCell(c, r, pick((c + r) % 4 === 0 ? rocks : nature), { scaleMin: 0.85, scaleMax: 1.25 });
    }
    for (let r = 1; r < rows - 1; r++) for (const c of [0, cols - 1]) {
      const k = cellKey(c, r);
      if (pathKeys.has(k) || !this.cells.has(k)) continue;
      placeOnCell(c, r, pick(r % 3 === 0 ? rocks : nature), { scaleMin: 0.8, scaleMax: 1.2 });
    }
    // sparse interior so most plots stay free
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      const k = cellKey(c, r);
      if (pathKeys.has(k)) continue;
      const cell = this.cells.get(k);
      if (!cell || cell.occupied || rng() > 0.12) continue;
      placeOnCell(c, r, pick(rng() < 0.35 ? rocks : nature), { scaleMin: 0.7, scaleMax: 1.0, jitter: true });
    }

    // castle + spawn themed props
    const cellCR = (pos) => ({ col: Math.round((pos.x - this.origin.x) / (SQRT3 * this.size)), row: Math.round((pos.z - this.origin.z) / (1.5 * this.size)) });
    const cc = cellCR(this.castlePos);
    let pc = 0;
    for (const [nc, nr] of [[cc.col-1,cc.row],[cc.col+1,cc.row],[cc.col,cc.row-1],[cc.col-1,cc.row-1],[cc.col+1,cc.row-1],[cc.col-2,cc.row]]) {
      if (pc >= 4) break;
      const model = pc < 2 ? castleProps[pc % castleProps.length] : castleProps[2 + ((pc - 2) % (castleProps.length - 2))];
      if (placeOnCell(nc, nr, model, { scaleMin: 0.9, scaleMax: 1.1 })) pc++;
    }
    const sc = cellCR(this.spawnPos);
    let sp = 0;
    for (const [nc, nr] of [[sc.col-1,sc.row],[sc.col+1,sc.row],[sc.col,sc.row+1],[sc.col-1,sc.row+1],[sc.col+1,sc.row+1]]) {
      if (sp >= 4) break;
      const model = sp < 1 ? rocks[Math.floor(rng()*rocks.length)] : spawnProps[(sp - 1) % spawnProps.length];
      if (placeOnCell(nc, nr, model, { scaleMin: 0.9, scaleMax: 1.2 })) sp++;
    }

    // water plants fringing the moat
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng() * 0.4;
      const d = this.radius * (0.82 + rng() * 0.28);
      placeWorld(Math.cos(a) * d, Math.sin(a) * d, waterPlants[Math.floor(rng() * waterPlants.length)], { scaleMin: 0.6, scaleMax: 1.0, y: -0.34 });
    }
  }

  // ---- picking / lookups ----
  // Climb to the owning tile group and return its userData (or null).
  tileData(obj) { let o = obj; while (o) { if (o.userData && o.userData.isTile) return o.userData; o = o.parent; } return null; }

  worldToCell(x, z) {
    const lx = x - this.origin.x, lz = z - this.origin.z;
    const row = Math.round(lz / (1.5 * this.size));
    const col = Math.round(lx / (SQRT3 * this.size) - 0.5 * (row & 1));
    return { col, row };
  }

  getBuildable(col, row) {
    const cell = this.cells.get(cellKey(col, row));
    if (!cell || cell.occupied) return null;
    return cell;
  }

  occupy(cell) { cell.occupied = true; }
  free(cell) { cell.occupied = false; }
}
