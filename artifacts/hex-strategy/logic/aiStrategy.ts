import type { HexTile, TerritoryOwner, EntityType, AiStepSnapshot } from "@/types";
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
} from "@/utils/hexGrid";
import { calcTerritoryUpkeep, mergedUnitType } from "@/logic/gameLogic";
import {
  dtSplitScore,
  dtCaptureNegatesIncome,
  dtCaptureCreatesOneHex,
  dtLakeHasSplitOpportunity,
  dtSpacedPlacements,
  dtFindMergeMove,
} from "@/logic/aiHelpers";
import type { AiContext } from "@/logic/aiHelpers";
import type { AiState, Difficulty } from "@/types";

/**
 * Callbacks executed by the AI decision loop. The implementations live in
 * game.tsx because each one must update React state and await animations.
 * Keeping exec in the caller preserves the "no game-logic changes" invariant
 * while separating the decision tree from the rendering layer.
 */
export interface AiDecisionExec {
  move(from: string, to: string): Promise<boolean>;
  buy(type: EntityType, target: string, cost: number, outside: boolean): Promise<boolean>;
  upgrade(target: string, to: EntityType, cost: number): Promise<boolean>;
  build(type: EntityType, target: string, cost: number): Promise<boolean>;
  remove(target: string): Promise<boolean>;
  markSpent(key: string): void;
  setTerritoryState(tid: string, state: AiState): void;
}

/**
 * Single entry point for one AI player's full turn. The AI evaluates and
 * executes many sequential actions per territory (move, buy, upgrade, build,
 * remove). A "single action returned" model is not compatible with this
 * multi-step loop without rewriting the game's turn flow. Instead, this
 * function is called once per AI turn and drives all decisions through the
 * exec callbacks which update React state in game.tsx.
 */
