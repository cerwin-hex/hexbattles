import { describe, it, expect } from "vitest";
import {
  areHexTileLayerEqual,
  areBorderEdgeLayerEqual,
  areCityOverlayLayerEqual,
  areMovementHighlightLayerEqual,
  areMovementHighlightTapTargetsEqual,
  areGraveyardLayerEqual,
  type HexTileLayerEqualProps,
  type BorderEdgeLayerEqualProps,
  type CityOverlayLayerEqualProps,
  type MovementHighlightLayerEqualProps,
  type MovementHighlightTapTargetsEqualProps,
  type GraveyardLayerEqualProps,
} from "@/components/layerEquality";
import type { HexTile, BorderEdge, EntityType } from "@/types";

// ─── areHexTileLayerEqual ────────────────────────────────────────────────────

function makeHexTileLayerProps(
  overrides: Partial<HexTileLayerEqualProps> = {},
): HexTileLayerEqualProps {
  return {
    tileData: [],
    activeTileMap: new Map<string, HexTile>(),
    cities: new Set<string>(),
    hasSelection: false,
    HEX_SIZE: 30,
    ...overrides,
  };
}

describe("areHexTileLayerEqual", () => {
  it("returns true when all props are identical references", () => {
    const props = makeHexTileLayerProps();
    expect(areHexTileLayerEqual(props, props)).toBe(true);
  });

  it("returns true when refs and scalars are the same", () => {
    const tileData: HexTileLayerEqualProps["tileData"] = [];
    const activeTileMap = new Map<string, HexTile>();
    const cities = new Set<string>();
    const a = makeHexTileLayerProps({ tileData, activeTileMap, cities, hasSelection: false, HEX_SIZE: 40 });
    const b = makeHexTileLayerProps({ tileData, activeTileMap, cities, hasSelection: false, HEX_SIZE: 40 });
    expect(areHexTileLayerEqual(a, b)).toBe(true);
  });

  it("returns false when tileData reference changes", () => {
    const base = makeHexTileLayerProps();
    const next = makeHexTileLayerProps({
      activeTileMap: base.activeTileMap,
      cities: base.cities,
      tileData: [],
    });
    expect(areHexTileLayerEqual(base, next)).toBe(false);
  });

  it("returns false when activeTileMap reference changes", () => {
    const base = makeHexTileLayerProps();
    const next = makeHexTileLayerProps({
      tileData: base.tileData,
      cities: base.cities,
      activeTileMap: new Map(),
    });
    expect(areHexTileLayerEqual(base, next)).toBe(false);
  });

  it("returns false when cities reference changes", () => {
    const base = makeHexTileLayerProps();
    const next = makeHexTileLayerProps({
      tileData: base.tileData,
      activeTileMap: base.activeTileMap,
      cities: new Set(),
    });
    expect(areHexTileLayerEqual(base, next)).toBe(false);
  });

  it("returns true when only hasSelection flips (selection is controlled by G opacity, not re-render)", () => {
    const tileData: HexTileLayerEqualProps["tileData"] = [];
    const activeTileMap = new Map<string, HexTile>();
    const cities = new Set<string>();
    const base = makeHexTileLayerProps({ tileData, activeTileMap, cities, hasSelection: false });
    const next = makeHexTileLayerProps({ tileData, activeTileMap, cities, hasSelection: true });
    expect(areHexTileLayerEqual(base, next)).toBe(true);
  });

  it("returns false when HEX_SIZE changes", () => {
    const tileData: HexTileLayerEqualProps["tileData"] = [];
    const activeTileMap = new Map<string, HexTile>();
    const cities = new Set<string>();
    const base = makeHexTileLayerProps({ tileData, activeTileMap, cities, HEX_SIZE: 30 });
    const next = makeHexTileLayerProps({ tileData, activeTileMap, cities, HEX_SIZE: 40 });
    expect(areHexTileLayerEqual(base, next)).toBe(false);
  });
});

// ─── areBorderEdgeLayerEqual ─────────────────────────────────────────────────

function makeBorderEdgeLayerProps(
  overrides: Partial<BorderEdgeLayerEqualProps> = {},
): BorderEdgeLayerEqualProps {
  return {
    outerEdges: [],
    innerEdges: [],
    showInnerEdges: false,
    hasSelection: false,
    selectionEdges: [],
    buildingSelectionEdges: [],
    ...overrides,
  };
}

