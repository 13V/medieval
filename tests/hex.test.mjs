import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSerpentinePath, offsetNeighbors, isAdjacent, offsetToWorld, hexMetrics, cellKey,
} from '../src/hex.js';
import { LEVEL, generateWaves, TOWERS, ENEMIES, TOWER_ORDER } from '../src/config.js';

test('serpentine path is contiguous, in-bounds and duplicate-free', () => {
  const { cols, rows, corridorRows } = LEVEL;
  const path = generateSerpentinePath(cols, corridorRows);
  assert.ok(path.length > 0);

  const seen = new Set();
  for (const c of path) {
    assert.ok(c.col >= 0 && c.col < cols, `col ${c.col} in bounds`);
    assert.ok(c.row >= 0 && c.row < rows, `row ${c.row} in bounds`);
    const k = cellKey(c.col, c.row);
    assert.ok(!seen.has(k), `no duplicate cell ${k}`);
    seen.add(k);
  }
  for (let i = 1; i < path.length; i++) {
    assert.ok(isAdjacent(path[i - 1], path[i]),
      `cells ${cellKey(path[i-1].col,path[i-1].row)} -> ${cellKey(path[i].col,path[i].row)} adjacent`);
  }
});

test('neighbor relation is symmetric', () => {
  for (const { col, row } of offsetNeighbors(4, 4)) {
    assert.ok(isAdjacent({ col: 4, row: 4 }, { col, row }));
    assert.ok(isAdjacent({ col, row }, { col: 4, row: 4 }));
  }
});

test('adjacent hex centers are equidistant (~ width apart)', () => {
  const size = 1.1547;
  const { width } = hexMetrics(size);
  const a = offsetToWorld(3, 2, size);
  for (const n of offsetNeighbors(3, 2)) {
    const w = offsetToWorld(n.col, n.row, size);
    const d = Math.hypot(w.x - a.x, w.z - a.z);
    assert.ok(Math.abs(d - width) < 1e-3, `neighbor distance ${d.toFixed(3)} ~= ${width.toFixed(3)}`);
  }
});

test('generateWaves produces 20 waves with bosses at 10 and 20', () => {
  const waves = generateWaves();
  assert.equal(waves.length, 20);
  for (const w of waves) {
    assert.ok(w.prep > 0);
    assert.ok(w.hpMul >= 1);
    assert.ok(w.groups.length > 0);
    for (const g of w.groups) {
      assert.ok(g.count > 0);
      assert.ok(ENEMIES[g.type], `enemy type ${g.type} exists`);
    }
  }
  assert.ok(waves[9].isBoss && waves[9].groups.some((g) => g.type === 'boss'));
  assert.ok(waves[19].isBoss && waves[19].groups.some((g) => g.type === 'boss'));
  assert.ok(!waves[0].isBoss);
});

test('every tower has 3 upgrade levels with sane numbers', () => {
  for (const id of TOWER_ORDER) {
    const t = TOWERS[id];
    assert.equal(t.levels.length, 3, `${id} has 3 levels`);
    for (const lv of t.levels) {
      assert.ok(lv.cost > 0 && lv.range > 0 && lv.fireRate > 0);
      assert.ok(lv.damage >= 0);
    }
  }
});
