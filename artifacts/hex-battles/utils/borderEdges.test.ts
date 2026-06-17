import { describe, it, expect } from "vitest";
import type { BorderEdge, HexTile, TerritoryOwner } from "@/types";
import {
  computeBorderEdges,
  computeOuterTerritoryEdges,
  computeSelectionBorderEdges,
} from "@/utils/borderEdges";
import type { BorderEdgesCache, OuterEdgesCache } from "@/utils/borderEdges";

const INNER_SIZE = 40;
const HEX_SIZE = 50;
const BORDER_W = 3;
const BORDERS: Record<string, string> = {
  player: "#1565C0",
  ai1: "#C62828",
  ai2: "#6A1B9A",
  ai3: "#2E7D32",
  ai4: "#EF6C00",
  ai5: "#00838F",
};

function tile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, terrain, owner, key: `${q},${r}`, cityBuffer: false, isCity: false };
}

function makeBoard(tiles: HexTile[]) {
  const map = new Map<string, HexTile>(tiles.map((t) => [t.key, t]));
  const tileData = tiles.map((t, i) => ({ tile: t, cx: i * 1000, cy: 0 }));
  const tileDataMap = new Map(tileData.map(({ tile: t, cx, cy }) => [t.key, { cx, cy }]));
  return { map, tileData, tileDataMap };
}

// Edges belonging to the tile whose center sits at cx (tiles are spaced 1000px
// apart, far larger than any hex radius, so an edge's endpoints uniquely
// identify their owning tile).
function edgesNear(edges: BorderEdge[], cx: number): number {
  return edges.filter((e) => Math.abs(e.x1 - cx) < 200 && Math.abs(e.x2 - cx) < 200)
    .length;
}

describe("computeBorderEdges incremental cache", () => {
  it("recomputes a tile's edges when the source map is mutated IN PLACE", () => {
    // Repro for the bankrupt-bridge bug: endTurnHandler flips a lake/bridge
    // tile's owner to "neutral" by mutating the same map object the cache holds
    // as `prev`. If the cache stored that map by reference, the change would be
    // invisible to the next diff and the border would linger forever.
    const lake = tile(0, 0, "ai1", "lake");
    const grass = tile(1, 0, "ai1", "grass");
    const { map, tileData, tileDataMap } = makeBoard([lake, grass]);
    const cache: { current: BorderEdgesCache } = { current: null };

    const first = computeBorderEdges(
      cache, tileData, map, tileDataMap, map, INNER_SIZE, BORDER_W, BORDERS,
    );
    // The owned lake tile (at cx=0) must draw border edges.
    expect(edgesNear(first, 0)).toBeGreaterThan(0);

    // Mutate the SAME map object in place — owner of the lake tile goes neutral
    // (exactly what bankruptcy demolition does to a ruined bridge's tile).
    map.set(lake.key, { ...map.get(lake.key)!, owner: "neutral" });

    const second = computeBorderEdges(
      cache, tileData, map, tileDataMap, map, INNER_SIZE, BORDER_W, BORDERS,
    );
    // A neutral non-city tile draws no territory border. The stale border around
    // the lake tile must be gone after the in-place mutation.
    expect(edgesNear(second, 0)).toBe(0);
  });
});

describe("computeOuterTerritoryEdges incremental cache", () => {
  it("recomputes a tile's edges when the source map is mutated IN PLACE", () => {
    const grass = tile(0, 0, "ai1", "grass");
    const { map, tileData, tileDataMap } = makeBoard([grass]);
    const cache: { current: OuterEdgesCache } = { current: null };

    const first = computeOuterTerritoryEdges(
      cache, tileData, map, tileDataMap, map, HEX_SIZE,
    );
    expect(first.length).toBeGreaterThan(0);

    map.set(grass.key, { ...map.get(grass.key)!, owner: "neutral" });

    const second = computeOuterTerritoryEdges(
      cache, tileData, map, tileDataMap, map, HEX_SIZE,
    );
    // Neutral non-impassable tile contributes no outer edges.
    expect(second.length).toBe(0);
  });
});

describe("computeSelectionBorderEdges", () => {
  it("outlines a single tile with all 6 edges in the default white", () => {
    const grass = tile(0, 0, "player", "grass");
    const { map, tileDataMap } = makeBoard([grass]);

    const edges = computeSelectionBorderEdges(
      new Set([grass.key]),
      tileDataMap,
      map,
      INNER_SIZE,
      BORDER_W,
    );
    expect(edges.length).toBe(6);
    expect(edges.every((e) => e.color === "#FFFFFF")).toBe(true);
  });

  it("honors the color param for the building selection cue", () => {
    const grass = tile(0, 0, "player", "grass");
    const { map, tileDataMap } = makeBoard([grass]);

    const edges = computeSelectionBorderEdges(
      new Set([grass.key]),
      tileDataMap,
      map,
      INNER_SIZE,
      BORDER_W,
      "#50FF50",
    );
    expect(edges.length).toBe(6);
    expect(edges.every((e) => e.color === "#50FF50")).toBe(true);
  });
});