export async function runAiTerritoryDecisionLoop(
  startTileKey: string,
  aiCtx: AiContext,
  exec: AiDecisionExec,
  isTurnActive: () => boolean,
  difficulty: Difficulty,
): Promise<void> {
  const aiOwner = aiCtx.aiOwner;

  let dtIter = 0;
  while (dtIter++ < 100) {
    if (!isTurnActive()) return;

    const currTerr = getContiguousTerritory(aiCtx.tileMap, startTileKey, aiOwner);
    if (currTerr.length === 0) break;
    const currTerrKeys = new Set(currTerr.map((t) => t.key));
    const currTid = getTerritoryId(currTerr);
    if (!currTid) break;
    const currBal = aiCtx.balances.get(currTid) ?? 0;

    const currIncome = currTerr.reduce((s, t) => {
      if (aiCtx.entities.get(t.key) === "rebel") return s;
      return s + (TERRAIN_INCOME[t.terrain] ?? 0) + (aiCtx.cities.has(t.key) ? CITY_BONUS : 0);
    }, 0);
    const currUpkeep = calcTerritoryUpkeep(currTerr, aiCtx.entities);

    const canAfford = (cost: number, extraUpkeep: number = 0): boolean =>
      currBal >= cost && currIncome - (currUpkeep + extraUpkeep) >= 0;

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
          const adjTerr = getContiguousTerritory(aiCtx.tileMap, nk, nt.owner as TerritoryOwner);
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

    // ══ PRIORITY 0: Retreat lake units that no longer have a split opportunity ══
    if (!actionTaken) {
      for (const [uk, ue] of aiCtx.entities) {
        if (actionTaken) break;
        if (!ENTITY_META[ue].isUnit) continue;
        if (aiCtx.spentUnits.has(uk)) continue;
        const ut = aiCtx.tileMap.get(uk);
        if (!ut || ut.owner !== aiOwner || ut.terrain !== "lake") continue;
        if (dtLakeHasSplitOpportunity(uk, ENTITY_META[ue].strength, aiCtx)) continue;
        const retreatVis = new Set<string>([uk]);
        const retreatQ: string[] = [uk];
        const retreatPrev = new Map<string, string>();
        let retreatTarget: string | null = null;
        bfsLakeRetreat: while (retreatQ.length > 0) {
          const curr = retreatQ.shift()!;
          const ct = aiCtx.tileMap.get(curr);
          if (!ct) continue;
          const [cq2, cr2] = curr.split(",").map(Number);
          for (const { dir: [dq, dr] } of HEX_EDGES) {
            const nk = tileKey(cq2 + dq, cr2 + dr);
            if (retreatVis.has(nk)) continue;
            const nt = aiCtx.tileMap.get(nk);
            if (!nt || nt.terrain === "mountain") continue;
            if (aiCtx.entities.has(nk)) continue;
            retreatVis.add(nk);
            retreatPrev.set(nk, curr);
            if (nt.owner === aiOwner && nt.terrain !== "lake") {
              retreatTarget = nk;
              break bfsLakeRetreat;
            }
            retreatQ.push(nk);
          }
        }
        if (retreatTarget) {
          let firstStep = retreatTarget;
          while (retreatPrev.get(firstStep) !== uk) {
            const p = retreatPrev.get(firstStep);
            if (!p) break;
            firstStep = p;
          }
          actionTaken = await exec.move(uk, firstStep);
        } else {
          exec.markSpent(uk);
        }
      }
    }

    // ══ PRIORITY 1 (DEFENDING): Attack to split stronger enemy's territory ══
    if (!actionTaken && currAiState === "defending" && strongerEnemy) {
      const eOwner = strongerEnemy.owner;
      type SplitCand = { fk: string; tk: string; score: number; neg: boolean; oneHex: boolean };
      const cands: SplitCand[] = [];
      for (const [uk, ue] of availUnits) {
        const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? 3);
        for (const mk of vm) {
          const mt = aiCtx.tileMap.get(mk);
          if (!mt || mt.owner !== eOwner) continue;
          const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
          if (ENTITY_META[ue].strength <= zoc) continue;
          if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength, aiCtx)) continue;
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
              if (t.owner !== eOwner || t.terrain === "mountain") return false;
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
          const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? 3);
          for (const mk of vm) {
            const mt = aiCtx.tileMap.get(mk);
            if (!mt || mt.owner !== eOwner) continue;
            const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
            if (ENTITY_META[ue].strength <= zoc) continue;
            if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength, aiCtx)) continue;
            const simMap = new Map(aiCtx.tileMap);
            simMap.set(mk, { ...mt, owner: aiOwner });
            let totalSz = 0;
            const vis2 = new Set<string>();
            for (const t of Array.from(simMap.values())) {
              if (t.owner !== eOwner || vis2.has(t.key)) continue;
              const comp = getContiguousTerritory(simMap, t.key, eOwner);
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
        for (const uType of (["simple_unit", "advanced_unit", "expert_unit"] as EntityType[])) {
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
            return e === "advanced_unit" || e === "expert_unit";
          })) continue;
          const rawPlacements = currTerr.filter((t) => {
            if (t.terrain === "mountain" || t.terrain === "lake") return false;
            if (aiCtx.entities.has(t.key)) return false;
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
            return e === "advanced_unit" || e === "expert_unit";
          })) continue;
          const rawPlacements = currTerr.filter((t) => {
            if (t.terrain === "mountain" || t.terrain === "lake") return false;
            if (aiCtx.entities.has(t.key)) return false;
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
        const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? 3);
        for (const mk of vm) {
          const mt = aiCtx.tileMap.get(mk);
          if (!mt || mt.owner === aiOwner || mt.owner === "neutral") continue;
          const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
          if (ENTITY_META[ue].strength <= zoc) continue;
          if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength, aiCtx)) continue;
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
              if (t.owner === aiOwner || t.owner === "neutral" || t.terrain === "mountain") return false;
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
            const sz = otherKey ? getContiguousTerritory(aiCtx.tileMap, otherKey, aiOwner).length : 0;
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
            const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? 3);
            if (!vm.has(bridge.tile)) continue;
            actionTaken = await exec.move(uk, bridge.tile);
          }
          if (!actionTaken) {
            const mergeB = dtFindMergeMove(zoc + 1, new Set([bridge.tile]), availUnits, aiCtx);
            if (mergeB) actionTaken = await exec.move(mergeB.from, mergeB.to);
          }
          if (!actionTaken) {
            for (const uType of (["simple_unit", "advanced_unit", "expert_unit"] as EntityType[])) {
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
          return getContiguousTerritory(aiCtx.tileMap, nk, nt.owner as TerritoryOwner).length >= 2;
        });
      });
      if (undefBorder.length > 0) {
        const innerCands = currTerr.filter((t) => {
          if (t.terrain === "mountain" || t.terrain === "lake") return false;
          if (aiCtx.entities.has(t.key)) return false;
          if (currBorderTiles.some((bt) => bt.key === t.key)) return false;
          const [tq, tr] = t.key.split(",").map(Number);
          return undefBorder.some((bt) => {
            const [bq, br] = bt.key.split(",").map(Number);
            return hexDistance(tq, tr, bq, br) === 1;
          });
        });
        const borderCands = undefBorder.filter((t) => {
          if (t.terrain === "mountain" || t.terrain === "lake") return false;
          return !aiCtx.entities.has(t.key);
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
            return e === "advanced_unit" || e === "expert_unit";
          })) continue;
          actionTaken = await exec.build(bType, placementsC[0].key, bCost);
        }
      }
    }

    // ══ PRIORITY D: Build a city ══
    if (!actionTaken) {
      const cityCost = ENTITY_META.city.cost;
      const alreadyHasCity = currTerr.some((t) => aiCtx.cities.has(t.key));
      if (canAfford(cityCost, 0) && currTerr.length >= 6 && !alreadyHasCity) {
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
          const comp = getContiguousTerritory(aiCtx.tileMap, t.key, t.owner as TerritoryOwner);
          for (const ct of comp) visLarge.add(ct.key);
          if (comp.length > largestEnemySz) { largestEnemySz = comp.length; largestEnemyKey = t.key; }
        }
        const [lEq, lEr] = largestEnemyKey ? largestEnemyKey.split(",").map(Number) : [0, 0];
        const cityCands = currTerr.filter((t) => {
          if (t.terrain === "mountain" || t.terrain === "lake" || aiCtx.cities.has(t.key)) return false;
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

    // ══ PRIORITY E: Border expansion ══
    if (!actionTaken) {
      const entityAttacks: { fk: string; tk: string; eStr: number; aStr: number; oneHex: boolean; neg: boolean; score: number }[] = [];
      for (const [uk, ue] of availUnits) {
        const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? 3);
        for (const mk of vm) {
          const mt = aiCtx.tileMap.get(mk);
          if (!mt || mt.owner === aiOwner || mt.owner === "neutral") continue;
          const me = aiCtx.entities.get(mk);
          if (!me || me === "rebel") continue;
          const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
          if (ENTITY_META[ue].strength <= zoc) continue;
          if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength, aiCtx)) continue;
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
        for (const uType of (["expert_unit", "advanced_unit", "simple_unit"] as EntityType[])) {
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
              if (nt.terrain === "lake" && !dtLakeHasSplitOpportunity(nk, str, aiCtx)) continue;
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
          const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? 3);
          for (const mk of vm) {
            const mt = aiCtx.tileMap.get(mk);
            if (!mt || mt.owner === aiOwner || mt.owner === "neutral") continue;
            const me = aiCtx.entities.get(mk);
            if (me && me !== "rebel") continue;
            const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
            if (ENTITY_META[ue].strength <= zoc) continue;
            if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength, aiCtx)) continue;
            const sz = getContiguousTerritory(aiCtx.tileMap, mk, mt.owner as TerritoryOwner).length;
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
                if (t.owner === aiOwner || t.owner === "neutral" || t.terrain === "mountain") return false;
                const me = aiCtx.entities.get(t.key);
                return !me || me === "rebel";
              })
              .map((t) => t.key),
          );
          const mergeE2 = dtFindMergeMove(1, e2Targets, availUnits, aiCtx);
          if (mergeE2) actionTaken = await exec.move(mergeE2.from, mergeE2.to);
        }
        if (!actionTaken) {
          for (const uType of (["simple_unit", "advanced_unit", "expert_unit"] as EntityType[])) {
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
                if (nt.terrain === "lake" && !dtLakeHasSplitOpportunity(nk, str, aiCtx)) continue;
                const zoc = getMaxEnemyZoC(nk, aiOwner, aiCtx.entities, aiCtx.tileMap);
                if (str > zoc) {
                  const sz = getContiguousTerritory(aiCtx.tileMap, nk, nt.owner as TerritoryOwner).length;
                  if (!best || sz > best.sz) best = { tile: nk, sz };
                }
              }
            }
            if (best) actionTaken = await exec.buy(uType, best.tile, cost, true);
          }
        }
      }

      if (!actionTaken) {
        const neutralPrio = (t: HexTile): number => aiCtx.cities.has(t.key) ? 3 : (t.terrain === "grass" || t.terrain === "forest") ? 2 : 1;
        const neutralMoves: { fk: string; tk: string; prio: number }[] = [];
        for (const [uk, ue] of availUnits) {
          const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? 3);
          for (const mk of vm) {
            const mt = aiCtx.tileMap.get(mk);
            if (!mt || mt.owner !== "neutral") continue;
            const zoc = getMaxEnemyZoC(mk, aiOwner, aiCtx.entities, aiCtx.tileMap);
            if (ENTITY_META[ue].strength <= zoc) continue;
            if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength, aiCtx)) continue;
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
          for (const uType of (["simple_unit", "advanced_unit", "expert_unit"] as EntityType[])) {
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
                if (nt.terrain === "lake" && !dtLakeHasSplitOpportunity(nk, str, aiCtx)) continue;
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
        (t) => t.owner !== aiOwner && t.owner !== "neutral" && t.terrain !== "mountain" && t.terrain !== "lake",
      );
      for (const [uk, ue] of availUnits) {
        if (actionTaken) break;
        const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? 3);
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
          const vm = getValidMoves(uk, aiOwner, aiCtx.entities, aiCtx.tileMap, aiCtx.spentUnits, aiCtx.partialMoves.get(uk) ?? 3);
          if (!vm.has(rt.key)) continue;
          actionTaken = await exec.move(uk, rt.key);
          break;
        }
      }
      if (!actionTaken) {
        for (const rt of rebelTiles) {
          if (actionTaken) break;
          const cost = ENTITY_META.simple_unit.cost;
          const upk = ENTITY_META.simple_unit.upkeep;
          const rtIncome = (TERRAIN_INCOME[rt.terrain] ?? 0) + (aiCtx.cities.has(rt.key) ? CITY_BONUS : 0);
          if (currBal >= cost && currIncome + rtIncome - (currUpkeep + upk) >= 0) {
            actionTaken = await exec.buy("simple_unit", rt.key, cost, false);
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

    if (!actionTaken) break;
  }
}

// ─── AI Turn Orchestration ────────────────────────────────────────────────────

/**
 * Mutable working state shared between the orchestrator and exec callbacks.
 * Passed by reference so reassignment (e.g. `ws.tileMap = new Map(ws.tileMap)`)
 * is visible to all holders of the object.
 */
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
  freeTowerUsed: Map<TerritoryOwner, Set<string>>;
  lakeFunds: Map<string, number>;
}