describe("areBorderEdgeLayerEqual", () => {
  it("returns true when all props are identical references", () => {
    const props = makeBorderEdgeLayerProps();
    expect(areBorderEdgeLayerEqual(props, props)).toBe(true);
  });

  it("returns true when all refs and scalars are the same", () => {
    const outerEdges: BorderEdge[] = [];
    const innerEdges: BorderEdge[] = [];
    const selectionEdges: BorderEdge[] = [];
    const buildingSelectionEdges: BorderEdge[] = [];
    const a = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, buildingSelectionEdges, hasSelection: true });
    const b = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, buildingSelectionEdges, hasSelection: true });
    expect(areBorderEdgeLayerEqual(a, b)).toBe(true);
  });

  it("returns false when outerEdges reference changes", () => {
    const base = makeBorderEdgeLayerProps();
    const next = makeBorderEdgeLayerProps({
      innerEdges: base.innerEdges,
      selectionEdges: base.selectionEdges,
      outerEdges: [],
    });
    expect(areBorderEdgeLayerEqual(base, next)).toBe(false);
  });

  it("returns false when innerEdges reference changes", () => {
    const base = makeBorderEdgeLayerProps();
    const next = makeBorderEdgeLayerProps({
      outerEdges: base.outerEdges,
      selectionEdges: base.selectionEdges,
      innerEdges: [],
    });
    expect(areBorderEdgeLayerEqual(base, next)).toBe(false);
  });

  it("returns false when selectionEdges reference changes", () => {
    const base = makeBorderEdgeLayerProps();
    const next = makeBorderEdgeLayerProps({
      outerEdges: base.outerEdges,
      innerEdges: base.innerEdges,
      selectionEdges: [],
    });
    expect(areBorderEdgeLayerEqual(base, next)).toBe(false);
  });

  it("returns false when buildingSelectionEdges reference changes", () => {
    const base = makeBorderEdgeLayerProps();
    const next = makeBorderEdgeLayerProps({
      outerEdges: base.outerEdges,
      innerEdges: base.innerEdges,
      selectionEdges: base.selectionEdges,
      buildingSelectionEdges: [],
    });
    expect(areBorderEdgeLayerEqual(base, next)).toBe(false);
  });

  it("returns false when hasSelection flips", () => {
    const outerEdges: BorderEdge[] = [];
    const innerEdges: BorderEdge[] = [];
    const selectionEdges: BorderEdge[] = [];
    const base = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, hasSelection: false });
    const next = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, hasSelection: true });
    expect(areBorderEdgeLayerEqual(base, next)).toBe(false);
  });

  it("returns false when showInnerEdges flips", () => {
    const outerEdges: BorderEdge[] = [];
    const innerEdges: BorderEdge[] = [];
    const selectionEdges: BorderEdge[] = [];
    const base = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, showInnerEdges: false });
    const next = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, showInnerEdges: true });
    expect(areBorderEdgeLayerEqual(base, next)).toBe(false);
  });
});

// ─── areCityOverlayLayerEqual ────────────────────────────────────────────────

function makeCityOverlayLayerProps(
  overrides: Partial<CityOverlayLayerEqualProps> = {},
): CityOverlayLayerEqualProps {
  return {
    cities: new Set<string>(),
    activeTileMap: new Map<string, HexTile>(),
    tileDataMap: new Map<string, { cx: number; cy: number }>(),
    HEX_SIZE: 30,
    ...overrides,
  };
}

