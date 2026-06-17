import type { HexTile, TerritoryOwner, EntityType, AiStepSnapshot, TerrainType } from "@/types";
import { hexDistance, tileKey, HEX_EDGES } from "@/utils/hexMath";
import {
  getContiguousTerritory,
  getTerritoryId,
  getValidMoves,
  getMaxEnemyZoC,
  getMoveCost,
  ENTITY_META,
  UNIT_UPGRADE,
  TERRAIN_INCOME,
  CITY_BONUS,
  recalculateTerritoriesForCapture,
  TerritoryCache,
  unitMovement,
  unitMaxAttacks,
  isCavalry,
  cavalryMoveKind,
  improveCostFor,
  IMPROVED_TERRAINS,
} from "@/utils/hexGrid";
import { advanceAttacksUsed, advanceCombatSpent, calcTerritoryIncome, calcTerritoryUpkeep, effectiveRemaining, isChargeAttack, mergeResult, resolveMovedUnitMoves } from "@/logic/gameLogic";
import {
  dtSplitScore,
  dtCaptureNegatesIncome,
  dtCaptureCreatesOneHex,
  dtSpacedPlacements,
  dtFindMergeMove,
  dtFindImproveMove,
} from "@/logic/aiHelpers";
import type { AiContext } from "@/logic/aiHelpers";
import { runExpertTerritoryDecisionLoop } from "@/logic/aiExpert";
import type { AiState, Difficulty } from "@/types";

// Unit purchase candidates for the AI, derived from ENTITY_META so new units are
// picked up automatically. The buy loops take the first affordable type meeting
// the strength threshold. Within a strength tier, cavalry (more attacks) is
// preferred over plain infantry, so the AI buys a Scout/Knight when it can afford
// one and falls back to cheaper infantry otherwise.
const aiUnitBuyOrder = (strengthDir: 1 | -1): EntityType[] =>
  (Object.keys(ENTITY_META) as EntityType[])
    .filter((e) => ENTITY_META[e].isUnit)
    .sort(
      (a, b) =>
        strengthDir * (ENTITY_META[a].strength - ENTITY_META[b].strength) ||
        unitMaxAttacks(b) - unitMaxAttacks(a) || // cavalry first within a tier
        ENTITY_META[a].cost - ENTITY_META[b].cost,
    );
const AI_UNIT_BUY_ORDER_ASC: EntityType[] = aiUnitBuyOrder(1);
const AI_UNIT_BUY_ORDER_DESC: EntityType[] = aiUnitBuyOrder(-1);

export interface AiDecisionExec {
  move(from: string, to: string): Promise<boolean>;
  buy(type: EntityType, target: string, cost: number, outside: boolean): Promise<boolean>;
  upgrade(target: string, to: EntityType, cost: number): Promise<boolean>;
  build(type: EntityType, target: string, cost: number): Promise<boolean>;
  remove(target: string): Promise<boolean>;
  improve(target: string, terrain: TerrainType, cost: number): Promise<boolean>;
  markSpent(key: string): void;
  setTerritoryState(tid: string, state: AiState): void;
}

