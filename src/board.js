// ============================================================================
// board.js — builds the 3D hex board: ground tiles, the winding road, the
// castle, decorations; exposes enemy waypoints and the buildable-cell map.
// ============================================================================
import * as THREE from 'three';
import { MODELS, COLORS, LEVEL } from './config.js';
import {
  SQRT3, offsetToWorld, generateSerpentinePath, boardExtents, cellKey,
} from './hex.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snap radians to nearest multiple of 60° (PI/3). */
function snap60(radians) {
  return Math.round(radians / (Math.PI / 3)) * (Math.PI / 3);
}

/**
 * Build a flat-top hexagonal CylinderGeometry approximation.
 * tileSize = circumradius. Returns a Mesh, not a Group.
 */
function makeHexMesh(tileSize, material) {
  // CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, ...)
  // 6 segments = hexagon; openEnded=false. Height small so it sits flush.
  const geo = new THREE.CylinderGeometry(tileSize * 0.995, tileSize * 0.995, 0.12, 6, 1, false);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export class Board {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.size = 1;
    this.origin = new THREE.Vector3();
    this.pathPoints = [];     // THREE.Vector3[] enemy waypoints (y=0)
    this.spawnPos = new THREE.Vector3();
    this.castlePos = new THREE.Vector3();
    this.cells = new Map();   // key -> { col,row,pos,occupied,grass,deco }
    this.radius = 10;
  }

  build() {
    const { cols, rows, corridorRows } = LEVEL;
    const gb = this.assets.box(MODELS.tileGrass);
    this.size = (gb.max.x - gb.min.x) / SQRT3; // pointy-top circumradius

    const ext = boardExtents(cols, rows, this.size);
    this.origin.set(-ext.cx, 0, -ext.cz);
    this.radius = Math.max(ext.maxX - ext.minX, ext.maxZ - ext.minZ) / 2 + this.size;

    const path = generateSerpentinePath(cols, corridorRows);
    const pathKeys = new Set(path.map((c) => cellKey(c.col, c.row)));

    // ---- Grass Summer texture — load async, apply to all grass tile materials ----
    // We collect grass material refs so the texture callback can patch them in.
    const grassMaterials = [];
    const texLoader = new THREE.TextureLoader();
    texLoader.load(
      MODELS.tileSummerTex,
      (tex) => {
        tex.flipY = false; // glTF UV convention
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        for (const mat of grassMaterials) {
          mat.map = tex;
          mat.color.set(0xffffff); // let the texture provide colour
          mat.needsUpdate = true;
        }
      },
      undefined,
      () => { /* texture missing — fall back to tinted material colour */ }
    );

    // ---- Lay every tile ----
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = cellKey(c, r);
        const isPath = pathKeys.has(k);
        const w = offsetToWorld(c, r, this.size);

        const tile = this.assets.instance(MODELS.tileGrass, {
          groundAlign: false,
          cloneMaterials: true, // always clone so we can tint individually
        });
        tile.position.set(w.x + this.origin.x, 0, w.z + this.origin.z);

        // Random 60° Y-rotation for visual variety
        tile.rotation.y = snap60(Math.floor(Math.random() * 6) * (Math.PI / 3));

        if (isPath) {
          // Clean dirt road: fresh MeshStandardMaterial, no atlas map, warm sandy colour
          tile.traverse((o) => {
            if (o.isMesh) {
              o.material = new THREE.MeshStandardMaterial({
                color: 0xc8a05a,
                roughness: 0.92,
                metalness: 0.0,
              });
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
        } else {
          // Collect grass materials for Summer texture application
          tile.traverse((o) => {
            if (o.isMesh) {
              // Tint slightly warmer green for a lush field
              o.material.color.set(0x8acc5a);
              grassMaterials.push(o.material);
            }
          });
        }

        this.group.add(tile);

        if (!isPath) {
          this.cells.set(k, {
            col: c, row: r,
            pos: tile.position.clone(), // true tile centre — MUST NOT be altered
            occupied: false,
            grass: tile,
            deco: false,
          });
        }
      }
    }

    // ---- Waypoints from path cells ----
    this.pathPoints = path.map((c) => {
      const w = offsetToWorld(c.col, c.row, this.size);
      return new THREE.Vector3(w.x + this.origin.x, 0, w.z + this.origin.z);
    });
    this.spawnPos.copy(this.pathPoints[0]);
    this.castlePos.copy(this.pathPoints[this.pathPoints.length - 1]);

    // ---- Castle at the road's end ----
    const castle = this.assets.instance(MODELS.castle, { scale: 1.15, groundAlign: true });
    castle.position.copy(this.castlePos);
    const prev = this.pathPoints[this.pathPoints.length - 2] || this.castlePos;
    castle.lookAt(prev.x, 0, prev.z);
    this.group.add(castle);
    this.castle = castle;

    // ---- Water moat island framing ----
    this._buildWaterRing(cols, rows);

    // ---- Decorations ----
    this._decorate(cols, rows, pathKeys);

    // ---- Backdrop: deep water plane replacing the old green grass plane ----
    const backdropSize = this.radius * 7;
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(backdropSize, backdropSize),
      new THREE.MeshStandardMaterial({
        color: COLORS.waterBackdrop,
        roughness: 0.85,
        metalness: 0.1,
      })
    );
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -0.55; // slightly below the water hex tiles
    backdrop.receiveShadow = true;
    this.scene.add(backdrop);
  }

  // --------------------------------------------------------------------------
  // Water moat ring — hex tiles made from CylinderGeometry ringing the board
  // --------------------------------------------------------------------------
  _buildWaterRing(cols, rows) {
    const s = this.size;

    // Two water material variants for depth variation
    const matDeep = new THREE.MeshStandardMaterial({
      color: COLORS.waterDeep,
      roughness: 0.6,
      metalness: 0.25,
    });
    const matShallow = new THREE.MeshStandardMaterial({
      color: COLORS.waterShallow,
      roughness: 0.5,
      metalness: 0.3,
    });

    // Gather all grid positions to know what's "inside"
    const gridSet = new Set();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        gridSet.add(cellKey(c, r));
      }
    }

    // Place water hex tiles in a ring 1 and 2 cells outside the grid extent.
    // We iterate over an expanded bounding box in offset coordinates.
    const ringCells = new Set();

    const minC = -3, maxC = cols + 2;
    const minR = -3, maxR = rows + 2;

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (gridSet.has(cellKey(c, r))) continue; // skip inner board tiles
        const w = offsetToWorld(c, r, s);
        const wx = w.x + this.origin.x;
        const wz = w.z + this.origin.z;

        // Only place water cells within a reasonable distance of the board
        const distFromCenter = Math.max(Math.abs(wx), Math.abs(wz));
        if (distFromCenter > this.radius * 1.8) continue;

        const rKey = cellKey(c, r);
        if (ringCells.has(rKey)) continue;
        ringCells.add(rKey);

        // Vary mat by distance: closer = shallow, farther = deep
        const distNorm = distFromCenter / (this.radius * 1.5);
        const mat = distNorm > 0.55 ? matDeep : matShallow;
        const mesh = makeHexMesh(s, mat);
        // Water tiles sit slightly below board tiles
        mesh.position.set(wx, -0.32, wz);
        // Random 60° rotation for variety
        mesh.rotation.y = (Math.floor(Math.random() * 6)) * (Math.PI / 3);
        this.group.add(mesh);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Rich decoration system
  // --------------------------------------------------------------------------
  _decorate(cols, rows, pathKeys) {
    // Seeded-ish random via simple counter to get consistent results
    let seed = 42;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

    const nature = MODELS.decoNature;
    const rocks = MODELS.decoRocks;
    const castleProps = MODELS.decoCastleProps;
    const spawnProps = MODELS.decoSpawnProps;
    const waterPlants = MODELS.decoWaterPlants;

    // Helper: place a model on a cell (marks cell occupied+deco)
    const placeOnCell = (col, row, model, opts = {}) => {
      const k = cellKey(col, row);
      if (pathKeys.has(k)) return false;
      const cell = this.cells.get(k);
      if (!cell || cell.occupied) return false;
      const scaleMin = opts.scaleMin ?? 0.85;
      const scaleMax = opts.scaleMax ?? 1.25;
      const obj = this.assets.instance(model, {
        scale: scaleMin + rng() * (scaleMax - scaleMin),
        groundAlign: true,
      });
      obj.position.copy(cell.pos);
      // Offset slightly inside the hex for visual naturalness
      if (opts.jitter) {
        obj.position.x += (rng() - 0.5) * this.size * 0.35;
        obj.position.z += (rng() - 0.5) * this.size * 0.35;
      }
      obj.rotation.y = snap60(rng() * Math.PI * 2);
      this.group.add(obj);
      cell.occupied = true;
      cell.deco = true;
      return true;
    };

    // Helper: place decoration in world space (not on a cell)
    const placeWorld = (wx, wz, model, opts = {}) => {
      const scaleMin = opts.scaleMin ?? 0.8;
      const scaleMax = opts.scaleMax ?? 1.3;
      const obj = this.assets.instance(model, {
        scale: scaleMin + rng() * (scaleMax - scaleMin),
        groundAlign: true,
      });
      obj.position.set(wx, opts.y ?? 0, wz);
      obj.rotation.y = rng() * Math.PI * 2;
      this.group.add(obj);
    };

    // ---- 1. Lush tree border: every border cell gets a tree or rock ----
    // Border = row 0, row rows-1, col 0, col cols-1
    const borderCols = [0, cols - 1];
    const borderRows = [0, rows - 1];

    // Top and bottom rows — dense tree clusters
    for (let c = 0; c < cols; c++) {
      for (const r of borderRows) {
        const k = cellKey(c, r);
        if (pathKeys.has(k)) continue;
        if (!this.cells.has(k)) continue;
        // Alternate trees and rocks for variety
        const model = (c + r) % 4 === 0
          ? rocks[Math.floor(rng() * rocks.length)]
          : nature[Math.floor(rng() * nature.length)];
        placeOnCell(c, r, model, { scaleMin: 0.8, scaleMax: 1.2 });
      }
    }

    // Left and right columns
    for (let r = 1; r < rows - 1; r++) {
      for (const c of borderCols) {
        const k = cellKey(c, r);
        if (pathKeys.has(k)) continue;
        if (!this.cells.has(k)) continue;
        const model = r % 3 === 0
          ? rocks[Math.floor(rng() * rocks.length)]
          : nature[Math.floor(rng() * nature.length)];
        placeOnCell(c, r, model, { scaleMin: 0.75, scaleMax: 1.15 });
      }
    }

    // ---- 2. Interior scattered decoration (sparse — keep most cells free) ----
    // Only decorate a fraction of inner cells far from the path
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const k = cellKey(c, r);
        if (pathKeys.has(k)) continue;
        const cell = this.cells.get(k);
        if (!cell || cell.occupied) continue;
        // Very sparse: ~12% chance per inner cell
        if (rng() > 0.12) continue;
        const model = rng() < 0.35
          ? rocks[Math.floor(rng() * rocks.length)]
          : nature[Math.floor(rng() * nature.length)];
        placeOnCell(c, r, model, { scaleMin: 0.7, scaleMax: 1.0, jitter: true });
      }
    }

    // ---- 3. Castle end cluster — intentional, themed props + flags ----
    // Castle is at pathPoints[last], typically near row corridorRows[last]
    const castleCol = Math.round((this.castlePos.x - this.origin.x) / (SQRT3 * this.size));
    const castleRow = Math.round((this.castlePos.z - this.origin.z) / (1.5 * this.size));

    // Place flags and props in the cells adjacent to castle (non-path cells nearby)
    const castleNeighbors = [
      [castleCol - 1, castleRow],
      [castleCol + 1, castleRow],
      [castleCol, castleRow - 1],
      [castleCol, castleRow + 1],
      [castleCol - 2, castleRow],
      [castleCol + 2, castleRow],
      [castleCol - 1, castleRow - 1],
      [castleCol + 1, castleRow - 1],
    ];
    let propCount = 0;
    for (const [nc, nr] of castleNeighbors) {
      if (propCount >= 4) break;
      const model = propCount < 2
        ? castleProps[propCount % castleProps.length]  // flags first
        : castleProps[2 + ((propCount - 2) % (castleProps.length - 2))]; // barrels/crates
      if (placeOnCell(nc, nr, model, { scaleMin: 0.9, scaleMax: 1.1 })) propCount++;
    }

    // ---- 4. Spawn end cluster — rocky archway feel + camp props ----
    const spawnCol = Math.round((this.spawnPos.x - this.origin.x) / (SQRT3 * this.size));
    const spawnRow = Math.round((this.spawnPos.z - this.origin.z) / (1.5 * this.size));

    const spawnNeighbors = [
      [spawnCol - 1, spawnRow],
      [spawnCol + 1, spawnRow],
      [spawnCol, spawnRow + 1],
      [spawnCol - 1, spawnRow + 1],
      [spawnCol + 1, spawnRow + 1],
      [spawnCol - 2, spawnRow],
      [spawnCol + 2, spawnRow],
    ];
    let spawnPropCount = 0;
    for (const [nc, nr] of spawnNeighbors) {
      if (spawnPropCount >= 5) break;
      const isRock = spawnPropCount < 2;
      const model = isRock
        ? rocks[spawnPropCount % rocks.length]
        : spawnProps[(spawnPropCount - 2) % spawnProps.length];
      if (placeOnCell(nc, nr, model, { scaleMin: 0.9, scaleMax: 1.2 })) spawnPropCount++;
    }

    // ---- 5. Water-edge decorations: place nature in world space around the moat ----
    // Ring of nature pieces just outside the grid boundary
    const s = this.size;
    const ext = boardExtents(LEVEL.cols, LEVEL.rows, s);
    const margin = s * 2.2;

    // Place decorations outside the grid, in 4 "corners" and along edges
    const outerPositions = [
      // corners
      { x: ext.minX + this.origin.x - margin, z: ext.minZ + this.origin.z - margin },
      { x: ext.maxX + this.origin.x + margin, z: ext.minZ + this.origin.z - margin },
      { x: ext.minX + this.origin.x - margin, z: ext.maxZ + this.origin.z + margin },
      { x: ext.maxX + this.origin.x + margin, z: ext.maxZ + this.origin.z + margin },
      // along top edge
      { x: this.origin.x - ext.cx * 0.3, z: ext.minZ + this.origin.z - margin * 1.5 },
      { x: this.origin.x + ext.cx * 0.3, z: ext.minZ + this.origin.z - margin * 1.5 },
      // along bottom edge
      { x: this.origin.x - ext.cx * 0.3, z: ext.maxZ + this.origin.z + margin * 1.5 },
      { x: this.origin.x + ext.cx * 0.3, z: ext.maxZ + this.origin.z + margin * 1.5 },
      // along left edge
      { x: ext.minX + this.origin.x - margin * 1.8, z: this.origin.z },
      // along right edge
      { x: ext.maxX + this.origin.x + margin * 1.8, z: this.origin.z },
    ];

    for (const { x, z } of outerPositions) {
      // Place 1-3 decorations near each outer position
      const count = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < count; i++) {
        const offsetX = (rng() - 0.5) * s * 2;
        const offsetZ = (rng() - 0.5) * s * 2;
        const model = rng() < 0.4
          ? rocks[Math.floor(rng() * rocks.length)]
          : nature[Math.floor(rng() * nature.length)];
        placeWorld(x + offsetX, z + offsetZ, model, { scaleMin: 0.7, scaleMax: 1.2, y: -0.3 });
      }
    }

    // Water plants scattered in moat ring (near board edges but off-tile)
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + rng() * 0.4;
      const dist = this.radius * (0.85 + rng() * 0.3);
      const wx = Math.cos(angle) * dist;
      const wz = Math.sin(angle) * dist;
      const model = waterPlants[Math.floor(rng() * waterPlants.length)];
      placeWorld(wx, wz, model, { scaleMin: 0.6, scaleMax: 1.0, y: -0.28 });
    }
  }

  // Nearest cell for a world point (inverse offset). Returns {col,row} (may be out of range).
  worldToCell(x, z) {
    const lx = x - this.origin.x;
    const lz = z - this.origin.z;
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