describe("areCityOverlayLayerEqual", () => {
  it("returns true when all props are identical references", () => {
    const props = makeCityOverlayLayerProps();
    expect(areCityOverlayLayerEqual(props, props)).toBe(true);
  });

  it("returns true when all refs and scalars are the same", () => {
    const cities = new Set<string>();
    const activeTileMap = new Map<string, HexTile>();
    const tileDataMap = new Map<string, { cx: number; cy: number }>();
    const a = makeCityOverlayLayerProps({ cities, activeTileMap, tileDataMap, HEX_SIZE: 32 });
    const b = makeCityOverlayLayerProps({ cities, activeTileMap, tileDataMap, HEX_SIZE: 32 });
    expect(areCityOverlayLayerEqual(a, b)).toBe(true);
  });

  it("returns false when cities reference changes", () => {
    const base = makeCityOverlayLayerProps();
    const next = makeCityOverlayLayerProps({
      activeTileMap: base.activeTileMap,
      tileDataMap: base.tileDataMap,
      cities: new Set(),
    });
    expect(areCityOverlayLayerEqual(base, next)).toBe(false);
  });

  it("returns false when activeTileMap reference changes", () => {
    const base = makeCityOverlayLayerProps();
    const next = makeCityOverlayLayerProps({
      cities: base.cities,
      tileDataMap: base.tileDataMap,
      activeTileMap: new Map(),
    });
    expect(areCityOverlayLayerEqual(base, next)).toBe(false);
  });

  it("returns false when tileDataMap reference changes", () => {
    const base = makeCityOverlayLayerProps();
    const next = makeCityOverlayLayerProps({
      cities: base.cities,
      activeTileMap: base.activeTileMap,
      tileDataMap: new Map(),
    });
    expect(areCityOverlayLayerEqual(base, next)).toBe(false);
  });

  it("returns false when HEX_SIZE changes", () => {
    const cities = new Set<string>();
    const activeTileMap = new Map<string, HexTile>();
    const tileDataMap = new Map<string, { cx: number; cy: number }>();
    const base = makeCityOverlayLayerProps({ cities, activeTileMap, tileDataMap, HEX_SIZE: 30 });
    const next = makeCityOverlayLayerProps({ cities, activeTileMap, tileDataMap, HEX_SIZE: 40 });
    expect(areCityOverlayLayerEqual(base, next)).toBe(false);
  });
});

// ─── areMovementHighlightLayerEqual ──────────────────────────────────────────

function makeMovementHighlightLayerProps(
  overrides: Partial<MovementHighlightLayerEqualProps> = {},
): MovementHighlightLayerEqualProps {
  return {
    validMoveTiles: new Set<string>(),
    validBridgePlacementTiles: new Set<string>(),
    validImprovementTiles: new Set<string>(),
    validPlacementAttackTiles: new Set<string>(),
    validRangedTargets: new Set<string>(),
    validCitySites: new Set<string>(),
    selectedTileKeys: new Set<string>(),
    armedEntityId: null,
    armedImprovement: null,
    entities: new Map<string, EntityType>(),
    activeTileMap: new Map<string, HexTile>(),
    graveyard: new Set<string>(),
    fortificationDots: new Set<string>(),
    tileDataMap: new Map<string, { cx: number; cy: number }>(),
    boardW: 300,
    boardH: 400,
    HEX_SIZE: 30,
    ...overrides,
  };
}

describe("areMovementHighlightLayerEqual", () => {
  it("returns true when all props are identical references", () => {
    const props = makeMovementHighlightLayerProps();
    expect(areMovementHighlightLayerEqual(props, props)).toBe(true);
  });

  it("returns true when every ref and scalar is shared", () => {
    const shared = makeMovementHighlightLayerProps();
    const next = makeMovementHighlightLayerProps({ ...shared });
    expect(areMovementHighlightLayerEqual(shared, next)).toBe(true);
  });

  it("returns false when validRangedTargets reference changes", () => {
    const base = makeMovementHighlightLayerProps();
    const next = makeMovementHighlightLayerProps({
      ...base,
      validRangedTargets: new Set<string>(),
    });
    expect(areMovementHighlightLayerEqual(base, next)).toBe(false);
  });

  it("returns false when validRangedTargets gains a target", () => {
    const base = makeMovementHighlightLayerProps();
    const next = makeMovementHighlightLayerProps({
      ...base,
      validRangedTargets: new Set(["1,2"]),
    });
    expect(areMovementHighlightLayerEqual(base, next)).toBe(false);
  });

  it("returns true when only validRangedTargets is the same non-empty ref", () => {
    const validRangedTargets = new Set(["1,2", "3,4"]);
    const base = makeMovementHighlightLayerProps({ validRangedTargets });
    const next = makeMovementHighlightLayerProps({ ...base });
    expect(areMovementHighlightLayerEqual(base, next)).toBe(true);
  });

  it("returns false when validMoveTiles reference changes", () => {
    const base = makeMovementHighlightLayerProps();
    const next = makeMovementHighlightLayerProps({
      ...base,
      validMoveTiles: new Set<string>(),
    });
    expect(areMovementHighlightLayerEqual(base, next)).toBe(false);
  });

  it("returns false when HEX_SIZE changes", () => {
    const base = makeMovementHighlightLayerProps();
    const next = makeMovementHighlightLayerProps({ ...base, HEX_SIZE: 40 });
    expect(areMovementHighlightLayerEqual(base, next)).toBe(false);
  });
});

// ─── areMovementHighlightTapTargetsEqual ─────────────────────────────────────