export async function runAiTerritoryDecisionLoop(
  startTileKey: string,
  aiCtx: AiContext,
  exec: AiDecisionExec,
  isTurnActive: () => boolean,
  difficulty: Difficulty,
): Promise<void> {
  const aiOwner = aiCtx.aiOwner;

  const getCT = (key: string, owner: TerritoryOwner): HexTile[] =>
    aiCtx.territoryCache
      ? aiCtx.territoryCache.get(aiCtx.tileMap, key, owner, aiCtx.entities)
      : getContiguousTerritory(aiCtx.tileMap, key, owner, aiCtx.entities);

  let dtIter = 0;
  while (dtIter++ < 100) {
    if (!isTurnActive()) return;

    const currTerr = getCT(startTileKey, aiOwner);
    if (currTerr.length === 0) break;
    const currTerrKeys = new Set(currTerr.map((t) => t.key));
    const currTid = getTerritoryId(currTerr);
    if (!currTid) break;
    const currBal = aiCtx.balances.get(currTid) ?? 0;

    const currIncome = calcTerritoryIncome(currTerr, aiCtx.entities, aiCtx.cities, aiCtx.tileMap);
    const currUpkeep = calcTerritoryUpkeep(currTerr, aiCtx.entities);

    const canAfford = (cost: number, extraUpkeep: number = 0): boolean =>
      currBal >= cost && currBal + (currIncome - (currUpkeep + extraUpkeep)) >= 0;

    const currMaxStr = currTerr.reduce((best, t) => {
      const e = aiCtx.entities.get(t.key);
      return e && ENTITY_META[e].isUnit ? Math.max(best, ENTITY_META[e].strength) : best;
    }, 0);

    const currBorderTiles = currTerr.filter((t) => {
      const [tq, tr] = t.key.split(",").map(Number);
      return HEX_EDGES.some(({ dir: [dq, dr] }) => {
        const nk = tileKey(tq + dq, tr + dr);
        const nb = aiCtx.tileMap.get(nk);
        return !!nb && nb.owner !== aiOwner;
      });
    });

    const adjacentEnemyTileKeys = new Set<string>();
    {
      const visitedAdj = new Set<string>();
      for (const bt of currBorderTiles) {
        const [bq, br] = bt.key.split(",").map(Number);
        for (const { dir: [dq, dr] } of HEX_EDGES) {
          const nk = tileKey(bq + dq, br + dr);
          const nt = aiCtx.tileMap.get(nk);
          if (!nt || nt.owner === aiOwner || nt.owner === "neutral" || visitedAdj.has(nk)) continue;
          visitedAdj.add(nk);
          const adjTerr = getCT(nk, nt.owner as TerritoryOwner);
          for (const t of adjTerr) adjacentEnemyTileKeys.add(t.key);
        }
      }
    }

    let strongerEnemy: { key: string; entity: EntityType; strength: number; owner: TerritoryOwner } | null = null;
    for (const bt of currBorderTiles) {
      const [bq, br] = bt.key.split(",").map(Number);
      for (const [ek, ee] of aiCtx.entities) {
        if (!ENTITY_META[ee].isUnit) continue;
        const et = aiCtx.tileMap.get(ek);
        if (!et || et.owner === aiOwner || et.owner === "neutral") continue;
        if (!adjacentEnemyTileKeys.has(ek)) continue;
        const [eq, er] = ek.split(",").map(Number);
        if (hexDistance(bq, br, eq, er) <= 3 && ENTITY_META[ee].strength > currMaxStr) {
          if (!strongerEnemy || ENTITY_META[ee].strength > strongerEnemy.strength) {
            strongerEnemy = { key: ek, entity: ee, strength: ENTITY_META[ee].strength, owner: et.owner as TerritoryOwner };
          }
        }
      }
    }

    const currAiState: AiState = strongerEnemy ? "defending" : "attacking";
    exec.setTerritoryState(currTid, currAiState);

    const availUnits = Array.from(aiCtx.entities.entries()).filter(([k, e]) => {
      const t = aiCtx.tileMap.get(k);
      return t?.owner === aiOwner && ENTITY_META[e].isUnit && !aiCtx.spentUnits.has(k) && currTerrKeys.has(k);
    });

    const skipChance = difficulty === "easy" ? 0.4 : difficulty === "medium" ? 0.2 : 0;
    if (skipChance > 0 && Math.random() < skipChance) continue;

    let actionTaken = false;

    // ══ PRIORITY 1 (DEFENDING): Attack to split stronger enemy's territory ══
    if (!actionTaken && currAiState === "defending" && strongerEnemy) {
      const eOwner = strongerEnemy.owner;
      type SplitCand = { fk: string; tk: string; score: number; neg: boolean; oneHex: boolean };
      const cands: SplitCand[] = [];
      for (const [uk, ue] of availUnits) {
        const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? unitMovement(aiCtx.entities.get(uk)!), aiCtx.combatSpentUnits);
        for (const mk of vm) {
          const mt = aiCtx.tileMap.get(mk);
          if (!mt || mt.owner !== eOwner) continue;
          const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
          if (ENTITY_META[ue].strength <= zoc) continue;
          if (mt.terrain === "lake") continue;
          const score = dtSplitScore(mk, eOwner, aiCtx);
          const neg = dtCaptureNegatesIncome(mk, eOwner, aiCtx);
          const oneHex = dtCaptureCreatesOneHex(mk, eOwner, aiCtx);
          cands.push({ fk: uk, tk: mk, score, neg, oneHex });
        }
      }
      if (cands.length > 0) {
        cands.sort((a, b) => {
          if (a.oneHex !== b.oneHex) return a.oneHex ? -1 : 1;
          if (a.neg !== b.neg) return a.neg ? -1 : 1;
          return b.score - a.score;
        });
        if (cands[0].score > 0 || cands[0].neg || cands[0].oneHex) {
          actionTaken = await exec.move(cands[0].fk, cands[0].tk);
        }
      }
      if (!actionTaken) {
        const splitTargets = new Set(
          Array.from(aiCtx.tileMap.values())
            .filter((t) => {
              if (t.owner !== eOwner || t.terrain === "mountain" || t.terrain === "lake") return false;
              return dtSplitScore(t.key, eOwner, aiCtx) > 0 || dtCaptureNegatesIncome(t.key, eOwner, aiCtx) || dtCaptureCreatesOneHex(t.key, eOwner, aiCtx);
            })
            .map((t) => t.key),
        );
        const merge = dtFindMergeMove(strongerEnemy.strength, splitTargets, availUnits, aiCtx);
        if (merge) actionTaken = await exec.move(merge.from, merge.to);
      }
      if (!actionTaken) {
        let bestAttack: { fk: string; tk: string; sz: number } | null = null;
        for (const [uk, ue] of availUnits) {
          const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? unitMovement(aiCtx.entities.get(uk)!), aiCtx.combatSpentUnits);
          for (const mk of vm) {
            const mt = aiCtx.tileMap.get(mk);
            if (!mt || mt.owner !== eOwner) continue;
            const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
            if (ENTITY_META[ue].strength <= zoc) continue;
            if (mt.terrain === "lake") continue;
            const simMap = new Map(aiCtx.tileMap);
            simMap.set(mk, { ...mt, owner: aiOwner });
            let totalSz = 0;
            const vis2 = new Set<string>();
            for (const t of Array.from(simMap.values())) {
              if (t.owner !== eOwner || vis2.has(t.key)) continue;
              const comp = getContiguousTerritory(simMap, t.key, eOwner, aiCtx.entities);
              const hasE = comp.some((ct) => {
                const ce = aiCtx.entities.get(ct.key);
                return ce && ENTITY_META[ce].strength > 0;
              });
              if (hasE) totalSz += comp.length;
              for (const ct of comp) vis2.add(ct.key);
            }
            if (!bestAttack || totalSz < bestAttack.sz) bestAttack = { fk: uk, tk: mk, sz: totalSz };
          }
        }
        if (bestAttack) actionTaken = await exec.move(bestAttack.fk, bestAttack.tk);
      }
    }

    // ══ PRIORITY 2 (DEFENDING): Defend against the stronger enemy unit ══
    if (!actionTaken && currAiState === "defending" && strongerEnemy) {
      const eStr = strongerEnemy.strength;
      const [seqE, serE] = strongerEnemy.key.split(",").map(Number);

      for (const t of currTerr) {
        if (actionTaken) break;
        const e = aiCtx.entities.get(t.key);
        if (!e || ENTITY_META[e].isUnit) continue;
        const up = UNIT_UPGRADE[e];
        if (!up || ENTITY_META[up].strength < eStr) continue;
        const upgCost = ENTITY_META[up].cost - ENTITY_META[e].cost;
        const dUpk = ENTITY_META[up].upkeep - ENTITY_META[e].upkeep;
        if (canAfford(upgCost, dUpk)) actionTaken = await exec.upgrade(t.key, up, upgCost);
      }

      if (!actionTaken) {
        for (const [uk, ue] of availUnits) {
          if (actionTaken) break;
          const [uq, ur] = uk.split(",").map(Number);
          if (hexDistance(uq, ur, seqE, serE) > 5) continue;
          const up = UNIT_UPGRADE[ue];
          if (!up || ENTITY_META[up].strength < eStr) continue;
          const upgCost = ENTITY_META[up].cost - ENTITY_META[ue].cost;
          const dUpk = ENTITY_META[up].upkeep - ENTITY_META[ue].upkeep;
          if (canAfford(upgCost, dUpk)) actionTaken = await exec.upgrade(uk, up, upgCost);
        }
      }

      if (!actionTaken) {
        for (const uType of AI_UNIT_BUY_ORDER_ASC) {
          if (actionTaken) break;
          if (ENTITY_META[uType].strength < eStr) continue;
          const uCost = ENTITY_META[uType].cost;
          const uUpk = ENTITY_META[uType].upkeep;
          if (!canAfford(uCost, uUpk)) continue;
          const borderPlacements = currBorderTiles
            .filter((t) => {
              if (t.terrain === "mountain" || t.terrain === "lake") return false;
              if (aiCtx.entities.has(t.key)) return false;
              const [tq, tr] = t.key.split(",").map(Number);
              return hexDistance(tq, tr, seqE, serE) <= 5;
            })
            .sort((a, b) => {
              const [aq2, ar2] = a.key.split(",").map(Number);
              const [bq2, br2] = b.key.split(",").map(Number);
              return hexDistance(aq2, ar2, seqE, serE) - hexDistance(bq2, br2, seqE, serE);
            });
          if (borderPlacements.length > 0) {
            actionTaken = await exec.buy(uType, borderPlacements[0].key, uCost, false);
          }
        }
      }

      if (!actionTaken) {
        for (const bType of (["castle", "tower"] as EntityType[])) {
          if (actionTaken) break;
          if (ENTITY_META[bType].strength < eStr) continue;
          const bCost = ENTITY_META[bType].cost;
          const bUpk = ENTITY_META[bType].upkeep;
          if (!canAfford(bCost, bUpk)) continue;
          if (bType === "castle" && !currTerr.some((t) => {
            const e = aiCtx.entities.get(t.key);
            return !!e && ENTITY_META[e].isUnit && ENTITY_META[e].strength >= 2;
          })) continue;
          const rawPlacements = currTerr.filter((t) => {
            if (t.terrain === "mountain" || t.terrain === "lake") return false;
            if (aiCtx.entities.has(t.key) || aiCtx.cities.has(t.key)) return false;
            const [tq, tr] = t.key.split(",").map(Number);
            return hexDistance(tq, tr, seqE, serE) <= 5;
          }).sort((a, b) => {
            const [aq2, ar2] = a.key.split(",").map(Number);
            const [bq2, br2] = b.key.split(",").map(Number);
            return hexDistance(aq2, ar2, seqE, serE) - hexDistance(bq2, br2, seqE, serE);
          });
          const placements = dtSpacedPlacements(rawPlacements, aiCtx);
          if (placements.length > 0) actionTaken = await exec.build(bType, placements[0].key, bCost);
        }
      }

      if (!actionTaken) {
        for (const bType of (["tower", "castle"] as EntityType[])) {
          if (actionTaken) break;
          if (ENTITY_META[bType].strength < eStr - 1) continue;
          const bCost = ENTITY_META[bType].cost;
          const bUpk = ENTITY_META[bType].upkeep;
          if (!canAfford(bCost, bUpk)) continue;
          if (bType === "castle" && !currTerr.some((t) => {
            const e = aiCtx.entities.get(t.key);
            return !!e && ENTITY_META[e].isUnit && ENTITY_META[e].strength >= 2;
          })) continue;
          const rawPlacements = currTerr.filter((t) => {
            if (t.terrain === "mountain" || t.terrain === "lake") return false;
            if (aiCtx.entities.has(t.key) || aiCtx.cities.has(t.key)) return false;
            const [tq, tr] = t.key.split(",").map(Number);
            return HEX_EDGES.some(({ dir: [dq, dr] }) => {
              const nk = tileKey(tq + dq, tr + dr);
              const nb = aiCtx.tileMap.get(nk);
              return nb && nb.owner !== aiOwner && nb.owner !== "neutral";
            });
          });
          const placements = dtSpacedPlacements(rawPlacements, aiCtx);
          if (placements.length > 0) actionTaken = await exec.build(bType, placements[0].key, bCost);
        }
      }
    }

    // ══ PRIORITY A: Attack to split any enemy territory into 2 parts ══
    if (!actionTaken) {
      type SplitCandA = { fk: string; tk: string; score: number; neg: boolean; oneHex: boolean };
      const candsA: SplitCandA[] = [];
      for (const [uk, ue] of availUnits) {
        const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? unitMovement(aiCtx.entities.get(uk)!), aiCtx.combatSpentUnits);
        for (const mk of vm) {
          const mt = aiCtx.tileMap.get(mk);
          if (!mt || mt.owner === aiOwner || mt.owner === "neutral") continue;
          const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
          if (ENTITY_META[ue].strength <= zoc) continue;
          if (mt.terrain === "lake") continue;
          const eOwnerA = mt.owner as TerritoryOwner;
          const score = dtSplitScore(mk, eOwnerA, aiCtx);
          const neg = dtCaptureNegatesIncome(mk, eOwnerA, aiCtx);
          const oneHex = dtCaptureCreatesOneHex(mk, eOwnerA, aiCtx);
          if (score > 0 || neg || oneHex) {
            candsA.push({ fk: uk, tk: mk, score, neg, oneHex });
          }
        }
      }
      if (candsA.length > 0) {
        candsA.sort((a, b) => {
          if (a.oneHex !== b.oneHex) return a.oneHex ? -1 : 1;
          if (a.neg !== b.neg) return a.neg ? -1 : 1;
          return b.score - a.score;
        });
        actionTaken = await exec.move(candsA[0].fk, candsA[0].tk);
      }
      if (!actionTaken) {
        const allSplitTargets = new Set(
          Array.from(aiCtx.tileMap.values())
            .filter((t) => {
              if (t.owner === aiOwner || t.owner === "neutral" || t.terrain === "mountain" || t.terrain === "lake") return false;
              const eOwnerT = t.owner as TerritoryOwner;
              return dtSplitScore(t.key, eOwnerT, aiCtx) > 0 || dtCaptureNegatesIncome(t.key, eOwnerT, aiCtx) || dtCaptureCreatesOneHex(t.key, eOwnerT, aiCtx);
            })
            .map((t) => t.key),
        );
        const mergeA = dtFindMergeMove(1, allSplitTargets, availUnits, aiCtx);
        if (mergeA) actionTaken = await exec.move(mergeA.from, mergeA.to);
      }
    }

    // ══ PRIORITY B: Connect own territories via 1–2 tile bridge ══
    if (!actionTaken) {
      type BridgeInfo = { tile: string; sz: number };
      const bridges: BridgeInfo[] = [];
      for (const t of currTerr) {
        const [tq, tr] = t.key.split(",").map(Number);
        for (const { dir: [dq, dr] } of HEX_EDGES) {
          const mk = tileKey(tq + dq, tr + dr);
          if (currTerrKeys.has(mk)) continue;
          const mt = aiCtx.tileMap.get(mk);
          if (!mt || mt.terrain === "mountain" || mt.terrain === "lake") continue;
          if (mt.owner === aiOwner) continue;
          const [mq, mr] = mk.split(",").map(Number);
          const directBridge = HEX_EDGES.some(({ dir: [dq2, dr2] }) => {
            const nk2 = tileKey(mq + dq2, mr + dr2);
            const nt2 = aiCtx.tileMap.get(nk2);
            return nt2 && nt2.owner === aiOwner && !currTerrKeys.has(nk2);
          });
          if (directBridge && !bridges.find((b) => b.tile === mk)) {
            const otherKey = HEX_EDGES.map(({ dir: [dq2, dr2] }) => {
              const nk2 = tileKey(mq + dq2, mr + dr2);
              const nt2 = aiCtx.tileMap.get(nk2);
              return (nt2 && nt2.owner === aiOwner && !currTerrKeys.has(nk2)) ? nk2 : null;
            }).find((k) => k !== null);
            const sz = otherKey ? getCT(otherKey, aiOwner).length : 0;
            bridges.push({ tile: mk, sz });
            continue;
          }
          for (const { dir: [dq2, dr2] } of HEX_EDGES) {
            const mk2 = tileKey(mq + dq2, mr + dr2);
            if (currTerrKeys.has(mk2) || mk2 === mk) continue;
            const mt2 = aiCtx.tileMap.get(mk2);
            if (!mt2 || mt2.terrain === "mountain" || mt2.terrain === "lake" || mt2.owner === aiOwner) continue;
            const [mq2, mr2] = mk2.split(",").map(Number);
            const chainBridges = HEX_EDGES.some(({ dir: [dq3, dr3] }) => {
              const nk3 = tileKey(mq2 + dq3, mr2 + dr3);
              const nt3 = aiCtx.tileMap.get(nk3);
              return nt3 && nt3.owner === aiOwner && !currTerrKeys.has(nk3) && nk3 !== mk;
            });
            if (chainBridges && !bridges.find((b) => b.tile === mk)) {
              bridges.push({ tile: mk, sz: 0 });
            }
          }
        }
      }
      if (bridges.length > 0) {
        bridges.sort((a, b) => b.sz - a.sz);
        for (const bridge of bridges) {
          if (actionTaken) break;
          const bridgeTile = aiCtx.tileMap.get(bridge.tile);
          if (!bridgeTile) continue;
          const zoc = getMaxEnemyZoC(bridge.tile, aiOwner, aiCtx.entities, aiCtx.tileMap);
          for (const [uk, ue] of availUnits) {
            if (actionTaken) break;
            if (ENTITY_META[ue].strength <= zoc) continue;
            const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? unitMovement(aiCtx.entities.get(uk)!), aiCtx.combatSpentUnits);
            if (!vm.has(bridge.tile)) continue;
            actionTaken = await exec.move(uk, bridge.tile);
          }
          if (!actionTaken) {
            const mergeB = dtFindMergeMove(zoc + 1, new Set([bridge.tile]), availUnits, aiCtx);
            if (mergeB) actionTaken = await exec.move(mergeB.from, mergeB.to);
          }
          if (!actionTaken) {
            for (const uType of AI_UNIT_BUY_ORDER_ASC) {
              if (actionTaken) break;
              const str = ENTITY_META[uType].strength;
              const cost = ENTITY_META[uType].cost;
              const upk = ENTITY_META[uType].upkeep;
              if (str <= zoc || !canAfford(cost, upk)) continue;
              const adjacentToSpawn = currTerr.some((t) => {
                const [tq, tr] = t.key.split(",").map(Number);
                return HEX_EDGES.some(({ dir: [dq, dr] }) => tileKey(tq + dq, tr + dr) === bridge.tile);
              });
              if (adjacentToSpawn) actionTaken = await exec.buy(uType, bridge.tile, cost, true);
            }
          }
        }
      }
    }

    // ══ PRIORITY C: Build defense for undefended border tiles ══
    if (!actionTaken) {
      const undefBorder = currBorderTiles.filter((t) => {
        const e = aiCtx.entities.get(t.key);
        if (e && e !== "rebel") return false;
        const [tq, tr] = t.key.split(",").map(Number);
        return HEX_EDGES.some(({ dir: [dq, dr] }) => {
          const nk = tileKey(tq + dq, tr + dr);
          const nt = aiCtx.tileMap.get(nk);
          if (!nt || nt.owner === aiOwner || nt.owner === "neutral") return false;
          return getCT(nk, nt.owner as TerritoryOwner).length >= 2;
        });
      });
      if (undefBorder.length > 0) {
        const innerCands = currTerr.filter((t) => {
          if (t.terrain === "mountain" || t.terrain === "lake") return false;
          // Don't destroy our own improvement by building a defence on it.
          if (IMPROVED_TERRAINS.has(t.terrain)) return false;
          if (aiCtx.entities.has(t.key) || aiCtx.cities.has(t.key)) return false;
          if (currBorderTiles.some((bt) => bt.key === t.key)) return false;
          const [tq, tr] = t.key.split(",").map(Number);
          return undefBorder.some((bt) => {
            const [bq, br] = bt.key.split(",").map(Number);
            return hexDistance(tq, tr, bq, br) === 1;
          });
        });
        const borderCands = undefBorder.filter((t) => {
          if (t.terrain === "mountain" || t.terrain === "lake") return false;
          if (IMPROVED_TERRAINS.has(t.terrain)) return false;
          return !aiCtx.entities.has(t.key) && !aiCtx.cities.has(t.key);
        });
        const rawPlacementsC = innerCands.length > 0 ? innerCands : borderCands;
        const placementsC = dtSpacedPlacements(rawPlacementsC, aiCtx);
        for (const bType of (["tower", "castle"] as EntityType[])) {
          if (actionTaken || placementsC.length === 0) break;
          const bCost = ENTITY_META[bType].cost;
          const bUpk = ENTITY_META[bType].upkeep;
          if (!canAfford(bCost, bUpk)) continue;
          if (bType === "castle" && !currTerr.some((t) => {
            const e = aiCtx.entities.get(t.key);
            return !!e && ENTITY_META[e].isUnit && ENTITY_META[e].strength >= 2;
          })) continue;
          actionTaken = await exec.build(bType, placementsC[0].key, bCost);
        }
      }
    }

    // ══ PRIORITY D: Build a city ══
    if (!actionTaken) {
      const cityCost = ENTITY_META.city.cost;
      const alreadyHasCity = currTerr.some((t) => aiCtx.cities.has(t.key));
      if (canAfford(cityCost, 0) && currTerr.length >= 5 && !alreadyHasCity) {
        const bldgZoC = new Set<string>();
        for (const [bk, be] of aiCtx.entities) {
          if (be !== "tower" && be !== "castle") continue;
          const bt = aiCtx.tileMap.get(bk);
          if (!bt || bt.owner !== aiOwner) continue;
          bldgZoC.add(bk);
          const [bq2, br2] = bk.split(",").map(Number);
          for (const { dir: [dq, dr] } of HEX_EDGES) bldgZoC.add(tileKey(bq2 + dq, br2 + dr));
        }
        let largestEnemyKey: string | null = null;
        let largestEnemySz = 0;
        const visLarge = new Set<string>();
        for (const t of Array.from(aiCtx.tileMap.values())) {
          if (t.owner === aiOwner || t.owner === "neutral" || visLarge.has(t.key)) continue;
          const comp = getCT(t.key, t.owner as TerritoryOwner);
          for (const ct of comp) visLarge.add(ct.key);
          if (comp.length > largestEnemySz) { largestEnemySz = comp.length; largestEnemyKey = t.key; }
        }
        const [lEq, lEr] = largestEnemyKey ? largestEnemyKey.split(",").map(Number) : [0, 0];
        const cityCands = currTerr.filter((t) => {
          if (t.terrain === "mountain" || t.terrain === "lake" || aiCtx.cities.has(t.key)) return false;
          if (IMPROVED_TERRAINS.has(t.terrain)) return false;
          if (aiCtx.entities.has(t.key)) return false;
          return bldgZoC.has(t.key);
        }).sort((a, b) => {
          if (!largestEnemyKey) return 0;
          const [aq2, ar2] = a.key.split(",").map(Number);
          const [bq2, br2] = b.key.split(",").map(Number);
          return hexDistance(bq2, br2, lEq, lEr) - hexDistance(aq2, ar2, lEq, lEr);
        });
        if (cityCands.length > 0) actionTaken = await exec.build("city", cityCands[0].key, cityCost);
      }
    }

    // ══ PRIORITY D2: Build a water bridge ══
    // D2a: Connect own fragmented territories via bridge (all difficulties)
    // D2b: Aggressive expansion — bridge toward enemy/neutral territory (hard/super_hard only)
    if (!actionTaken) {
      const bridgeCost = ENTITY_META.bridge.cost; // 5
      if (canAfford(bridgeCost, 1)) {
        // D2a: consolidation bridges — lake tile adjacent to current territory AND another AI territory
        for (const t of currTerr) {
          if (actionTaken) break;
          const [tq, tr] = t.key.split(",").map(Number);
          for (const { dir: [dq, dr] } of HEX_EDGES) {
            const nk = tileKey(tq + dq, tr + dr);
            if (currTerrKeys.has(nk)) continue;
            const nt = aiCtx.tileMap.get(nk);
            if (!nt || nt.terrain !== "lake") continue;
            if (aiCtx.entities.has(nk)) continue;
            const [nq, nr] = nk.split(",").map(Number);
            const connectsOtherAiTerritory = HEX_EDGES.some(({ dir: [dq2, dr2] }) => {
              const nk2 = tileKey(nq + dq2, nr + dr2);
              if (currTerrKeys.has(nk2)) return false;
              const nt2 = aiCtx.tileMap.get(nk2);
              return !!nt2 && nt2.owner === aiOwner;
            });
            if (connectsOtherAiTerritory) {
              actionTaken = await exec.build("bridge", nk, bridgeCost);
              // Only ONE bridge per loop iteration: affordability was checked once
              // for this iteration, so building more would over-spend. The while
              // loop re-evaluates (and re-checks canAfford) for the next bridge.
              if (actionTaken) break;
            }
          }
        }

        // D2b: attack bridges — build only when a unit can immediately attack across the bridge
        // this same round. Never build adjacent to an existing bridge (prevents wasteful chains).
        if (!actionTaken && (difficulty === "hard" || difficulty === "super_hard")) {
          outer:
          for (const t of currTerr) {
            const [tq, tr] = t.key.split(",").map(Number);
            for (const { dir: [dq, dr] } of HEX_EDGES) {
              const nk = tileKey(tq + dq, tr + dr);
              if (currTerrKeys.has(nk)) continue;
              const nt = aiCtx.tileMap.get(nk);
              if (!nt || nt.terrain !== "lake") continue;
              if (aiCtx.entities.has(nk)) continue;

              const [nq, nr] = nk.split(",").map(Number);

              // Skip if a neighbouring lake tile already has a bridge (no chains)
              const adjacentBridgeExists = HEX_EDGES.some(({ dir: [dq2, dr2] }) =>
                aiCtx.entities.get(tileKey(nq + dq2, nr + dr2)) === "bridge",
              );
              if (adjacentBridgeExists) continue;

              // Collect non-AI land tiles reachable from the bridge
              const attackTargets = HEX_EDGES
                .map(({ dir: [dq2, dr2] }) => tileKey(nq + dq2, nr + dr2))
                .filter(nk2 => {
                  if (currTerrKeys.has(nk2)) return false;
                  const nt2 = aiCtx.tileMap.get(nk2);
                  if (!nt2 || nt2.terrain === "lake" || nt2.terrain === "mountain") return false;
                  return nt2.owner !== aiOwner;
                });
              if (attackTargets.length === 0) continue;

              // Check that at least one available unit is adjacent to the bridge tile and
              // strong enough to capture one of the attack targets this round.
              const canAttackNow = Array.from(availUnits).some(([uk, ue]) => {
                const [ukq, ukr] = uk.split(",").map(Number);
                if (hexDistance(ukq, ukr, nq, nr) !== 1) return false;
                return attackTargets.some(targetKey => {
                  const zoc = getMaxEnemyZoC(targetKey, aiOwner, aiCtx.entities, aiCtx.tileMap);
                  return ENTITY_META[ue].strength > zoc;
                });
              });

              if (!canAttackNow) continue;

              actionTaken = await exec.build("bridge", nk, bridgeCost);
              if (actionTaken) break outer;
            }
          }
        }
      }
    }

    // ══ PRIORITY E: Border expansion ══
    if (!actionTaken) {
      const entityAttacks: { fk: string; tk: string; eStr: number; aStr: number; oneHex: boolean; neg: boolean; score: number }[] = [];
      for (const [uk, ue] of availUnits) {
        const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? unitMovement(aiCtx.entities.get(uk)!), aiCtx.combatSpentUnits);
        for (const mk of vm) {
          const mt = aiCtx.tileMap.get(mk);
          if (!mt || mt.owner === aiOwner || mt.owner === "neutral") continue;
          const me = aiCtx.entities.get(mk);
          if (!me || me === "rebel") continue;
          const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
          if (ENTITY_META[ue].strength <= zoc) continue;
          if (mt.terrain === "lake") continue;
          const eOwnerE1 = mt.owner as TerritoryOwner;
          entityAttacks.push({
            fk: uk, tk: mk,
            eStr: ENTITY_META[me].strength,
            aStr: ENTITY_META[ue].strength,
            oneHex: dtCaptureCreatesOneHex(mk, eOwnerE1, aiCtx),
            neg: dtCaptureNegatesIncome(mk, eOwnerE1, aiCtx),
            score: dtSplitScore(mk, eOwnerE1, aiCtx),
          });
        }
      }
      if (entityAttacks.length > 0) {
        entityAttacks.sort((a, b) => {
          if (a.oneHex !== b.oneHex) return a.oneHex ? -1 : 1;
          if (a.neg !== b.neg) return a.neg ? -1 : 1;
          if (b.score !== a.score) return b.score - a.score;
          if (b.eStr !== a.eStr) return b.eStr - a.eStr;
          return b.aStr - a.aStr;
        });
        actionTaken = await exec.move(entityAttacks[0].fk, entityAttacks[0].tk);
      }
      if (!actionTaken) {
        const e1Targets = new Set(
          Array.from(aiCtx.entities.entries())
            .filter(([ek, ee]) => {
              if (ee === "rebel") return false;
              const et = aiCtx.tileMap.get(ek);
              return et && et.owner !== aiOwner && et.owner !== "neutral";
            })
            .map(([ek]) => ek),
        );
        const mergeE1 = dtFindMergeMove(1, e1Targets, availUnits, aiCtx);
        if (mergeE1) actionTaken = await exec.move(mergeE1.from, mergeE1.to);
      }
      if (!actionTaken) {
        for (const uType of AI_UNIT_BUY_ORDER_DESC) {
          if (actionTaken) break;
          const str = ENTITY_META[uType].strength;
          const cost = ENTITY_META[uType].cost;
          const upk = ENTITY_META[uType].upkeep;
          if (!canAfford(cost, upk)) continue;
          for (const t of currTerr) {
            if (actionTaken) break;
            const [tq, tr] = t.key.split(",").map(Number);
            for (const { dir: [dq, dr] } of HEX_EDGES) {
              const nk = tileKey(tq + dq, tr + dr);
              const nt = aiCtx.tileMap.get(nk);
              if (!nt || nt.owner === aiOwner || nt.owner === "neutral") continue;
              const ne = aiCtx.entities.get(nk);
              if (!ne || ne === "rebel") continue;
              if (nt.terrain === "lake") continue;
              // Cavalry can never assault a fortification.
              if (isCavalry(uType) && cavalryMoveKind(ne) === "building") continue;
              const zoc = getMaxEnemyZoC(nk, aiOwner, aiCtx.entities, aiCtx.tileMap);
              if (str > zoc) {
                actionTaken = await exec.buy(uType, nk, cost, true);
                break;
              }
            }
          }
        }
      }

      if (!actionTaken) {
        const emptyEnemyMoves: { fk: string; tk: string; sz: number }[] = [];
        for (const [uk, ue] of availUnits) {
          const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? unitMovement(aiCtx.entities.get(uk)!), aiCtx.combatSpentUnits);
          for (const mk of vm) {
            const mt = aiCtx.tileMap.get(mk);
            if (!mt || mt.owner === aiOwner || mt.owner === "neutral") continue;
            const me = aiCtx.entities.get(mk);
            if (me && me !== "rebel") continue;
            const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
            if (ENTITY_META[ue].strength <= zoc) continue;
            if (mt.terrain === "lake") continue;
            const sz = getCT(mk, mt.owner as TerritoryOwner).length;
            emptyEnemyMoves.push({ fk: uk, tk: mk, sz });
          }
        }
        if (emptyEnemyMoves.length > 0) {
          emptyEnemyMoves.sort((a, b) => b.sz - a.sz);
          actionTaken = await exec.move(emptyEnemyMoves[0].fk, emptyEnemyMoves[0].tk);
        }
        if (!actionTaken) {
          const e2Targets = new Set(
            Array.from(aiCtx.tileMap.values())
              .filter((t) => {
                if (t.owner === aiOwner || t.owner === "neutral" || t.terrain === "mountain" || t.terrain === "lake") return false;
                const me = aiCtx.entities.get(t.key);
                return !me || me === "rebel";
              })
              .map((t) => t.key),
          );
          const mergeE2 = dtFindMergeMove(1, e2Targets, availUnits, aiCtx);
          if (mergeE2) actionTaken = await exec.move(mergeE2.from, mergeE2.to);
        }
        if (!actionTaken) {
          for (const uType of AI_UNIT_BUY_ORDER_ASC) {
            if (actionTaken) break;
            const str = ENTITY_META[uType].strength;
            const cost = ENTITY_META[uType].cost;
            const upk = ENTITY_META[uType].upkeep;
            if (!canAfford(cost, upk)) continue;
            let best: { tile: string; sz: number } | null = null;
            for (const t of currTerr) {
              const [tq, tr] = t.key.split(",").map(Number);
              for (const { dir: [dq, dr] } of HEX_EDGES) {
                const nk = tileKey(tq + dq, tr + dr);
                const nt = aiCtx.tileMap.get(nk);
                if (!nt || nt.owner === aiOwner || nt.owner === "neutral") continue;
                const ne = aiCtx.entities.get(nk);
                if (ne && ne !== "rebel") continue;
                if (nt.terrain === "lake") continue;
                const zoc = getMaxEnemyZoC(nk, aiOwner, aiCtx.entities, aiCtx.tileMap);
                if (str > zoc) {
                  const sz = getCT(nk, nt.owner as TerritoryOwner).length;
                  if (!best || sz > best.sz) best = { tile: nk, sz };
                }
              }
            }
            if (best) actionTaken = await exec.buy(uType, best.tile, cost, true);
          }
        }
      }

      if (!actionTaken) {
        const neutralPrio = (t: HexTile): number => aiCtx.cities.has(t.key) ? 3 : (t.terrain === "grass" || t.terrain === "forest" || t.terrain === "field" || t.terrain === "sawmill" || t.terrain === "mine") ? 2 : 1;
        const neutralMoves: { fk: string; tk: string; prio: number }[] = [];
        for (const [uk, ue] of availUnits) {
          const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? unitMovement(aiCtx.entities.get(uk)!), aiCtx.combatSpentUnits);
          for (const mk of vm) {
            const mt = aiCtx.tileMap.get(mk);
            if (!mt || mt.owner !== "neutral") continue;
            const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
            if (ENTITY_META[ue].strength <= zoc) continue;
            if (mt.terrain === "lake") continue;
            neutralMoves.push({ fk: uk, tk: mk, prio: neutralPrio(mt) });
          }
        }
        if (neutralMoves.length > 0) {
          neutralMoves.sort((a, b) => b.prio - a.prio);
          actionTaken = await exec.move(neutralMoves[0].fk, neutralMoves[0].tk);
        }
        if (!actionTaken) {
          const e3Targets = new Set(
            Array.from(aiCtx.tileMap.values())
              .filter((t) => t.owner === "neutral" && t.terrain !== "mountain" && t.terrain !== "lake")
              .map((t) => t.key),
          );
          const mergeE3 = dtFindMergeMove(1, e3Targets, availUnits, aiCtx);
          if (mergeE3) actionTaken = await exec.move(mergeE3.from, mergeE3.to);
        }
        if (!actionTaken) {
          for (const uType of AI_UNIT_BUY_ORDER_ASC) {
            if (actionTaken) break;
            const str = ENTITY_META[uType].strength;
            const cost = ENTITY_META[uType].cost;
            const upk = ENTITY_META[uType].upkeep;
            if (!canAfford(cost, upk)) continue;
            let bestN: { tile: string; prio: number } | null = null;
            for (const t of currTerr) {
              const [tq, tr] = t.key.split(",").map(Number);
              for (const { dir: [dq, dr] } of HEX_EDGES) {
                const nk = tileKey(tq + dq, tr + dr);
                const nt = aiCtx.tileMap.get(nk);
                if (!nt || nt.owner !== "neutral") continue;
                if (nt.terrain === "lake") continue;
                const zoc = getMaxEnemyZoC(nk, aiOwner, aiCtx.entities, aiCtx.tileMap);
                if (str > zoc) {
                  const p = neutralPrio(nt);
                  if (!bestN || p > bestN.prio) bestN = { tile: nk, prio: p };
                }
              }
            }
            if (bestN) actionTaken = await exec.buy(uType, bestN.tile, cost, true);
          }
        }
      }
    }

    // ══ PRIORITY F: Move unit closer to enemy ══
    if (!actionTaken) {
      const allEnemyTiles = Array.from(aiCtx.tileMap.values()).filter(
        (t) => t.owner !== aiOwner && t.owner !== "neutral" && t.terrain !== "mountain",
      );
      for (const [uk, ue] of availUnits) {
        if (actionTaken) break;
        const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? unitMovement(aiCtx.entities.get(uk)!), aiCtx.combatSpentUnits);
        if (vm.size === 0) continue;
        const movesArr = Array.from(vm);
        const [uq, ur] = uk.split(",").map(Number);
        const alreadyBorder = HEX_EDGES.some(({ dir: [dq, dr] }) => {
          const nk = tileKey(uq + dq, ur + dr);
          const nt = aiCtx.tileMap.get(nk);
          return nt && nt.owner !== aiOwner && nt.owner !== "neutral";
        });
        if (alreadyBorder) continue;
        if (allEnemyTiles.length === 0) continue;
        let bestMk = movesArr[0];
        let bestD = Infinity;
        for (const mk of movesArr) {
          const [mq, mr] = mk.split(",").map(Number);
          let minD = Infinity;
          for (const et of allEnemyTiles) {
            const d = hexDistance(mq, mr, et.q, et.r);
            if (d < minD) minD = d;
          }
          if (minD < bestD) { bestD = minD; bestMk = mk; }
        }
        if (bestD < Infinity) actionTaken = await exec.move(uk, bestMk);
      }
    }

    // ══ PRIORITY G: Clear rebel tiles ══
    if (!actionTaken) {
      const rebelTiles = currTerr.filter((t) => aiCtx.entities.get(t.key) === "rebel");
      const unitsAsc = [...availUnits]
        .filter(([uk]) => {
          const [uqG, urG] = uk.split(",").map(Number);
          return !HEX_EDGES.some(({ dir: [dq, dr] }) => {
            const nk = tileKey(uqG + dq, urG + dr);
            const nt = aiCtx.tileMap.get(nk);
            return nt && nt.owner !== aiOwner && nt.owner !== "neutral";
          });
        })
        .sort(([, a2], [, b2]) => ENTITY_META[a2].strength - ENTITY_META[b2].strength);
      for (const rt of rebelTiles) {
        if (actionTaken) break;
        for (const [uk] of unitsAsc) {
          const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? unitMovement(aiCtx.entities.get(uk)!), aiCtx.combatSpentUnits);
          if (!vm.has(rt.key)) continue;
          actionTaken = await exec.move(uk, rt.key);
          break;
        }
      }
      if (!actionTaken) {
        // Prefer buying a scout onto the rebel: its charge clears the rebel and
        // leaves it active to ride on and act again the same turn. Fall back to
        // a peasant when the scout is unaffordable for the territory.
        const buyPreference: EntityType[] = ["scout", "peasant"];
        for (const rt of rebelTiles) {
          if (actionTaken) break;
          const rtIncome = (TERRAIN_INCOME[rt.terrain] ?? 0) + (aiCtx.cities.has(rt.key) ? CITY_BONUS : 0);
          for (const ut of buyPreference) {
            const cost = ENTITY_META[ut].cost;
            const upk = ENTITY_META[ut].upkeep;
            if (currBal >= cost && currIncome + rtIncome - (currUpkeep + upk) >= 0) {
              actionTaken = await exec.buy(ut, rt.key, cost, false);
              break;
            }
          }
        }
      }
    }

    // ══ PRIORITY H: Remove unnecessary defensive buildings ══
    if (!actionTaken) {
      for (const [bk, be] of aiCtx.entities) {
        if (actionTaken) break;
        if (be !== "tower" && be !== "castle") continue;
        const bt = aiCtx.tileMap.get(bk);
        if (!bt || bt.owner !== aiOwner || !currTerrKeys.has(bk)) continue;
        const [bq2, br2] = bk.split(",").map(Number);
        const hasNearbyEnemy = Array.from(aiCtx.tileMap.values()).some((nt) => {
          if (nt.owner === aiOwner || nt.owner === "neutral") return false;
          const [ntq, ntr] = nt.key.split(",").map(Number);
          return hexDistance(bq2, br2, ntq, ntr) <= 6;
        });
        if (!hasNearbyEnemy) actionTaken = await exec.remove(bk);
      }
    }

    // ══ PRIORITY I: Remove bridges surrounded by 4+ owned tiles (no longer needed) ══
    if (!actionTaken) {
      for (const t of currTerr) {
        if (actionTaken) break;
        if (t.terrain !== "lake") continue;
        const e = aiCtx.entities.get(t.key);
        if (e !== "bridge") continue;
        const [tq, tr] = t.key.split(",").map(Number);
        let ownedNeighbors = 0;
        for (const { dir: [dq, dr] } of HEX_EDGES) {
          const nk = tileKey(tq + dq, tr + dr);
          if (aiCtx.tileMap.get(nk)?.owner === aiOwner) ownedNeighbors++;
        }
        if (ownedNeighbors >= 5) actionTaken = await exec.remove(t.key);
      }
    }

    // ══ PRIORITY J (LAST RESORT): Improve an idle peasant's tile with spare gold ══
    // Only when nothing better happened this iteration, so the AI never skips
    // combat or expansion to farm. dtFindImproveMove prefers city-adjacent
    // peasants and skips already-spent units (aiCtx.spentUnits is the live set
    // the loop filters availUnits against and that exec.improve mutates).
    if (!actionTaken) {
      const dev = dtFindImproveMove(currTerr, aiCtx, aiCtx.spentUnits, currBal);
      if (dev) actionTaken = await exec.improve(dev.key, dev.terrain, improveCostFor(dev.terrain));
    }

    if (!actionTaken) break;
  }
}

