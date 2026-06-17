import type { BorderEdge, HexTile, TerritoryOwner } from "@/types";
import { tileKey, hexCornerPoint } from "@/utils/hexMath";
import { ORDERED_EDGES } from "@/constants/gameConstants";
import { CITY_BUFFER_BORDER } from "@/constants/colors";

// The cache stores a COPIED owner snapshot (key → owner), never a reference to
// the live mutableTileMap. endTurnHandler mutates the React-state tile map in
// place when bankruptcy demolishes a bridge (owner → "neutral"); a live
// reference would then read the post-mutation owner as "prev", the diff would
// see no change, and the demolished tile's stale border edges would never be
// recomputed. Snapshotting the owner values makes the diff immune to in-place
// mutation of the source map.
export type BorderEdgesCache = {
  ownerSnapshot: Map<string, TerritoryOwner>;
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  INNER_SIZE: number;
  perTileEdges: Map<string, BorderEdge[]>;
  result: BorderEdge[];
} | null;

export type OuterEdgesCache = {
  ownerSnapshot: Map<string, TerritoryOwner>;
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  HEX_SIZE: number;
  perTileEdges: Map<string, BorderEdge[]>;
  result: BorderEdge[];
} | null;

export function computeBorderEdges(
  cache: { current: BorderEdgesCache },
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>,
  tileMap: Map<string, HexTile>,
  tileDataMap: Map<string, { cx: number; cy: number }>,
  mutableTileMap: Map<string, HexTile>,
  INNER_SIZE: number,
  BORDER_W: number,
  territoryBorders: Record<string, string>,
): BorderEdge[] {
  const ownerOf = (key: string, base: HexTile) =>
    mutableTileMap.get(key)?.owner ?? base.owner;

  const prev = cache.current;
  const isNewBoard =
    !prev || prev.tileData !== tileData || prev.INNER_SIZE !== INNER_SIZE;

  // Reuse the previous perTileEdges map by mutating it in place. The cache is
  // private to this module and the returned BorderEdge[] is rebuilt every call,
  // so the map itself is never observed by anything outside.
  const perTileEdges: Map<string, BorderEdge[]> = isNewBoard
    ? new Map()
    : prev!.perTileEdges;

  const changedKeys = new Set<string>();
  if (isNewBoard) {
    for (const { tile } of tileData) changedKeys.add(tile.key);
  } else {
    for (const [key, tile] of mutableTileMap) {
      if (prev!.ownerSnapshot.get(key) !== tile.owner) {
        changedKeys.add(key);
        const [q, r] = key.split(",").map(Number);
        for (const { dir: [dq, dr] } of ORDERED_EDGES) {
          changedKeys.add(tileKey(q + dq, r + dr));
        }
      }
    }
    for (const [key] of prev!.ownerSnapshot) {
      if (!mutableTileMap.has(key)) {
        changedKeys.add(key);
        const [q, r] = key.split(",").map(Number);
        for (const { dir: [dq, dr] } of ORDERED_EDGES) {
          changedKeys.add(tileKey(q + dq, r + dr));
        }
      }
    }
  }

  const computeEdgesForTile = (
    tile: HexTile,
    cx: number,
    cy: number,
  ): BorderEdge[] => {
    const edges: BorderEdge[] = [];
    const liveOwner = ownerOf(tile.key, tile);
    if (
      tile.terrain === "mountain" ||
      liveOwner === "neutral"
    ) {
      if ((tile.cityBuffer || tile.isCity) && liveOwner === "neutral") {
        for (const {
          dir: [dq, dr],
          verts: [va, vb],
        } of ORDERED_EDGES) {
          const nk = tileKey(tile.q + dq, tile.r + dr);
          const neighborBase = tileMap.get(nk);
          const neighborLiveOwner = neighborBase
            ? ownerOf(nk, neighborBase)
            : null;
          const neighborIsNeutralCity =
            neighborBase !== undefined &&
            neighborLiveOwner === "neutral" &&
            (neighborBase.cityBuffer || neighborBase.isCity);
          if (neighborIsNeutralCity) continue;
          const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
          edges.push({
            x1: ptA.x,
            y1: ptA.y,
            x2: ptB.x,
            y2: ptB.y,
            color: CITY_BUFFER_BORDER,
            width: BORDER_W,
          });
        }
      }
      return edges;
    }
    const color = territoryBorders[liveOwner as TerritoryOwner]!;
    if (!color) return edges;
    for (const {
      dir: [dq, dr],
      verts: [va, vb],
    } of ORDERED_EDGES) {
      const nk = tileKey(tile.q + dq, tile.r + dr);
      const neighborBase = tileMap.get(nk);
      if (!neighborBase) {
        const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
        edges.push({
          x1: ptA.x,
          y1: ptA.y,
          x2: ptB.x,
          y2: ptB.y,
          color,
          width: BORDER_W,
        });
        continue;
      }
      const neighborLiveOwner = ownerOf(nk, neighborBase);
      const needsBorder =
        neighborBase.terrain === "mountain" ||
        neighborLiveOwner === "neutral" ||
        neighborLiveOwner !== liveOwner;
      if (!needsBorder) continue;
      const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
      const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
      edges.push({
        x1: ptA.x,
        y1: ptA.y,
        x2: ptB.x,
        y2: ptB.y,
        color,
        width: BORDER_W,
      });
    }
    return edges;
  };

  for (const key of changedKeys) {
    const baseTile = tileMap.get(key);
    const pos = tileDataMap.get(key);
    if (!baseTile || !pos) {
      perTileEdges.delete(key);
      continue;
    }
    perTileEdges.set(key, computeEdgesForTile(baseTile, pos.cx, pos.cy));
  }

  const allEdges: BorderEdge[] = [];
  for (const { tile } of tileData) {
    const tileEdges = perTileEdges.get(tile.key);
    if (tileEdges) for (const e of tileEdges) allEdges.push(e);
  }

  const ownerSnapshot = new Map<string, TerritoryOwner>();
  for (const [key, tile] of mutableTileMap) ownerSnapshot.set(key, tile.owner);
  cache.current = {
    ownerSnapshot,
    tileData,
    INNER_SIZE,
    perTileEdges,
    result: allEdges,
  };
  return allEdges;
}