function makeMovementHighlightTapTargetsProps(
  overrides: Partial<MovementHighlightTapTargetsEqualProps> = {},
): MovementHighlightTapTargetsEqualProps {
  return {
    validMoveTiles: new Set<string>(),
    validBridgePlacementTiles: new Set<string>(),
    validPlacementAttackTiles: new Set<string>(),
    validRangedTargets: new Set<string>(),
    armedEntityId: null,
    tileDataMap: new Map<string, { cx: number; cy: number }>(),
    HEX_SIZE: 30,
    ...overrides,
  };
}

describe("areMovementHighlightTapTargetsEqual", () => {
  it("returns true when all props are identical references", () => {
    const props = makeMovementHighlightTapTargetsProps();
    expect(areMovementHighlightTapTargetsEqual(props, props)).toBe(true);
  });

  it("returns true when every ref and scalar is shared", () => {
    const shared = makeMovementHighlightTapTargetsProps();
    const next = makeMovementHighlightTapTargetsProps({ ...shared });
    expect(areMovementHighlightTapTargetsEqual(shared, next)).toBe(true);
  });

  it("returns false when validRangedTargets reference changes", () => {
    const base = makeMovementHighlightTapTargetsProps();
    const next = makeMovementHighlightTapTargetsProps({
      ...base,
      validRangedTargets: new Set(["0,0"]),
    });
    expect(areMovementHighlightTapTargetsEqual(base, next)).toBe(false);
  });

  it("returns true when only validRangedTargets is the same non-empty ref", () => {
    const validRangedTargets = new Set(["0,0"]);
    const base = makeMovementHighlightTapTargetsProps({ validRangedTargets });
    const next = makeMovementHighlightTapTargetsProps({ ...base });
    expect(areMovementHighlightTapTargetsEqual(base, next)).toBe(true);
  });

  it("returns false when armedEntityId changes", () => {
    const base = makeMovementHighlightTapTargetsProps();
    const next = makeMovementHighlightTapTargetsProps({
      ...base,
      armedEntityId: "tower",
    });
    expect(areMovementHighlightTapTargetsEqual(base, next)).toBe(false);
  });
});

// ─── areGraveyardLayerEqual ──────────────────────────────────────────────────

function makeGraveyardLayerProps(
  overrides: Partial<GraveyardLayerEqualProps> = {},
): GraveyardLayerEqualProps {
  return {
    graveyard: new Set<string>(),
    ruins: new Set<string>(),
    killMarks: new Set<string>(),
    entities: new Map<string, EntityType>(),
    tileDataMap: new Map<string, { cx: number; cy: number }>(),
    HEX_SIZE: 30,
    ...overrides,
  };
}

describe("areGraveyardLayerEqual", () => {
  it("returns true when all props are identical references", () => {
    const props = makeGraveyardLayerProps();
    expect(areGraveyardLayerEqual(props, props)).toBe(true);
  });

  it("returns true when every ref and scalar is shared", () => {
    const shared = makeGraveyardLayerProps();
    const next = makeGraveyardLayerProps({ ...shared });
    expect(areGraveyardLayerEqual(shared, next)).toBe(true);
  });

  it("returns false when killMarks reference changes", () => {
    const base = makeGraveyardLayerProps();
    const next = makeGraveyardLayerProps({
      ...base,
      killMarks: new Set<string>(),
    });
    expect(areGraveyardLayerEqual(base, next)).toBe(false);
  });

  it("returns false when killMarks gains a mark", () => {
    const base = makeGraveyardLayerProps();
    const next = makeGraveyardLayerProps({
      ...base,
      killMarks: new Set(["2,3"]),
    });
    expect(areGraveyardLayerEqual(base, next)).toBe(false);
  });

  it("returns true when only killMarks is the same non-empty ref", () => {
    const killMarks = new Set(["2,3"]);
    const base = makeGraveyardLayerProps({ killMarks });
    const next = makeGraveyardLayerProps({ ...base });
    expect(areGraveyardLayerEqual(base, next)).toBe(true);
  });

  it("returns false when graveyard reference changes", () => {
    const base = makeGraveyardLayerProps();
    const next = makeGraveyardLayerProps({
      ...base,
      graveyard: new Set<string>(),
    });
    expect(areGraveyardLayerEqual(base, next)).toBe(false);
  });

  it("returns false when ruins reference changes", () => {
    const base = makeGraveyardLayerProps();
    const next = makeGraveyardLayerProps({ ...base, ruins: new Set<string>() });
    expect(areGraveyardLayerEqual(base, next)).toBe(false);
  });
});