// ─── AI Turn Orchestration ────────────────────────────────────────────────────

export interface AiWorkingState {
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  balances: Map<string, number>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  graveyard: Set<string>;
  ruins: Set<string>;
  cities: Set<string>;
  spentUnits: Set<string>;
  partialMoves: Map<string, number>;
  /** Per-turn charge counter, keyed by unit tile; transient to the AI turn. */
  attacksUsed: Map<string, number>;
  /** Units that have struck a defender this turn (cavalry: no second strike). */
  combatSpentUnits: Set<string>;
  freeTowerUsed: Map<TerritoryOwner, Set<string>>;
}

export interface AiTurnCallbacks {
  state: {
    setEntities(v: Map<string, EntityType>): void;
    setMutableTileMap(v: Map<string, HexTile>): void;
    setTerritoryBalances(v: Map<string, number>): void;
    setGraveyard(v: Set<string>): void;
    setRuins(v: Set<string>): void;
    setLiveOwnerMap(v: Map<string, TerritoryOwner>): void;
    setCities(v: Set<string>): void;
    setFreeTowerUsedTiles(v: Map<TerritoryOwner, Set<string>>): void;
    setAiStateMap(v: Map<string, AiState>): void;
    setIsAiTurn(v: boolean): void;
    /** Advance the round counter; called once when the whole AI phase completes. */
    advanceTurn(): void;
  };
  refs: {
    getAiStateMap(): Map<string, AiState>;
    setAiStateMap(v: Map<string, AiState>): void;
    isTurnActive(): boolean;
    isDeveloperMode(): boolean;
    setAiTurn(v: boolean): void;
  };
  initStepHistory(snap: AiStepSnapshot): void;
  awaitStep(snap: AiStepSnapshot): Promise<void>;
  awaitPreAiResume(): Promise<void>;
  awaitPostAiResume(): Promise<void>;
  triggerUnitAnimation(
    fromKey: string,
    toKey: string,
    entity: EntityType,
    owner: TerritoryOwner,
    isAi: boolean,
    done: () => void,
  ): void;
  recalculateTerritoriesForCapture(
    capturedKey: string,
    newOwner: TerritoryOwner,
    previousOwner: TerritoryOwner,
    prevMap: Map<string, HexTile>,
    newMap: Map<string, HexTile>,
    balances: Map<string, number>,
    entities?: Map<string, EntityType>,
    prevEntities?: Map<string, EntityType>,
  ): Map<string, number>;
  applySingleHexPenalty(
    prevMap: Map<string, HexTile>,
    newMap: Map<string, HexTile>,
    balances: Map<string, number>,
    entities: Map<string, EntityType>,
    graveyard: Set<string>,
    ruins: Set<string>,
    exemptKey?: string,
  ): void;
  checkWinLoss(map: Map<string, HexTile>): void;
}

