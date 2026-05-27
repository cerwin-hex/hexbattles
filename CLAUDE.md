# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

```bash
# Typecheck entire workspace (always run from root)
pnpm run typecheck

# Build all packages (runs typecheck first)
pnpm run build

# Run all tests (hex-battles vitest)
pnpm test

# Run a single test file
pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts

# Run hex-battles dev server (Expo)
pnpm --filter @workspace/hex-battles run dev

# Run API server in dev mode
pnpm --filter @workspace/api-server run dev

# Push DB schema changes (dev only)
pnpm --filter @workspace/db run push

# Regenerate API client + Zod schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

## Monorepo Structure

pnpm workspaces with TypeScript composite projects. Every package extends `tsconfig.base.json` (composite: true, bundler resolution, es2022). **Always typecheck from root** — running `tsc` inside a single package fails if its dependencies haven't been built.

```
artifacts/hex-battles/    # Main game — Android-first Expo React Native app
artifacts/api-server/     # Express 5 API server (esbuild CJS bundle)
lib/api-spec/             # OpenAPI spec + Orval codegen config
lib/api-client-react/     # Generated React Query hooks (from OpenAPI)
lib/api-zod/              # Generated Zod schemas (from OpenAPI)
lib/db/                   # Drizzle ORM schema + PostgreSQL connection
scripts/                  # One-off .ts utility scripts
```

## Hex Battles App Architecture (`artifacts/hex-battles`)

Android-first turn-based hexagonal strategy game. Package name: `dk.hextek.hexbattles`. Built with Expo Router (file-based navigation), React Native SVG for the board, and Reanimated for animations.

### Screen layout

- `app/index.tsx` — Main menu (tile count, opponent count, difficulty)
- `app/game.tsx` — Game screen; owns all mutable game state as React useState; orchestrates everything
- `app/_layout.tsx` — Stack navigation, font loading (Cinzel + Inter)

### State and logic separation

All game state lives in `app/game.tsx` as React state: `mutableTileMap`, `entities`, `territoryBalances`, `spentUnits`, `combatSpentUnits`, `partialMoves`, `liveOwnerMap`, `cities`, `graveyard`, `ruins`, `turn`, `isAiTurn`, `gameResult`, `selectedTileKey`, `selectedEntityKey`, `armedEntityId`.

Pure logic is extracted into:
- `logic/gameLogic.ts` — Economy calculations (`calcTerritoryUpkeep`, `applySingleHexPenalty`), unit merging
- `logic/tileTapHandler.ts` — Player tap resolution (move, attack, buy, build)
- `logic/endTurnHandler.ts` — End-of-turn income, upkeep, rebel spawning, AI handoff
- `logic/aiStrategy.ts` — AI decision loop (`runAiTerritoryDecisionLoop`) — async, per-territory
- `logic/aiHelpers.ts` — Decision-tree helpers (`dtSplitScore`, `dtFindMergeMove`, etc.)
- `logic/winLossChecker.ts` — Win/loss detection

### Rendering pipeline

`game.tsx` composes a stack of SVG layers rendered in order:
1. `HexTileLayer` — terrain fills
2. `LakeImageLayer` / `MountainImageLayer` — image overlays for water/mountain tiles
3. `AffordableTerritoryLayer` — green affordability highlights
4. `MovementHighlightLayer` — reachable-tile highlights
5. `BorderEdgeLayer` — inset territory borders (via `utils/borderEdges.ts`)
6. `CityOverlayLayer` — neutral stone ring around cities
7. `BridgeOverlayLayer` — bridge visuals on lake tiles
8. `IdleUnitLayer` — static units (memoized per tile)
9. `EntityLayer` — selected/moving unit overlays
10. `FortificationDotLayer` — tower/castle strength dots
11. `GraveyardLayer` — skull markers
12. `AnimatedMovingUnit` — in-flight move animation

Layer re-rendering is controlled by custom equality functions in `components/layerEquality.ts` to avoid unnecessary SVG redraws.

### Hex coordinate system

Flat-top axial coordinates (q, r). Core math lives in `utils/hexMath.ts`:
- `tileKey(q, r)` — canonical string key `"q,r"` used as Map key throughout
- `HEX_EDGES` — 6 axial directions with vertex pairs for border drawing
- `hexDistance(a, b)` — axial distance

Grid generation and all game rules (entity metadata, terrain income, movement costs, territory contiguity, ZoC) are in `utils/hexGrid.ts`. `ENTITY_META` is the single source of truth for unit/building costs and upkeep.

### Economy model

- Income per tile: `TERRAIN_INCOME` (grass/forest=2, desert=1, mountain/lake=0) + `CITY_BONUS=2` per city
- Unit upkeep: flat per-unit value from `ENTITY_META`
- Defense upkeep: **linear scaling** — n-th tower costs `n`, n-th castle costs `5n` (not flat). Use `calcDefenseUpkeep` / `nextDefenseUpkeep` from `hexGrid.ts`
- Territory split penalty: isolated single-hex territories are penalized each end-of-turn via `applySingleHexPenalty`

### AI turn flow

`useAiTurnCallbacks` hook (in `hooks/useAiTurnCallbacks.ts`) exposes `runAiTurn`. When the player presses End Turn, `endTurnHandler.ts` triggers `runAiTurn` for each AI owner in sequence. Each AI runs `runAiTerritoryDecisionLoop` (async, up to 100 iterations per territory). The `AiDecisionExec` interface bridges the loop back to React state setters in `game.tsx`.

### Google Play build

See `artifacts/hex-battles/PLAY_STORE_BUILD.md`. EAS handles cloud builds:
- Preview APK: `eas build --platform android --profile preview`
- Production AAB: `eas build --platform android --profile production`
- Bump `versionCode` in `app.json` for every Play Store release.

## Package Management

Use `pnpm` exclusively (enforced by preinstall hook). New packages must be at least 1 day old before installation (`minimumReleaseAge: 1440` in `pnpm-workspace.yaml`) — this is a supply-chain defense, do not disable it. Use the `catalog:` protocol in `pnpm-workspace.yaml` for shared version pinning across packages.

## Working Style

- **All game code must be in English** — variable names, comments, string literals in logic, type names, everything. The user may communicate in Danish; code must always be English.
- **Act without asking for permission** — proceed autonomously on all implementation decisions. Only stop to ask when there is a genuine, non-obvious choice that changes scope or direction and that the user must decide.
- **Never push to GitHub unless explicitly asked** — the user is conserving free GitHub Actions minutes and bundles commits before pushing to production manually. Commit freely when asked, but do not run `git push` (or equivalent) without an explicit request.
