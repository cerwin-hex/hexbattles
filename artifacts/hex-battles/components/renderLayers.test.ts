import { describe, it, expect } from "vitest";
import {
  areHexTileLayerEqual,
  areBorderEdgeLayerEqual,
  areCityOverlayLayerEqual,
  type HexTileLayerEqualProps,
  type BorderEdgeLayerEqualProps,
  type CityOverlayLayerEqualProps,
} from "@/components/layerEquality";
import type { HexTile, BorderEdge } from "@/types";

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
    hasSelection: false,
    selectionEdges: [],
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
    const a = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, hasSelection: true });
    const b = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, hasSelection: true });
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

  it("returns false when hasSelection flips", () => {
    const outerEdges: BorderEdge[] = [];
    const innerEdges: BorderEdge[] = [];
    const selectionEdges: BorderEdge[] = [];
    const base = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, hasSelection: false });
    const next = makeBorderEdgeLayerProps({ outerEdges, innerEdges, selectionEdges, hasSelection: true });
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