export function computeOuterTerritoryEdges(
  cache: { current: OuterEdgesCache },
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>,
  tileMap: Map<string, HexTile>,
  tileDataMap: Map<string, { cx: number; cy: number }>,
  mutableTileMap: Map<string, HexTile>,
  HEX_SIZE: number,
): BorderEdge[] {
  const ownerOf = (key: string, base: HexTile) =>
    mutableTileMap.get(key)?.owner ?? base.owner;

  const prev = cache.current;
  const isNewBoard =
    !prev || prev.tileData !== tileData || prev.HEX_SIZE !== HEX_SIZE;

  const perTileEdges: Map<string, BorderEdge[]> = isNewBoard
    ? new Map()
    : prev!.perTileEdges;

  const changedKeys = new Set<string>();
  if (isNewBoard) {
    for (const { tile } of tileData) changedKeys.add(tile.key);
  } else {
    for (const [key, tile] of mutableTileMap) {
      if (prev!.ownerSnapshot.get(key) !== tile.owner) {
        changedKeys.add(key);
        const [q, r] = key.split(",").map(Number);
        for (const { dir: [dq, dr] } of ORDERED_EDGES) {
          changedKeys.add(tileKey(q + dq, r + dr));
        }
      }
    }
    for (const [key] of prev!.ownerSnapshot) {
      if (!mutableTileMap.has(key)) {
        changedKeys.add(key);
        const [q, r] = key.split(",").map(Number);
        for (const { dir: [dq, dr] } of ORDERED_EDGES) {
          changedKeys.add(tileKey(q + dq, r + dr));
        }
      }
    }
  }

  const computeOuterEdgesForTile = (
    tile: HexTile,
    cx: number,
    cy: number,
  ): BorderEdge[] => {
    const edges: BorderEdge[] = [];
    const liveOwner = ownerOf(tile.key, tile);
    const isImpassable =
      tile.terrain === "mountain" || tile.terrain === "lake";
    if (!isImpassable && liveOwner === "neutral") return edges;

    for (const {
      dir: [dq, dr],
      verts: [va, vb],
    } of ORDERED_EDGES) {
      const nk = tileKey(tile.q + dq, tile.r + dr);
      const neighborBase = tileMap.get(nk);

      if (!neighborBase) {
        const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
        edges.push({
          x1: ptA.x,
          y1: ptA.y,
          x2: ptB.x,
          y2: ptB.y,
          color: "#000000",
          width: 2,
        });
        continue;
      }

      if (isImpassable) {
        if (neighborBase.terrain === tile.terrain) continue;
        // An owned (bridged) lake belongs to its owner's territory. Suppress the
        // black silhouette edge toward that owner's own land so the lake reads as
        // part of the territory rather than a fenced-off hole — the owner-coloured
        // inner border (computeBorderEdges) wraps its outward-facing edges instead.
        if (tile.terrain === "lake" && liveOwner !== "neutral") {
          const neighborLiveOwner = ownerOf(nk, neighborBase);
          if (neighborLiveOwner === liveOwner) continue;
        }
        const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
        edges.push({
          x1: ptA.x,
          y1: ptA.y,
          x2: ptB.x,
          y2: ptB.y,
          color: "#000000",
          width: 2,
        });
      } else {
        const neighborLiveOwner = ownerOf(nk, neighborBase);
        const needsBorder =
          neighborBase.terrain === "mountain" ||
          neighborLiveOwner === "neutral" ||
          neighborLiveOwner !== liveOwner;
        if (!needsBorder) continue;
        const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
        edges.push({
          x1: ptA.x,
          y1: ptA.y,
          x2: ptB.x,
          y2: ptB.y,
          color: "#000000",
          width: 2,
        });
      }
    }
    return edges;
  };

  for (const key of changedKeys) {
    const baseTile = tileMap.get(key);
    const pos = tileDataMap.get(key);
    if (!baseTile || !pos) {
      perTileEdges.delete(key);
      continue;
    }
    perTileEdges.set(key, computeOuterEdgesForTile(baseTile, pos.cx, pos.cy));
  }

  const allEdges: BorderEdge[] = [];
  for (const { tile } of tileData) {
    const tileEdges = perTileEdges.get(tile.key);
    if (tileEdges) for (const e of tileEdges) allEdges.push(e);
  }

  const ownerSnapshot = new Map<string, TerritoryOwner>();
  for (const [key, tile] of mutableTileMap) ownerSnapshot.set(key, tile.owner);
  cache.current = {
    ownerSnapshot,
    tileData,
    HEX_SIZE,
    perTileEdges,
    result: allEdges,
  };
  return allEdges;
}

export function computeSelectionBorderEdges(
  selectedTileKeys: Set<string>,
  tileDataMap: Map<string, { cx: number; cy: number }>,
  tileMap: Map<string, HexTile>,
  INNER_SIZE: number,
  BORDER_W: number,
  color: string = "#FFFFFF",
): BorderEdge[] {
  if (selectedTileKeys.size === 0) return [];
  const edges: BorderEdge[] = [];
  for (const key of selectedTileKeys) {
    const pos = tileDataMap.get(key);
    const tile = tileMap.get(key);
    if (!pos || !tile) continue;
    const { cx, cy } = pos;
    for (const {
      dir: [dq, dr],
      verts: [va, vb],
    } of ORDERED_EDGES) {
      const nk = tileKey(tile.q + dq, tile.r + dr);
      if (selectedTileKeys.has(nk)) continue;
      const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
      const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
      edges.push({
        x1: ptA.x,
        y1: ptA.y,
        x2: ptB.x,
        y2: ptB.y,
        color,
        width: BORDER_W,
      });
    }
  }
  return edges;
}
