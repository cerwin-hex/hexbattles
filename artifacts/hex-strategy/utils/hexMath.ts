export {
  tileKey,
  hexDistance,
  hexToPixel,
  hexCornerPoint,
  hexCornersString,
  getBoardBounds,
  HEX_EDGES,
} from "@/utils/hexGrid";

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
