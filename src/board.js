// ============================================================================
// board.js — builds the 3D hex board: ground tiles, the winding road, the
// castle, decorations; exposes enemy waypoints and the buildable-cell map.
// ============================================================================
import * as THREE from 'three';
import { MODELS, COLORS, LEVEL } from './config.js';
import {
  SQRT3, offsetToWorld, generateSerpentinePath, boardExtents, cellKey,
} from './hex.js';

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
    this.cells = new Map();   // key -> { col,row,pos,occupied,grass }
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

    // --- lay every tile ---
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = cellKey(c, r);
        const isPath = pathKeys.has(k);
        const w = offsetToWorld(c, r, this.size);
        const tile = this.assets.instance(MODELS.tileGrass, {
          groundAlign: false,
          cloneMaterials: isPath,
        });
        tile.position.set(w.x + this.origin.x, 0, w.z + this.origin.z);
        if (isPath) {
          tile.traverse((o) => { if (o.isMesh) o.material.color.set(COLORS.path); });
        }
        this.group.add(tile);
        if (!isPath) this.cells.set(k, { col: c, row: r, pos: tile.position.clone(), occupied: false, grass: tile });
      }
    }

    // --- waypoints from path cells ---
    this.pathPoints = path.map((c) => {
      const w = offsetToWorld(c.col, c.row, this.size);
      return new THREE.Vector3(w.x + this.origin.x, 0, w.z + this.origin.z);
    });
    this.spawnPos.copy(this.pathPoints[0]);
    this.castlePos.copy(this.pathPoints[this.pathPoints.length - 1]);

    // --- castle at the road's end ---
    const castle = this.assets.instance(MODELS.castle, { scale: 1.15, groundAlign: true });
    castle.position.copy(this.castlePos);
    // face the incoming road
    const prev = this.pathPoints[this.pathPoints.length - 2] || this.castlePos;
    castle.lookAt(prev.x, 0, prev.z);
    this.group.add(castle);
    this.castle = castle;

    // --- decorations: trees framing the top & bottom rows ---
    this._decorate(cols, rows, pathKeys);

    // --- backdrop ---
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(this.radius * 6, this.radius * 6),
      new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 1 })
    );
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -1.05;
    backdrop.receiveShadow = true;
    this.scene.add(backdrop);
  }

  _decorate(cols, rows, pathKeys) {
    const trees = MODELS.decoTrees;
    let t = 0;
    const tryTree = (c, r) => {
      const k = cellKey(c, r);
      if (pathKeys.has(k)) return;
      const cell = this.cells.get(k);
      if (!cell || cell.occupied) return;
      const model = trees[t++ % trees.length];
      const tree = this.assets.instance(model, { scale: 0.9 + Math.random() * 0.5, groundAlign: true });
      tree.position.copy(cell.pos);
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(tree);
      cell.occupied = true;
      cell.deco = true;
    };
    for (let c = 0; c < cols; c++) {
      if (c % 2 === 0) { tryTree(c, 0); tryTree(c, rows - 1); }
    }
    // a few scattered
    tryTree(0, 4); tryTree(cols - 1, 2); tryTree(cols - 1, 6);
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
