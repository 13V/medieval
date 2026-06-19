// ============================================================================
// hex.js — pointy-top hex grid math using "odd-r" offset coordinates.
// No Three.js. KayKit hexes measure flat-to-flat = sqrt(3)*size on X and
// corner-to-corner = 2*size on Z, so they are pointy-top with size = w/sqrt(3).
// ============================================================================

export const SQRT3 = Math.sqrt(3);

export function hexMetrics(size) {
  return {
    width: SQRT3 * size,   // flat-to-flat (X)
    height: 2 * size,      // corner-to-corner (Z)
    colStep: SQRT3 * size, // horizontal distance between columns
    rowStep: 1.5 * size,   // vertical distance between rows
  };
}

// World position (XZ plane) of an offset cell center. Y is left to the caller.
export function offsetToWorld(col, row, size) {
  const x = size * SQRT3 * (col + 0.5 * (row & 1));
  const z = size * 1.5 * row;
  return { x, z };
}

// Direction order: E, NE, NW, W, SW, SE
const NEIGHBORS_EVEN = [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]];
const NEIGHBORS_ODD = [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];

export function offsetNeighbors(col, row) {
  const table = row & 1 ? NEIGHBORS_ODD : NEIGHBORS_EVEN;
  return table.map(([dc, dr]) => ({ col: col + dc, row: row + dr }));
}

export function isAdjacent(a, b) {
  return offsetNeighbors(a.col, a.row).some((n) => n.col === b.col && n.row === b.row);
}

export const cellKey = (col, row) => `${col},${row}`;

// Build a serpentine road: horizontal corridors joined by 1-cell connectors.
// corridorRows must be spaced exactly 2 apart (e.g. [1,3,5,7]).
export function generateSerpentinePath(cols, corridorRows) {
  const path = [];
  for (let i = 0; i < corridorRows.length; i++) {
    const row = corridorRows[i];
    const leftToRight = i % 2 === 0;
    if (leftToRight) for (let c = 0; c < cols; c++) path.push({ col: c, row });
    else for (let c = cols - 1; c >= 0; c--) path.push({ col: c, row });

    if (i < corridorRows.length - 1) {
      const endCol = leftToRight ? cols - 1 : 0;
      path.push({ col: endCol, row: row + 1 }); // connector; next corridor starts at row+2
    }
  }
  return path;
}

// Extents of the full grid in world space, plus center (for centering the board).
export function boardExtents(cols, rows, size) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { x, z } = offsetToWorld(c, r, size);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}
