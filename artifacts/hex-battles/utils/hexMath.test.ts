import { describe, it, expect } from "vitest";
import {
  tileKey,
  hexDistance,
  hexToPixel,
  hexCornerPoint,
  hexCornersString,
  hexNeighbors,
  hexNeighborKeys,
  hexRing,
  hexBfsDistance,
} from "@/utils/hexMath";

describe("tileKey", () => {
  it("formats q,r as string", () => {
    expect(tileKey(0, 0)).toBe("0,0");
    expect(tileKey(3, -2)).toBe("3,-2");
    expect(tileKey(-5, 7)).toBe("-5,7");
  });
});

describe("hexDistance", () => {
  it("returns 0 for same tile", () => {
    expect(hexDistance(2, 3, 2, 3)).toBe(0);
  });

  it("returns 1 for adjacent tiles", () => {
    expect(hexDistance(0, 0, 1, 0)).toBe(1);
    expect(hexDistance(0, 0, 0, 1)).toBe(1);
    expect(hexDistance(0, 0, -1, 1)).toBe(1);
  });

  it("computes axial distance correctly", () => {
    expect(hexDistance(0, 0, 3, -3)).toBe(3);
    expect(hexDistance(1, 2, -2, 4)).toBe(3);
  });

  it("is symmetric", () => {
    expect(hexDistance(2, -1, -3, 4)).toBe(hexDistance(-3, 4, 2, -1));
  });
});

describe("hexToPixel", () => {
  it("returns origin for (0,0)", () => {
    const { x, y } = hexToPixel(0, 0, 10);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it("flat-top: q=1 shifts x right by 1.5*size", () => {
    const size = 10;
    const { x } = hexToPixel(1, 0, size);
    expect(x).toBeCloseTo(1.5 * size);
  });

  it("flat-top: r=1 shifts y by sqrt(3)*size", () => {
    const size = 10;
    const { y } = hexToPixel(0, 1, size);
    expect(y).toBeCloseTo(Math.sqrt(3) * size);
  });
});

describe("hexCornerPoint", () => {
  it("returns 6 distinct corner positions", () => {
    const points = Array.from({ length: 6 }, (_, i) => hexCornerPoint(0, 0, 10, i));
    const rounded = points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`);
    expect(new Set(rounded).size).toBe(6);
  });

  it("each corner is exactly size units from center", () => {
    const size = 10;
    for (let i = 0; i < 6; i++) {
      const { x, y } = hexCornerPoint(5, 5, size, i);
      const dist = Math.hypot(x - 5, y - 5);
      expect(dist).toBeCloseTo(size);
    }
  });
});

describe("hexCornersString", () => {
  it("produces a string with 6 space-separated x,y pairs", () => {
    const s = hexCornersString(0, 0, 10);
    const pairs = s.trim().split(" ");
    expect(pairs).toHaveLength(6);
    pairs.forEach((pair) => {
      const parts = pair.split(",");
      expect(parts).toHaveLength(2);
      expect(Number.isFinite(Number(parts[0]))).toBe(true);
      expect(Number.isFinite(Number(parts[1]))).toBe(true);
    });
  });
});

describe("hexNeighbors", () => {
  it("returns 6 neighbors", () => {
    expect(hexNeighbors(0, 0)).toHaveLength(6);
  });

  it("all neighbors are exactly distance 1 from origin", () => {
    for (const [nq, nr] of hexNeighbors(2, -1)) {
      expect(hexDistance(2, -1, nq, nr)).toBe(1);
    }
  });

  it("all neighbors are unique", () => {
    const keys = hexNeighbors(0, 0).map(([q, r]) => `${q},${r}`);
    expect(new Set(keys).size).toBe(6);
  });
});

describe("hexNeighborKeys", () => {
  it("returns 6 string keys", () => {
    const keys = hexNeighborKeys(0, 0);
    expect(keys).toHaveLength(6);
    keys.forEach((k) => expect(k).toMatch(/^-?\d+,-?\d+$/));
  });

  it("matches hexNeighbors output", () => {
    const neighbors = hexNeighbors(1, 2);
    const keys = hexNeighborKeys(1, 2);
    expect(keys).toEqual(neighbors.map(([q, r]) => tileKey(q, r)));
  });
});

describe("hexRing", () => {
  it("ring of radius 0 contains only the center", () => {
    expect(hexRing([0, 0], 0)).toEqual([[0, 0]]);
  });

  it("ring of radius 1 has 6 tiles", () => {
    expect(hexRing([0, 0], 1)).toHaveLength(6);
  });

  it("ring of radius 2 has 12 tiles", () => {
    expect(hexRing([0, 0], 2)).toHaveLength(12);
  });

  it("all tiles are unique", () => {
    const tiles = hexRing([0, 0], 3);
    const keys = tiles.map(([q, r]) => `${q},${r}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("hexBfsDistance", () => {
  it("returns 0 from a tile to itself", () => {
    expect(hexBfsDistance("0,0", "0,0", () => true)).toBe(0);
  });

  it("returns 1 for adjacent passable tiles", () => {
    const passable = new Set(["0,0", "1,0"]);
    expect(hexBfsDistance("0,0", "1,0", (k) => passable.has(k))).toBe(1);
  });

  it("returns Infinity when target is unreachable", () => {
    const passable = new Set(["0,0"]);
    expect(hexBfsDistance("0,0", "5,5", (k) => passable.has(k))).toBe(Infinity);
  });

  it("finds path length through a corridor", () => {
    // Path: "0,0" → "1,0" → "2,0" is length 2 (direct)
    const passable = new Set(["1,0"]);
    const dist = hexBfsDistance("0,0", "2,0", (k) => passable.has(k));
    expect(dist).toBe(2);
  });
});
