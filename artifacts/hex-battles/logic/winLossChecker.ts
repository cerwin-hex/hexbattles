import type { HexTile, TerritoryOwner, GameResult } from "@/types";

export interface WinLossResult {
  result: NonNullable<GameResult>;
  showDominance?: false;
}

export interface DominanceResult {
  result: null;
  showDominance: true;
}

export type WinLossOutcome = WinLossResult | DominanceResult | null;

export function checkWinLossLogic(
  currentTileMap: Map<string, HexTile>,
  aiOwners: TerritoryOwner[],
  dominanceShownRef: { current: boolean },
): WinLossOutcome {
  const playerTiles = Array.from(currentTileMap.values()).filter(
    (t) => t.owner === "player",
  );
  if (playerTiles.length === 0) {
    return { result: "defeat" };
  }
  const allAiEliminated = aiOwners.every(
    (ai) =>
      !Array.from(currentTileMap.values()).some(
        (t) => t.owner === ai && t.terrain !== "lake",
      ),
  );
  if (allAiEliminated) {
    return { result: "victory" };
  }
  if (!dominanceShownRef.current) {
    const playableTiles = Array.from(currentTileMap.values()).filter(
      (t) => t.terrain !== "mountain" && t.terrain !== "lake",
    );
    const playerPlayable = playableTiles.filter(
      (t) => t.owner === "player",
    ).length;
    if (
      playableTiles.length > 0 &&
      playerPlayable / playableTiles.length >= 0.7
    ) {
      dominanceShownRef.current = true;
      return { result: null, showDominance: true };
    }
  }
  return null;
}