function snapFromWs(ws: AiWorkingState): AiStepSnapshot {
  return {
    entities: new Map(ws.entities),
    mutableTileMap: new Map(ws.tileMap),
    territoryBalances: new Map(ws.balances),
    liveOwnerMap: new Map(ws.liveOwnerMap),
    graveyard: new Set(ws.graveyard),
    ruins: new Set(ws.ruins),
    cities: new Set(ws.cities),
    freeTowerUsedTiles: new Map(
      [...ws.freeTowerUsed.entries()].map(([k, v]) => [k, new Set(v)]),
    ),
  };
}

export async function runAiTurn(
  ws: AiWorkingState,
  cbs: AiTurnCallbacks,
  aiOwners: TerritoryOwner[],
  currentTurn: number,
  difficulty: Difficulty,
): Promise<void> {
  cbs.initStepHistory(snapFromWs(ws));
  await cbs.awaitPreAiResume();

  for (const aiOwner of aiOwners) {
    if (!cbs.refs.isTurnActive()) return;

    const visited = new Set<string>();
    const aiTiles = Array.from(ws.tileMap.values()).filter(
      (t) => t.owner === aiOwner,
    );
    if (aiTiles.length === 0) continue;

    const cache = new TerritoryCache();

    for (const startTile of aiTiles) {
      if (visited.has(startTile.key)) continue;
      const territory = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner, ws.entities);
      for (const t of territory) visited.add(t.key);
      const territoryId = getTerritoryId(territory);
      if (!territoryId) continue;

      if (territory.length >= 2 && currentTurn === 1) {
        const aiUsedSet = ws.freeTowerUsed.get(aiOwner);
        const hasUsedFreeTower =
          !!aiUsedSet && territory.some((t) => aiUsedSet.has(t.key));
        if (!hasUsedFreeTower) {
          const allValidTowerCands: string[] = territory
            .filter(
              (t) =>
                t.terrain !== "mountain" &&
                t.terrain !== "lake" &&
                !ws.entities.has(t.key) &&
                !ws.cities.has(t.key) &&
                !ws.graveyard.has(t.key),
            )
            .map((t) => t.key);
          if (allValidTowerCands.length > 0) {
            const scoreCandidate = (candKey: string): number => {
              const [cq, cr] = candKey.split(",").map(Number);
              let ownedCovered = 0;
              for (const { dir: [dq, dr] } of HEX_EDGES) {
                const nk = tileKey(cq + dq, cr + dr);
                const nt = ws.tileMap.get(nk);
                if (nt && nt.owner === aiOwner) ownedCovered++;
              }
              return ownedCovered;
            };
            const towerKey = allValidTowerCands.reduce((bestKey, candKey) => {
              return scoreCandidate(candKey) > scoreCandidate(bestKey) ? candKey : bestKey;
            }, allValidTowerCands[0]);
            ws.entities = new Map(ws.entities);
            ws.entities.set(towerKey, "tower");
            const newOwnerSet = new Set(ws.freeTowerUsed.get(aiOwner) ?? []);
            for (const t of territory) newOwnerSet.add(t.key);
            ws.freeTowerUsed = new Map(ws.freeTowerUsed);
            ws.freeTowerUsed.set(aiOwner, newOwnerSet);
            cbs.state.setFreeTowerUsedTiles(new Map(ws.freeTowerUsed));
            cbs.state.setEntities(new Map(ws.entities));
            cbs.state.setAiStateMap(new Map(cbs.refs.getAiStateMap()));
            await cbs.awaitStep(snapFromWs(ws));
            if (!cbs.refs.isTurnActive()) return;
          }
        }
      }

      if (currentTurn === 1) continue;

      const aiCtx: AiContext = {
        get tileMap() { return ws.tileMap; },
        get entities() { return ws.entities; },
        get balances() { return ws.balances; },
        get cities() { return ws.cities; },
        get spentUnits() { return ws.spentUnits; },
        get partialMoves() { return ws.partialMoves; },
        get combatSpentUnits() { return ws.combatSpentUnits; },
        get aiOwner() { return aiOwner; },
        territoryCache: cache,
      };

      const dtAwait = async (): Promise<void> => {
        await cbs.awaitStep(snapFromWs(ws));
      };

      // Defense-in-depth: an AI can NEVER spend more than the paying territory
      // holds. Every buy/build/upgrade is funded by the territory being
      // processed (startTile's contiguous territory); if it can't cover `cost`,
      // the action is refused outright. This guarantees the invariant even if a
      // decision branch forgets to re-check affordability.
      const canPay = (cost: number): boolean => {
        const terr = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner, ws.entities);
        const id = getTerritoryId(terr);
        const bal = id ? (ws.balances.get(id) ?? 0) : 0;
        return bal >= cost;
      };

      const dtPublishState = (anchorKey: string): void => {
        const updTerr = getContiguousTerritory(ws.tileMap, anchorKey, aiOwner, ws.entities);
        const updId = getTerritoryId(updTerr);
        if (!updId) return;
        const updMaxStr = updTerr.reduce((best, t) => {
          const e = ws.entities.get(t.key);
          return e ? Math.max(best, ENTITY_META[e].strength) : best;
        }, 0);
        const updBorder = updTerr.filter((t) => {
          const [tq, tr] = t.key.split(",").map(Number);
          return HEX_EDGES.some(({ dir: [dq, dr] }) => {
            const nk = tileKey(tq + dq, tr + dr);
            const nb = ws.tileMap.get(nk);
            return !!nb && nb.owner !== aiOwner;
          });
        });
        const updThreatened = updBorder.some((bt) => {
          const [bq, br] = bt.key.split(",").map(Number);
          for (const [ek, ee] of ws.entities) {
            if (!ENTITY_META[ee].isUnit) continue;
            const et = ws.tileMap.get(ek);
            if (!et || et.owner === aiOwner || et.owner === "neutral") continue;
            const [eq2, er2] = ek.split(",").map(Number);
            if (hexDistance(bq, br, eq2, er2) <= 3 && ENTITY_META[ee].strength > updMaxStr) return true;
          }
          return false;
        });
        const nextStateMap = new Map(cbs.refs.getAiStateMap());
        nextStateMap.set(updId, updThreatened ? "defending" : "attacking");
        cbs.refs.setAiStateMap(nextStateMap);
        cbs.state.setAiStateMap(new Map(nextStateMap));
      };

      const dtExecMove = async (fromKey: string, toKey: string): Promise<boolean> => {
        if (!cbs.refs.isTurnActive()) return false;
        const unitEntity = ws.entities.get(fromKey);
        if (!unitEntity) return false;
        const destTile = ws.tileMap.get(toKey);
        if (!destTile) return false;
        // Units can land on bridge tiles (own or enemy capture). Bridge entity is replaced by unit.
        const previousOwner = destTile.owner as TerritoryOwner;
        const prevTileMapSnapshot = new Map(ws.tileMap);
        const prevEntitiesSnapshot = new Map(ws.entities);

        ws.tileMap = new Map(ws.tileMap);
        ws.tileMap.set(toKey, { ...destTile, owner: aiOwner });
        ws.entities = new Map(ws.entities);

        const destExisting = ws.entities.get(toKey);
        // Bridge capture = normal capture: unit moves to bridge tile (bridge entity replaced by unit).
        // The lake tile stays territorial because a unit now stands on it (isLakePassable in hexGrid).
        const mergeInto =
          destExisting && destExisting !== "bridge" && destTile.owner === aiOwner
            ? mergeResult(unitEntity, destExisting)
            : null;
        const isAllyMerge = mergeInto !== null;

        if (isAllyMerge) {
          ws.entities.delete(fromKey);
          ws.entities.set(toKey, mergeInto!);
        } else {
          ws.entities.delete(toKey);
          ws.entities.delete(fromKey);
          ws.entities.set(toKey, unitEntity);
        }

        // Bridge auto-restoration: if the AI unit moved FROM a lake tile (bridge),
        // restore the bridge entity so the bridge structure persists.
        if (ws.tileMap.get(fromKey)?.terrain === 'lake') {
          ws.entities.set(fromKey, 'bridge');
        }

        // Capturing any non-owned tile (neutral OR enemy) or overwriting a
        // non-bridge entity is combat, which always spends the unit — same rules
        // as the player.
        const isCombatMove =
          !isAllyMerge &&
          (previousOwner !== aiOwner ||
            (destExisting !== undefined && destExisting !== "bridge"));

        ws.spentUnits = new Set(ws.spentUnits);
        ws.partialMoves = new Map(ws.partialMoves);
        {
          const maxRange = unitMovement(unitEntity);
          const stepsUsed = getMoveCost(fromKey, toKey, prevTileMapSnapshot, prevEntitiesSnapshot);
          const prevRemaining = ws.partialMoves.get(fromKey) ?? maxRange;
          const remainingAfterMove = Math.max(0, prevRemaining - stepsUsed);
          const destRemaining = effectiveRemaining(toKey, ws.partialMoves, ws.spentUnits, maxRange);
          ws.partialMoves.delete(fromKey);
          // For a merge, the source tile empties out; mark it spent so it is not
          // re-evaluated. The merged unit lives at toKey.
          if (isAllyMerge) ws.spentUnits.add(fromKey);
          // Charge: cavalry keeps acting after a combat move instead of being
          // spent on its first attack — same shared predicate as the player, so
          // the loop re-evaluates the unit next iteration for its second attack.
          const isCharge = isChargeAttack({
            isCombatMove,
            entity: unitEntity,
            attacksUsedSoFar: ws.attacksUsed.get(fromKey) ?? 0,
            remainingAfterMove,
          });
          const moved = resolveMovedUnitMoves({
            isMerge: isAllyMerge,
            isCombat: isCombatMove && !isCharge,
            remainingAfterMove,
            destRemaining,
            maxRange,
          });
          ws.partialMoves.delete(toKey);
          if (moved.spent) {
            ws.spentUnits.add(toKey);
          } else {
            ws.spentUnits.delete(toKey);
            if (moved.remaining !== null) ws.partialMoves.set(toKey, moved.remaining);
          }
          ws.attacksUsed = advanceAttacksUsed({
            attacksUsed: ws.attacksUsed,
            fromKey,
            toKey,
            isCombatMove,
            spent: moved.spent,
          });
          // Combat-lock the unit when it strikes a defender (cavalry: no second
          // strike) or finishes its combat; carries with it on later moves.
          const isEntityStrike =
            isCombatMove && cavalryMoveKind(destExisting) === "entity";
          ws.combatSpentUnits = advanceCombatSpent({
            combatSpentUnits: ws.combatSpentUnits,
            fromKey,
            toKey,
            locks: isEntityStrike || (isCombatMove && !isCharge),
          });
        }

        ws.balances = cbs.recalculateTerritoriesForCapture(
          toKey, aiOwner, previousOwner, prevTileMapSnapshot, ws.tileMap, ws.balances, ws.entities, prevEntitiesSnapshot,
        );

        ws.liveOwnerMap = new Map(ws.liveOwnerMap);
        ws.liveOwnerMap.set(toKey, aiOwner);
        ws.graveyard = new Set(ws.graveyard);
        ws.graveyard.delete(toKey);
        // A unit stepping onto a grave/ruin tile clears the marker for good.
        ws.ruins = new Set(ws.ruins);
        ws.ruins.delete(toKey);
        cbs.applySingleHexPenalty(
          prevTileMapSnapshot, ws.tileMap, ws.balances, ws.entities,
          ws.graveyard, ws.ruins,
        );
        cbs.state.setRuins(new Set(ws.ruins));
        cache.clear();

        if (!cbs.refs.isDeveloperMode()) {
          await new Promise<void>((resolve) => {
            cbs.triggerUnitAnimation(fromKey, toKey, unitEntity, aiOwner as TerritoryOwner, true, () => {
              cbs.state.setMutableTileMap(new Map(ws.tileMap));
              cbs.state.setLiveOwnerMap(new Map(ws.liveOwnerMap));
              cbs.state.setEntities(new Map(ws.entities));
              cbs.state.setTerritoryBalances(new Map(ws.balances));
              cbs.state.setGraveyard(new Set(ws.graveyard));
              resolve();
            });
          });
        } else {
          cbs.state.setMutableTileMap(new Map(ws.tileMap));
          cbs.state.setLiveOwnerMap(new Map(ws.liveOwnerMap));
          cbs.state.setEntities(new Map(ws.entities));
          cbs.state.setTerritoryBalances(new Map(ws.balances));
          cbs.state.setGraveyard(new Set(ws.graveyard));
        }

        dtPublishState(toKey);
        await dtAwait();
        return true;
      };

      const dtExecBuy = async (
        unitType: EntityType, target: string, cost: number, outside: boolean,
      ): Promise<boolean> => {
        if (!cbs.refs.isTurnActive()) return false;
        if (!canPay(cost)) return false;
        ws.entities = new Map(ws.entities);
        ws.balances = new Map(ws.balances);

        if (!outside) {
          const wasRebel = ws.entities.get(target) === "rebel";
          if (unitType === "city") {
            ws.cities = new Set(ws.cities);
            ws.cities.add(target);
          } else {
            ws.entities.set(target, unitType);
          }
          cache.clear();
          const buyTerr = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner, ws.entities);
          const buyTid = getTerritoryId(buyTerr);
          if (buyTid) ws.balances.set(buyTid, (ws.balances.get(buyTid) ?? 0) - cost);
          if (wasRebel) {
            // Overwriting a rebel is a strike: a cavalry unit spends one action
            // and is combat-locked (no second strike) but stays active to ride
            // on for one open tile; others are spent immediately.
            if (unitMaxAttacks(unitType) > 1) {
              ws.attacksUsed = new Map(ws.attacksUsed);
              ws.attacksUsed.set(target, 1);
              ws.combatSpentUnits = new Set(ws.combatSpentUnits);
              ws.combatSpentUnits.add(target);
            } else {
              ws.spentUnits = new Set(ws.spentUnits);
              ws.spentUnits.add(target);
            }
          }
        } else {
          const previousOwner = (ws.tileMap.get(target)?.owner ?? "neutral") as TerritoryOwner;
          const targetEntityBefore = ws.entities.get(target);
          const prevSnapshot = new Map(ws.tileMap);
          ws.tileMap = new Map(ws.tileMap);
          const targetTile = ws.tileMap.get(target);
          if (targetTile && (targetTile.terrain === "mountain" || targetTile.terrain === "lake")) return false;
          if (targetTile) ws.tileMap.set(target, { ...targetTile, owner: aiOwner });
          if (unitType === "city") {
            ws.cities = new Set(ws.cities);
            ws.cities.add(target);
          } else {
            ws.entities.delete(target);
            ws.entities.set(target, unitType);
          }
          cache.clear();
          ws.balances = cbs.recalculateTerritoriesForCapture(
            target, aiOwner, previousOwner, prevSnapshot, ws.tileMap, ws.balances, ws.entities,
          );
          const mergedTerr = getContiguousTerritory(ws.tileMap, target, aiOwner, ws.entities);
          const mergedId = getTerritoryId(mergedTerr);
          if (mergedId) ws.balances.set(mergedId, (ws.balances.get(mergedId) ?? 0) - cost);
          cbs.applySingleHexPenalty(prevSnapshot, ws.tileMap, ws.balances, ws.entities, ws.graveyard, ws.ruins);
          cbs.state.setRuins(new Set(ws.ruins));
          ws.liveOwnerMap = new Map(ws.liveOwnerMap);
          ws.liveOwnerMap.set(target, aiOwner);
          // Charge unit bought into an attack spends one action but stays active
          // to ride on. Striking a defender also combat-locks it (no second
          // strike); taking an open tile leaves it free to strike later.
          if (unitMaxAttacks(unitType) > 1) {
            ws.attacksUsed = new Map(ws.attacksUsed);
            ws.attacksUsed.set(target, 1);
            if (cavalryMoveKind(targetEntityBefore) === "entity") {
              ws.combatSpentUnits = new Set(ws.combatSpentUnits);
              ws.combatSpentUnits.add(target);
            }
          } else {
            ws.spentUnits = new Set(ws.spentUnits);
            ws.spentUnits.add(target);
          }
          cbs.state.setMutableTileMap(new Map(ws.tileMap));
          cbs.state.setLiveOwnerMap(new Map(ws.liveOwnerMap));
        }

        // Buying an active unit onto a grave/ruin tile clears the marker for
        // good (same rule as walking onto it). Cities/buildings don't, so guard
        // on isUnit.
        if (
          ENTITY_META[unitType].isUnit &&
          (ws.graveyard.has(target) || ws.ruins.has(target))
        ) {
          ws.graveyard = new Set(ws.graveyard);
          ws.graveyard.delete(target);
          ws.ruins = new Set(ws.ruins);
          ws.ruins.delete(target);
          cbs.state.setGraveyard(new Set(ws.graveyard));
          cbs.state.setRuins(new Set(ws.ruins));
        }

        cbs.state.setEntities(new Map(ws.entities));
        cbs.state.setCities(new Set(ws.cities));
        cbs.state.setTerritoryBalances(new Map(ws.balances));
        cbs.state.setAiStateMap(new Map(cbs.refs.getAiStateMap()));
        await dtAwait();
        return true;
      };

      const dtExecUpgrade = async (targetKey: string, to: EntityType, cost: number): Promise<boolean> => {
        if (!cbs.refs.isTurnActive()) return false;
        if (!canPay(cost)) return false;
        ws.entities = new Map(ws.entities);
        ws.entities.set(targetKey, to);
        cache.clear();
        ws.balances = new Map(ws.balances);
        const buyTerr = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner, ws.entities);
        const buyTid = getTerritoryId(buyTerr);
        if (buyTid) ws.balances.set(buyTid, (ws.balances.get(buyTid) ?? 0) - cost);
        cbs.state.setEntities(new Map(ws.entities));
        cbs.state.setTerritoryBalances(new Map(ws.balances));
        await dtAwait();
        return true;
      };

      const dtExecBuild = async (buildingType: EntityType, targetKey: string, cost: number): Promise<boolean> => {
        if (!cbs.refs.isTurnActive()) return false;
        if (!canPay(cost)) return false;

        // Bridge: lake tile needs ownership change + entity + territory recalculation
        if (buildingType === "bridge") {
          const prevSnapshot = new Map(ws.tileMap);
          ws.tileMap = new Map(ws.tileMap);
          const targetTile = ws.tileMap.get(targetKey);
          if (!targetTile || targetTile.terrain !== "lake") return false;
          ws.tileMap.set(targetKey, { ...targetTile, owner: aiOwner });
          ws.entities = new Map(ws.entities);
          ws.entities.set(targetKey, "bridge");
          cache.clear();
          ws.balances = new Map(ws.balances);
          ws.balances = cbs.recalculateTerritoriesForCapture(
            targetKey, aiOwner, "neutral", prevSnapshot, ws.tileMap, ws.balances, ws.entities,
          );
          const mergedTerr = getContiguousTerritory(ws.tileMap, targetKey, aiOwner, ws.entities);
          const mergedId = getTerritoryId(mergedTerr);
          if (mergedId) ws.balances.set(mergedId, (ws.balances.get(mergedId) ?? 0) - cost);
          ws.liveOwnerMap = new Map(ws.liveOwnerMap);
          ws.liveOwnerMap.set(targetKey, aiOwner);
          cbs.state.setMutableTileMap(new Map(ws.tileMap));
          cbs.state.setLiveOwnerMap(new Map(ws.liveOwnerMap));
          cbs.state.setEntities(new Map(ws.entities));
          cbs.state.setTerritoryBalances(new Map(ws.balances));
          await dtAwait();
          return true;
        }

        ws.balances = new Map(ws.balances);
        if (buildingType === "city") {
          ws.cities = new Set(ws.cities);
          ws.cities.add(targetKey);
        } else {
          ws.entities = new Map(ws.entities);
          ws.entities.set(targetKey, buildingType);
        }
        cache.clear();
        const buyTerr = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner, ws.entities);
        const buyTid = getTerritoryId(buyTerr);
        if (buyTid) ws.balances.set(buyTid, (ws.balances.get(buyTid) ?? 0) - cost);
        cbs.state.setEntities(new Map(ws.entities));
        cbs.state.setCities(new Set(ws.cities));
        cbs.state.setTerritoryBalances(new Map(ws.balances));
        await dtAwait();
        return true;
      };

      const dtExecRemove = async (targetKey: string): Promise<boolean> => {
        if (!cbs.refs.isTurnActive()) return false;
        const removedEntity = ws.entities.get(targetKey);
        ws.entities = new Map(ws.entities);
        ws.entities.delete(targetKey);
        if (ws.attacksUsed.has(targetKey)) {
          ws.attacksUsed = new Map(ws.attacksUsed);
          ws.attacksUsed.delete(targetKey);
        }
        // Bridge removed: lake tile must lose owner (non-occupiable without bridge)
        if (removedEntity === "bridge") {
          const lt = ws.tileMap.get(targetKey);
          if (lt?.terrain === "lake") {
            ws.tileMap = new Map(ws.tileMap);
            ws.tileMap.set(targetKey, { ...lt, owner: "neutral" });
            cbs.state.setMutableTileMap(new Map(ws.tileMap));
          }
        }
        cache.clear();
        cbs.state.setEntities(new Map(ws.entities));
        cbs.state.setTerritoryBalances(new Map(ws.balances));
        await dtAwait();
        return true;
      };

      const dtExecImprove = async (
        target: string,
        terrain: TerrainType,
        cost: number,
      ): Promise<boolean> => {
        if (!cbs.refs.isTurnActive()) return false;
        if (!canPay(cost)) return false;
        const tt = ws.tileMap.get(target);
        if (!tt) return false;
        ws.tileMap = new Map(ws.tileMap);
        ws.tileMap.set(target, { ...tt, terrain });
        cache.clear();
        const terr = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner, ws.entities);
        const tid = getTerritoryId(terr);
        ws.balances = new Map(ws.balances);
        if (tid) ws.balances.set(tid, (ws.balances.get(tid) ?? 0) - cost);
        ws.spentUnits = new Set(ws.spentUnits);
        ws.spentUnits.add(target);
        cbs.state.setMutableTileMap(new Map(ws.tileMap));
        cbs.state.setTerritoryBalances(new Map(ws.balances));
        await dtAwait();
        return true;
      };

      const markSpent = (key: string): void => {
        ws.spentUnits = new Set(ws.spentUnits);
        ws.spentUnits.add(key);
      };

      const setTerritoryState = (tid: string, state: AiState): void => {
        const next = new Map(cbs.refs.getAiStateMap());
        next.set(tid, state);
        cbs.refs.setAiStateMap(next);
        cbs.state.setAiStateMap(new Map(next));
      };

      const exec: AiDecisionExec = {
        move: dtExecMove,
        buy: dtExecBuy,
        upgrade: dtExecUpgrade,
        build: dtExecBuild,
        remove: dtExecRemove,
        improve: dtExecImprove,
        markSpent,
        setTerritoryState,
      };
      if (difficulty === "expert" || difficulty === "super_expert") {
        await runExpertTerritoryDecisionLoop(
          startTile.key,
          aiCtx,
          exec,
          () => cbs.refs.isTurnActive(),
        );
      } else {
        await runAiTerritoryDecisionLoop(
          startTile.key,
          aiCtx,
          exec,
          () => cbs.refs.isTurnActive(),
          difficulty,
        );
      }
    }
  }

  // ── Player bankruptcy check after all AI moves ─────────────────────────────
  if (currentTurn !== 1) {
    // Board state before the demolitions below, so the single-hex sweep only
    // penalizes remnants the bankruptcy itself isolates (not pre-existing ones).
    const prevBankruptcySnapshot = new Map(ws.tileMap);
    const playerVisited = new Set<string>();
    let playerBankruptcyOccurred = false;
    for (const tile of Array.from(ws.tileMap.values())) {
      if (tile.owner !== "player" || playerVisited.has(tile.key)) continue;
      if (tile.terrain === "mountain") continue;
      const territory = getContiguousTerritory(ws.tileMap, tile.key, "player", ws.entities);
      for (const t of territory) playerVisited.add(t.key);
      const territoryId = getTerritoryId(territory);
      if (!territoryId) continue;
      const income = calcTerritoryIncome(territory, ws.entities, ws.cities, ws.tileMap);
      const upkeep = calcTerritoryUpkeep(territory, ws.entities);
      const current = ws.balances.get(territoryId) ?? 0;
      const delta = income - upkeep;
      const newBalance = current + delta;
      if (newBalance < 0) {
        // Bankruptcy: reserves + income could not cover upkeep, so the balance
        // is drained to 0 and units (and possibly buildings) are liquidated.
        playerBankruptcyOccurred = true;
        ws.balances = new Map(ws.balances);
        ws.balances.set(territoryId, 0);
        ws.entities = new Map(ws.entities);
        ws.graveyard = new Set(ws.graveyard);
        let unitUpkeepSaved = 0;
        for (const t of territory) {
          const e = ws.entities.get(t.key);
          if (e && ENTITY_META[e].isUnit) {
            unitUpkeepSaved += ENTITY_META[e].upkeep;
            // If the unit was standing on a bridge tile, restore the bridge
            // entity so the lake tile stays connected to the territory.
            if (ws.tileMap.get(t.key)?.terrain === 'lake') {
              ws.entities.set(t.key, 'bridge');
            } else {
              ws.entities.delete(t.key);
            }
            ws.graveyard.add(t.key);
          }
        }
        if (delta + unitUpkeepSaved < 0) {
          ws.ruins = new Set(ws.ruins);
          for (const t of territory) {
            const e = ws.entities.get(t.key);
            if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
              ws.entities.delete(t.key);
              ws.ruins.add(t.key);
              // A demolished bridge must release its lake tile back to neutral,
              // otherwise the owned lake keeps rendering as a bridge (with a
              // territory border) even though the structure is gone.
              if (e === "bridge") {
                const lt = ws.tileMap.get(t.key);
                if (lt?.terrain === "lake") {
                  ws.tileMap = new Map(ws.tileMap);
                  ws.tileMap.set(t.key, { ...lt, owner: "neutral" });
                }
              }
            }
          }
        }
      }
    }

    if (playerBankruptcyOccurred) {
      // Demolished bridges/buildings can leave isolated single-hex remnants
      // (especially dangling bridges). Mirror endTurnHandler and sweep them so
      // they don't linger on the board with inherited reserves. Clone the
      // working sets first since the sweep mutates them in place.
      ws.tileMap = new Map(ws.tileMap);
      ws.balances = new Map(ws.balances);
      ws.graveyard = new Set(ws.graveyard);
      ws.ruins = new Set(ws.ruins);
      cbs.applySingleHexPenalty(
        prevBankruptcySnapshot,
        ws.tileMap,
        ws.balances,
        ws.entities,
        ws.graveyard,
        ws.ruins,
      );
      cbs.state.setEntities(new Map(ws.entities));
      cbs.state.setTerritoryBalances(new Map(ws.balances));
      cbs.state.setGraveyard(new Set(ws.graveyard));
      cbs.state.setRuins(new Set(ws.ruins));
    }
  }

  // ── Win/loss check ─────────────────────────────────────────────────────────
  cbs.checkWinLoss(ws.tileMap);

  // ── Publish final state ─────────────────────────────────────────────────────
  cbs.state.setMutableTileMap(new Map(ws.tileMap));
  cbs.state.setLiveOwnerMap(new Map(ws.liveOwnerMap));
  cbs.state.setEntities(new Map(ws.entities));
  cbs.state.setTerritoryBalances(new Map(ws.balances));
  cbs.state.setGraveyard(new Set(ws.graveyard));
  cbs.state.setRuins(new Set(ws.ruins));
  cbs.state.setFreeTowerUsedTiles(new Map(ws.freeTowerUsed));
  cbs.refs.setAiTurn(false);
  await cbs.awaitPostAiResume();
  // The whole AI phase is done and control returns to the player — advance the
  // round counter HERE (not at the player's End Turn), so the counter equals the
  // round number: everyone acts in round R while it reads R.
  cbs.state.advanceTurn();
  cbs.state.setIsAiTurn(false);
}
