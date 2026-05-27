import type { HexTile, BoardBounds } from "@/types";

export const HEX_EDGES: Array<{ dir: [number, number]; verts: [number, number] }> = [
  { dir: [1, 0],   verts: [0, 1] },
  { dir: [-1, 0],  verts: [3, 4] },
  { dir: [0, 1],   verts: [1, 2] },
  { dir: [0, -1],  verts: [4, 5] },
  { dir: [1, -1],  verts: [5, 0] },
  { dir: [-1, 1],  verts: [2, 3] },
];

export function tileKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(q1 + r1 - q2 - r2));
}

export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * (3 / 2) * q,
    y: size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r),
  };
}

export function hexCornerPoint(
  cx: number,
  cy: number,
  size: number,
  i: number,
): { x: number; y: number } {
  const angle = (Math.PI / 3) * i;
  return {
    x: cx + size * Math.cos(angle),
    y: cy + size * Math.sin(angle),
  };
}

export function hexCornersString(cx: number, cy: number, size: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const pt = hexCornerPoint(cx, cy, size, i);
    return `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`;
  }).join(' ');
}

export function getBoardBounds(tiles: HexTile[], size: number): BoardBounds {
  if (tiles.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const tile of tiles) {
    const { x, y } = hexToPixel(tile.q, tile.r, size);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = size * 1.5;
  minX -= pad; minY -= pad;
  maxX += pad; maxY += pad;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function hexNeighbors(q: number, r: number): [number, number][] {
  return [
    [q + 1, r],
    [q - 1, r],
    [q, r + 1],
    [q, r - 1],
    [q + 1, r - 1],
    [q - 1, r + 1],
  ];
}

export function hexNeighborKeys(q: number, r: number): string[] {
  return hexNeighbors(q, r).map(([nq, nr]) => `${nq},${nr}`);
}

export function hexRing(center: [number, number], radius: number): [number, number][] {
  if (radius === 0) return [center];
  const [cq, cr] = center;
  const results: [number, number][] = [];
  let q = cq + radius;
  let r = cr - radius;
  const dirs: [number, number][] = [[-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0], [0, 1]];
  for (const [dq, dr] of dirs) {
    for (let i = 0; i < radius; i++) {
      results.push([q, r]);
      q += dq;
      r += dr;
    }
  }
  return results;
}

export function hexBfsDistance(
  fromKey: string,
  toKey: string,
  isPassable: (key: string) => boolean,
  maxDepth = 100,
): number {
  if (fromKey === toKey) return 0;
  const visited = new Set<string>([fromKey]);
  const queue: [string, number][] = [[fromKey, 0]];
  while (queue.length > 0) {
    const [curr, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;
    const [q, r] = curr.split(",").map(Number);
    for (const [nq, nr] of hexNeighbors(q, r)) {
      const nk = `${nq},${nr}`;
      if (nk === toKey) return depth + 1;
      if (!visited.has(nk) && isPassable(nk)) {
        visited.add(nk);
        queue.push([nk, depth + 1]);
      }
    }
  }
  return Infinity;
}
