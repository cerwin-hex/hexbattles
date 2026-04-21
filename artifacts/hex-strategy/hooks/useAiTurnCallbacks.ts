import type { MutableRefObject } from "react";
import type { AiTurnCallbacks } from "@/logic/aiStrategy";
import type {
  EntityType,
  HexTile,
  TerritoryOwner,
  AiStepSnapshot,
  AiState,
} from "@/types";

export interface AiTurnCallbacksParams {
  setEntities: (v: Map<string, EntityType>) => void;
  setMutableTileMap: (v: Map<string, HexTile>) => void;
  setTerritoryBalances: (v: Map<string, number>) => void;
  setGraveyard: (v: Set<string>) => void;
  setRuins: (v: Set<string>) => void;
  setLiveOwnerMap: (v: Map<string, TerritoryOwner>) => void;
  setCities: (v: Set<string>) => void;
  setFreeTowerUsedTiles: (v: Map<TerritoryOwner, Set<string>>) => void;
  setAiStateMap: (v: Map<string, AiState>) => void;
  setIsAiTurn: (v: boolean) => void;
  setIsAiPaused: (v: boolean) => void;

  setIsAiTurnDone: (v: boolean) => void;
  setAiHistoryIndex: (v: number) => void;
  setAiHistoryLen: (v: number) => void;
  aiStateMapRef: MutableRefObject<Map<string, AiState>>;
  aiTurnRef: MutableRefObject<boolean>;
  isDeveloperModeRef: MutableRefObject<boolean>;
  resumeAiRef: MutableRefObject<(() => void) | null>;
  resumeAfterAiRef: MutableRefObject<(() => void) | null>;
  aiStepHistoryRef: MutableRefObject<AiStepSnapshot[]>;
  awaitStep: AiTurnCallbacks["awaitStep"];
  triggerUnitAnimation: AiTurnCallbacks["triggerUnitAnimation"];
  recalculateTerritoriesForCapture: AiTurnCallbacks["recalculateTerritoriesForCapture"];
  applySingleHexPenalty: AiTurnCallbacks["applySingleHexPenalty"];
  checkWinLoss: AiTurnCallbacks["checkWinLoss"];
}

export function makeAiTurnCallbacks(p: AiTurnCallbacksParams): AiTurnCallbacks {
  return {
    state: {
      setEntities: p.setEntities,
      setMutableTileMap: p.setMutableTileMap,
      setTerritoryBalances: p.setTerritoryBalances,
      setGraveyard: p.setGraveyard,
      setRuins: p.setRuins,
      setLiveOwnerMap: p.setLiveOwnerMap,
      setCities: p.setCities,
      setFreeTowerUsedTiles: p.setFreeTowerUsedTiles,
      setAiStateMap: p.setAiStateMap,
      setIsAiTurn: p.setIsAiTurn,
    },
    refs: {
      getAiStateMap: () => p.aiStateMapRef.current,
      setAiStateMap: (v) => {
        p.aiStateMapRef.current = v;
      },
      isTurnActive: () => p.aiTurnRef.current,
      isDeveloperMode: () => p.isDeveloperModeRef.current,
      setAiTurn: (v) => {
        p.aiTurnRef.current = v;
      },
    },
    initStepHistory: (snap: AiStepSnapshot) => {
      p.aiStepHistoryRef.current = [snap];
      p.setAiHistoryIndex(0);
      p.setAiHistoryLen(1);
    },
    awaitStep: p.awaitStep,
    awaitPreAiResume: async () => {
      if (p.isDeveloperModeRef.current) {
        p.setIsAiPaused(true);
        await new Promise<void>((resolve) => {
          p.resumeAiRef.current = resolve;
        });
        p.resumeAiRef.current = null;
        p.setIsAiPaused(false);
      }
    },
    awaitPostAiResume: async () => {
      if (p.isDeveloperModeRef.current) {
        p.setIsAiTurnDone(true);
        await new Promise<void>((resolve) => {
          p.resumeAfterAiRef.current = resolve;
        });
        p.resumeAfterAiRef.current = null;
        p.setIsAiTurnDone(false);
      }
    },
    triggerUnitAnimation: p.triggerUnitAnimation,
    recalculateTerritoriesForCapture: p.recalculateTerritoriesForCapture,
    applySingleHexPenalty: p.applySingleHexPenalty,
    checkWinLoss: p.checkWinLoss,
  };
}
