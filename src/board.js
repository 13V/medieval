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
    // Terrain climbs toward the back (high rows) where a mountain rises; the
    // castle sits on a plateau at its foot. Cliffs drop on the left/right/front.
    const tierAt = (c, r) => {
      const w = offsetToWorld(c, r, s);
      const wx = w.x + ox, wz = w.z + oz;
      const dCastle = Math.hypot(wx - castleAnchor.x, wz - castleAnchor.z) / colStep;
      const hCastle = MAX_TIER - Math.floor(dCastle / 1.8);            // castle plateau
      const slope = Math.floor((r * MAX_TIER) / (rows - 1) + 0.001);   // rises toward the mountain
      const cap = Math.min(c, cols - 1 - c, r);                        // cliffs on left/right/front
      const base = Math.min(Math.max(slope, 0), cap);
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
    this._buildCliffs();
    this._buildBackdropMountain();

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

    // (the rocky cliff face is built from mountain models in _buildCliffs)
  }

  // Hidden bulk under the island: a thin dirt rim + a solid grey rock core.
  // The visible cliff face is built from mountain models in _buildCliffs().
  _buildIslandBase() {
    const R = this.radius;
    const top = BASE_LIFT - 0.05;
    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.98, R * 0.9, 0.7, 12, 1),
      new THREE.MeshStandardMaterial({ color: 0x6f4a2a, roughness: 1, flatShading: true })
    );
    soil.position.y = top - 0.35;
    soil.receiveShadow = true;
    this.group.add(soil);

    const rockTop = top - 0.7, rockBottom = -0.8;
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.9, R * 0.5, rockTop - rockBottom, 10, 1),
      new THREE.MeshStandardMaterial({ color: 0x7d766b, roughness: 1, flatShading: true })
    );
    core.position.y = (rockTop + rockBottom) / 2;
    core.receiveShadow = true;
    this.group.add(core);
  }

  // A single snow-capped rock peak.
  _peak(x, z, height, baseR) {
    const rock = new THREE.Mesh(
      new THREE.ConeGeometry(baseR, height, 7, 1),
      new THREE.MeshStandardMaterial({ color: 0x847d72, roughness: 1, flatShading: true })
    );
    rock.position.set(x, -0.6 + height / 2, z);
    rock.castShadow = true; rock.receiveShadow = true;
    this.group.add(rock);
    const snowH = height * 0.34;
    const snow = new THREE.Mesh(
      new THREE.ConeGeometry(baseR * 0.36, snowH, 7, 1),
      new THREE.MeshStandardMaterial({ color: 0xeef3f8, roughness: 0.85, flatShading: true })
    );
    snow.position.set(x, -0.6 + height - snowH / 2, z);
    this.group.add(snow);
  }

  // Big mountain range rising behind the island, with rocky foothills bridging
  // the board's back cliff up to the peaks — so the map reads as a shelf on the
  // side of the mountain rather than an island in the sea.
  _buildBackdropMountain() {
    const R = this.radius;
    // looming snow-capped peaks (kept just clear of the playable tiles)
    this._peak(0,        R * 1.95, 20, R * 0.98);
    this._peak(-R * 0.95, R * 1.72, 14, R * 0.64);
    this._peak(R * 1.0,  R * 1.78, 15, R * 0.66);
    this._peak(-R * 0.3, R * 2.5,  16, R * 0.62);
    this._peak(R * 0.45, R * 2.55, 14.5, R * 0.58);

    // rocky foothills bridging the back edge up into the mountain
    let seed = 555;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
    const cliffs = MODELS.decoCliffs;
    for (let i = 0; i < 18; i++) {
      const x = (-1 + 2 * (i / 17)) * R * 1.1;
      const z = R * (1.0 + rng() * 0.55);
      const o = this.assets.instance(cliffs[Math.floor(rng() * cliffs.length)], { scale: 2.2 + rng() * 2.0, groundAlign: true });
      o.position.set(x, -0.8, z);
      o.rotation.y = rng() * Math.PI * 2;
      this.group.add(o);
    }
  }

  // Craggy rocky cliff face around the island + a rocky peak under the castle
  // (KayKit "create rocky landscapes" pattern, matching the promo dioramas).
  _buildCliffs() {
    const R = this.radius;
    let seed = 7;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
    const cliffs = MODELS.decoCliffs;
    const place = (model, x, y, z, sc) => {
      const o = this.assets.instance(model, { scale: sc, groundAlign: true });
      o.position.set(x, y, z); o.rotation.y = rng() * Math.PI * 2;
      this.group.add(o);
    };
    // main cliff ring: tall grey mountains just OUTSIDE the tile edge, spanning
    // water → island rim, dense + overlapping for a continuous craggy wall.
    const N = 32;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const d = R * (1.0 + rng() * 0.12);
      place(cliffs[Math.floor(rng() * cliffs.length)], Math.cos(a) * d, -0.85, Math.sin(a) * d, 1.9 + rng() * 1.0);
      // lower outer boulders at the waterline for a layered coastline
      if (rng() < 0.8) {
        const a2 = a + (rng() - 0.5) * 0.16, d2 = R * (1.14 + rng() * 0.12);
        place(cliffs[Math.floor(rng() * cliffs.length)], Math.cos(a2) * d2, -0.95, Math.sin(a2) * d2, 1.0 + rng() * 0.8);
      }
    }
    // rocky grass-topped peak collar under the castle
    const cp = this.castlePos, cg = MODELS.decoCliffGrass;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const d = this.size * (0.85 + rng() * 0.5);
      place(cg[i % cg.length], cp.x + Math.cos(a) * d, cp.y - 1.4, cp.z + Math.sin(a) * d, 0.7 + rng() * 0.5);
    }
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