/**
 * React-layer callbacks injected by game.tsx so that aiStrategy.ts stays free
 * of direct React imports.  Every setter mirrors the corresponding useState/useRef
 * value in game.tsx.
 */
export interface AiTurnCallbacks {
  setEntities(v: Map<string, EntityType>): void;
  setMutableTileMap(v: Map<string, HexTile>): void;
  setTerritoryBalances(v: Map<string, number>): void;
  setGraveyard(v: Set<string>): void;
  setRuins(v: Set<string>): void;
  setLiveOwnerMap(v: Map<string, TerritoryOwner>): void;
  setCities(v: Set<string>): void;
  setFreeTowerUsedTiles(v: Map<TerritoryOwner, Set<string>>): void;
  setAiStateMap(v: Map<string, AiState>): void;
  setLakeUnitFunds(v: Map<string, number>): void;
  /** Push the initial pre-AI snapshot and reset history index to 0. */
  initStepHistory(snap: AiStepSnapshot): void;
  /** Append a step snapshot, then pause in dev-mode or wait the animation delay. */
  awaitStep(snap: AiStepSnapshot): Promise<void>;
  /** Dev-mode pause before the first AI action; no-op in normal play. */
  awaitPreAiResume(): Promise<void>;
  /** Dev-mode pause after all AI actions; no-op in normal play. */
  awaitPostAiResume(): Promise<void>;
  getAiStateMapRef(): Map<string, AiState>;
  setAiStateMapRef(v: Map<string, AiState>): void;
  isTurnActive(): boolean;
  isDeveloperMode(): boolean;
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
  setIsAiTurn(v: boolean): void;
  setAiTurnRef(v: boolean): void;
  checkWinLoss(map: Map<string, HexTile>): void;
}

/** Build an AiStepSnapshot from the current working state (deep copy). */
function snapFromWs(ws: AiWorkingState): AiStepSnapshot {
  return {
    entities: new Map(ws.entities),
    mutableTileMap: new Map(ws.tileMap),
    territoryBalances: new Map(ws.balances),
    liveOwnerMap: new Map(ws.liveOwnerMap),
    graveyard: new Set(ws.graveyard),
    freeTowerUsedTiles: new Map(
      [...ws.freeTowerUsed.entries()].map(([k, v]) => [k, new Set(v)]),
    ),
  };
}

/**
 * Full AI turn orchestrator. Extracted from the game.tsx useCallback so that
 * the decision loop, exec callbacks, free-tower logic, and bankruptcy check can
 * be tested and maintained independently.
 *
 * `ws` is mutated in-place throughout; `cbs` forwards every React state change
 * back to game.tsx.
 */
export async function runAiTurn(
  ws: AiWorkingState,
  cbs: AiTurnCallbacks,
  aiOwners: TerritoryOwner[],
  currentTurn: number,
  difficulty: Difficulty,
): Promise<void> {
  // Snapshot state BEFORE any AI action so the user can step back to the start of AI's turn
  cbs.initStepHistory(snapFromWs(ws));

  // Dev mode: pause at index 0 so user sees the pre-AI state before the first action runs
  await cbs.awaitPreAiResume();

  for (const aiOwner of aiOwners) {
    if (!cbs.isTurnActive()) return;

    const visited = new Set<string>();
    const aiTiles = Array.from(ws.tileMap.values()).filter(
      (t) => t.owner === aiOwner,
    );
    if (aiTiles.length === 0) continue;

    for (const startTile of aiTiles) {
      if (visited.has(startTile.key)) continue;
      const territory = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner);
      for (const t of territory) visited.add(t.key);
      const territoryId = getTerritoryId(territory);
      if (!territoryId) continue;

      // Free tower: each territory with ≥2 tiles may build one free tower, round 1 only
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
            cbs.setFreeTowerUsedTiles(new Map(ws.freeTowerUsed));
            cbs.setEntities(new Map(ws.entities));
            cbs.setAiStateMap(new Map(cbs.getAiStateMapRef()));
            await cbs.awaitStep(snapFromWs(ws));
            if (!cbs.isTurnActive()) return;
          }
        }
      }

      // Round 1: only the free tower is allowed — no other purchases
      if (currentTurn === 1) continue;

      // ─── Decision Tree Helpers ─────────────────────────────────────────────
      // aiCtx uses getters so it always reads the current ws property,
      // even after reassignment (e.g. ws.tileMap = new Map(...)).
      const aiCtx: AiContext = {
        get tileMap() { return ws.tileMap; },
        get entities() { return ws.entities; },
        get balances() { return ws.balances; },
        get cities() { return ws.cities; },
        get spentUnits() { return ws.spentUnits; },
        get partialMoves() { return ws.partialMoves; },
        get aiOwner() { return aiOwner; },
      };

      const dtAwait = async (): Promise<void> => {
        await cbs.awaitStep(snapFromWs(ws));
      };

      const dtPublishState = (anchorKey: string): void => {
        const updTerr = getContiguousTerritory(ws.tileMap, anchorKey, aiOwner);
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
        const nextStateMap = new Map(cbs.getAiStateMapRef());
        nextStateMap.set(updId, updThreatened ? "defending" : "attacking");
        cbs.setAiStateMapRef(nextStateMap);
        cbs.setAiStateMap(new Map(nextStateMap));
      };

      // Execute a unit move (fromKey → toKey); updates all working state and triggers animation
      const dtExecMove = async (fromKey: string, toKey: string): Promise<boolean> => {
        if (!cbs.isTurnActive()) return false;
        const unitEntity = ws.entities.get(fromKey);
        if (!unitEntity) return false;
        const destTile = ws.tileMap.get(toKey);
        if (!destTile) return false;
        const srcTile = ws.tileMap.get(fromKey);
        const movingFromLake = srcTile?.terrain === "lake";
        const movingToLake = destTile.terrain === "lake";
        const previousOwner = destTile.owner as TerritoryOwner;
        const prevTileMapSnapshot = new Map(ws.tileMap);

        // Pre-check: ensure enough balance for lake transfer (2× upkeep) before mutating state
        if (movingToLake && !movingFromLake) {
          const srcTerrPre = getContiguousTerritory(prevTileMapSnapshot, fromKey, aiOwner);
          const srcIdPre = getTerritoryId(srcTerrPre);
          if (srcIdPre) {
            const unitUpkPre = ENTITY_META[unitEntity].upkeep;
            const srcBalPre = ws.balances.get(srcIdPre) ?? 0;
            if (srcBalPre < unitUpkPre * 2) return false;
          } else {
            return false;
          }
        }

        ws.tileMap = new Map(ws.tileMap);
        ws.tileMap.set(toKey, { ...destTile, owner: aiOwner });
        ws.entities = new Map(ws.entities);

        const destExisting = ws.entities.get(toKey);
        const isAllyMerge =
          destExisting &&
          ENTITY_META[destExisting].isUnit &&
          destTile.owner === aiOwner &&
          ENTITY_META[unitEntity].strength + ENTITY_META[destExisting].strength <= 3;

        if (isAllyMerge) {
          const merged = mergedUnitType(
            ENTITY_META[unitEntity].strength,
            ENTITY_META[destExisting].strength,
          );
          ws.entities.delete(fromKey);
          ws.entities.set(toKey, merged);
        } else {
          ws.entities.delete(toKey);
          ws.entities.delete(fromKey);
          ws.entities.set(toKey, unitEntity);
        }

        ws.spentUnits = new Set(ws.spentUnits);
        if (isAllyMerge) {
          ws.spentUnits.add(fromKey);
        } else {
          ws.spentUnits.add(toKey);
        }

        // Track partial movement: merged unit inherits the MIN remaining range of both units.
        {
          const stepsUsed = getMoveCost(fromKey, toKey, prevTileMapSnapshot);
          const prevRemaining = ws.partialMoves.get(fromKey) ?? 3;
          const remainingAfterMove = movingToLake ? 0 : Math.max(0, prevRemaining - stepsUsed);
          ws.partialMoves = new Map(ws.partialMoves);
          ws.partialMoves.delete(fromKey);
          if (isAllyMerge) {
            const destRemaining = ws.partialMoves.get(toKey) ?? 3;
            const mergedRemaining = Math.min(remainingAfterMove, destRemaining);
            ws.partialMoves.delete(toKey);
            if (mergedRemaining < 3) ws.partialMoves.set(toKey, mergedRemaining);
          } else {
            ws.partialMoves.delete(toKey);
            if (remainingAfterMove < 3) ws.partialMoves.set(toKey, remainingAfterMove);
          }
        }

        ws.lakeFunds = new Map(ws.lakeFunds);
        if (movingToLake && !movingFromLake) {
          const srcTerrLake = getContiguousTerritory(prevTileMapSnapshot, fromKey, aiOwner);
          const srcIdLake = getTerritoryId(srcTerrLake);
          if (srcIdLake) {
            const lakeAmount = ENTITY_META[unitEntity].upkeep * 2;
            ws.balances = new Map(ws.balances);
            ws.balances.set(srcIdLake, (ws.balances.get(srcIdLake) ?? 0) - lakeAmount);
            ws.lakeFunds.set(toKey, lakeAmount);
          }
        } else if (movingFromLake && movingToLake) {
          const fund = ws.lakeFunds.get(fromKey) ?? 0;
          ws.lakeFunds.delete(fromKey);
          ws.lakeFunds.set(toKey, fund);
          ws.tileMap.set(fromKey, { ...srcTile!, owner: "neutral" });
          ws.liveOwnerMap = new Map(ws.liveOwnerMap);
          ws.liveOwnerMap.delete(fromKey);
        } else if (movingFromLake && !movingToLake) {
          const fund = ws.lakeFunds.get(fromKey) ?? 0;
          ws.lakeFunds.delete(fromKey);
          ws.tileMap.set(fromKey, { ...srcTile!, owner: "neutral" });
          ws.liveOwnerMap = new Map(ws.liveOwnerMap);
          ws.liveOwnerMap.delete(fromKey);
          ws.balances = cbs.recalculateTerritoriesForCapture(
            toKey, aiOwner, previousOwner, prevTileMapSnapshot, ws.tileMap, ws.balances,
          );
          if (fund > 0) {
            const newTerr = getContiguousTerritory(ws.tileMap, toKey, aiOwner);
            const newId = getTerritoryId(newTerr);
            if (newId) {
              ws.balances = new Map(ws.balances);
              ws.balances.set(newId, (ws.balances.get(newId) ?? 0) + fund);
            }
          }
        } else {
          ws.balances = cbs.recalculateTerritoriesForCapture(
            toKey, aiOwner, previousOwner, prevTileMapSnapshot, ws.tileMap, ws.balances,
          );
        }

        ws.liveOwnerMap = new Map(ws.liveOwnerMap);
        ws.liveOwnerMap.set(toKey, aiOwner);
        ws.graveyard = new Set(ws.graveyard);
        ws.graveyard.delete(toKey);
        cbs.applySingleHexPenalty(
          prevTileMapSnapshot, ws.tileMap, ws.balances, ws.entities,
          ws.graveyard, ws.ruins,
          movingFromLake && !movingToLake ? toKey : undefined,
        );
        cbs.setRuins(new Set(ws.ruins));

        if (!cbs.isDeveloperMode()) {
          await new Promise<void>((resolve) => {
            cbs.triggerUnitAnimation(fromKey, toKey, unitEntity, aiOwner as TerritoryOwner, true, () => {
              cbs.setMutableTileMap(new Map(ws.tileMap));
              cbs.setLiveOwnerMap(new Map(ws.liveOwnerMap));
              cbs.setEntities(new Map(ws.entities));
              cbs.setTerritoryBalances(new Map(ws.balances));
              cbs.setGraveyard(new Set(ws.graveyard));
              resolve();
            });
          });
        } else {
          cbs.setMutableTileMap(new Map(ws.tileMap));
          cbs.setLiveOwnerMap(new Map(ws.liveOwnerMap));
          cbs.setEntities(new Map(ws.entities));
          cbs.setTerritoryBalances(new Map(ws.balances));
          cbs.setGraveyard(new Set(ws.graveyard));
        }

        dtPublishState(toKey);
        await dtAwait();
        return true;
      };

      // Execute a buy action: place unitType at target
      // outside=true means target is outside the territory (direct capture attack)
      const dtExecBuy = async (
        unitType: EntityType, target: string, cost: number, outside: boolean,
      ): Promise<boolean> => {
        if (!cbs.isTurnActive()) return false;
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
          const buyTerr = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner);
          const buyTid = getTerritoryId(buyTerr);
          if (buyTid) ws.balances.set(buyTid, (ws.balances.get(buyTid) ?? 0) - cost);
          if (wasRebel) {
            ws.spentUnits = new Set(ws.spentUnits);
            ws.spentUnits.add(target);
          }
        } else {
          const previousOwner = (ws.tileMap.get(target)?.owner ?? "neutral") as TerritoryOwner;
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
          ws.balances = cbs.recalculateTerritoriesForCapture(
            target, aiOwner, previousOwner, prevSnapshot, ws.tileMap, ws.balances,
          );
          const mergedTerr = getContiguousTerritory(ws.tileMap, target, aiOwner);
          const mergedId = getTerritoryId(mergedTerr);
          if (mergedId) ws.balances.set(mergedId, (ws.balances.get(mergedId) ?? 0) - cost);
          cbs.applySingleHexPenalty(prevSnapshot, ws.tileMap, ws.balances, ws.entities, ws.graveyard, ws.ruins);
          cbs.setRuins(new Set(ws.ruins));
          ws.liveOwnerMap = new Map(ws.liveOwnerMap);
          ws.liveOwnerMap.set(target, aiOwner);
          ws.spentUnits = new Set(ws.spentUnits);
          ws.spentUnits.add(target);
          cbs.setMutableTileMap(new Map(ws.tileMap));
          cbs.setLiveOwnerMap(new Map(ws.liveOwnerMap));
        }

        cbs.setEntities(new Map(ws.entities));
        cbs.setCities(new Set(ws.cities));
        cbs.setTerritoryBalances(new Map(ws.balances));
        cbs.setAiStateMap(new Map(cbs.getAiStateMapRef()));
        await dtAwait();
        return true;
      };

      // Execute a building upgrade (change entity on tile in place)
      const dtExecUpgrade = async (targetKey: string, to: EntityType, cost: number): Promise<boolean> => {
        if (!cbs.isTurnActive()) return false;
        ws.entities = new Map(ws.entities);
        ws.entities.set(targetKey, to);
        ws.balances = new Map(ws.balances);
        const buyTerr = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner);
        const buyTid = getTerritoryId(buyTerr);
        if (buyTid) ws.balances.set(buyTid, (ws.balances.get(buyTid) ?? 0) - cost);
        cbs.setEntities(new Map(ws.entities));
        cbs.setTerritoryBalances(new Map(ws.balances));
        await dtAwait();
        return true;
      };

      // Build a building inside the territory (no ownership change)
      const dtExecBuild = async (buildingType: EntityType, targetKey: string, cost: number): Promise<boolean> => {
        if (!cbs.isTurnActive()) return false;
        ws.balances = new Map(ws.balances);
        if (buildingType === "city") {
          ws.cities = new Set(ws.cities);
          ws.cities.add(targetKey);
        } else {
          ws.entities = new Map(ws.entities);
          ws.entities.set(targetKey, buildingType);
        }
        const buyTerr = getContiguousTerritory(ws.tileMap, startTile.key, aiOwner);
        const buyTid = getTerritoryId(buyTerr);
        if (buyTid) ws.balances.set(buyTid, (ws.balances.get(buyTid) ?? 0) - cost);
        cbs.setEntities(new Map(ws.entities));
        cbs.setCities(new Set(ws.cities));
        cbs.setTerritoryBalances(new Map(ws.balances));
        await dtAwait();
        return true;
      };

      // Remove a building (Priority H)
      const dtExecRemove = async (targetKey: string): Promise<boolean> => {
        if (!cbs.isTurnActive()) return false;
        ws.entities = new Map(ws.entities);
        ws.entities.delete(targetKey);
        cbs.setEntities(new Map(ws.entities));
        cbs.setTerritoryBalances(new Map(ws.balances));
        await dtAwait();
        return true;
      };

      const markSpent = (key: string): void => {
        ws.spentUnits = new Set(ws.spentUnits);
        ws.spentUnits.add(key);
      };

      const setTerritoryState = (tid: string, state: AiState): void => {
        const next = new Map(cbs.getAiStateMapRef());
        next.set(tid, state);
        cbs.setAiStateMapRef(next);
        cbs.setAiStateMap(new Map(next));
      };

      // ─── Decision Tree Loop ────────────────────────────────────────────────
      await runAiTerritoryDecisionLoop(
        startTile.key,
        aiCtx,
        {
          move: dtExecMove,
          buy: dtExecBuy,
          upgrade: dtExecUpgrade,
          build: dtExecBuild,
          remove: dtExecRemove,
          markSpent,
          setTerritoryState,
        },
        () => cbs.isTurnActive(),
        difficulty,
      );
    }
  }

  // ── Player bankruptcy check after all AI moves ─────────────────────────────
  if (currentTurn !== 1) {
    const playerVisited = new Set<string>();
    let playerBankruptcyOccurred = false;
    for (const tile of Array.from(ws.tileMap.values())) {
      if (tile.owner !== "player" || playerVisited.has(tile.key)) continue;
      if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
      const territory = getContiguousTerritory(ws.tileMap, tile.key, "player");
      for (const t of territory) playerVisited.add(t.key);
      const territoryId = getTerritoryId(territory);
      if (!territoryId) continue;
      const income = territory.reduce((s, t) => {
        if (ws.entities.get(t.key) === "rebel") return s;
        return (
          s +
          TERRAIN_INCOME[t.terrain] +
          (ws.cities.has(t.key) ? CITY_BONUS : 0)
        );
      }, 0);
      const upkeep = calcTerritoryUpkeep(territory, ws.entities);
      const current = ws.balances.get(territoryId) ?? 0;
      const delta = income - upkeep;
      const newBalance = current + delta;
      if (newBalance < 0) {
        playerBankruptcyOccurred = true;
        ws.balances = new Map(ws.balances);
        ws.balances.set(territoryId, 0);
        ws.entities = new Map(ws.entities);
        let unitUpkeepSaved = 0;
        for (const t of territory) {
          const e = ws.entities.get(t.key);
          if (e && ENTITY_META[e].isUnit) {
            unitUpkeepSaved += ENTITY_META[e].upkeep;
            ws.entities.delete(t.key);
            ws.graveyard = new Set(ws.graveyard);
            ws.graveyard.add(t.key);
          }
        }
        if (delta + unitUpkeepSaved < 0) {
          for (const t of territory) {
            const e = ws.entities.get(t.key);
            if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
              ws.entities.delete(t.key);
              ws.ruins = new Set(ws.ruins);
              ws.ruins.add(t.key);
            }
          }
        }
      }
    }
    if (playerBankruptcyOccurred) {
      cbs.setEntities(new Map(ws.entities));
      cbs.setTerritoryBalances(new Map(ws.balances));
      cbs.setGraveyard(new Set(ws.graveyard));
      cbs.setRuins(new Set(ws.ruins));
    }
  }

  cbs.setLakeUnitFunds(new Map(ws.lakeFunds));
  await cbs.awaitPostAiResume();
  cbs.setIsAiTurn(false);
  cbs.setAiTurnRef(false);
  cbs.checkWinLoss(ws.tileMap);
}
