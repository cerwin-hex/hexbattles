import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
} from "docx";
import fs from "fs";
import path from "path";

// ─── Text helpers ────────────────────────────────────────────────────────────

const H1 = (text) =>
  new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 560, after: 140 } });

const H2 = (text) =>
  new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 100 } });

const H3 = (text) =>
  new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 260, after: 80 } });

const P = (...runs) =>
  new Paragraph({
    children: runs.map((r) =>
      typeof r === "string" ? new TextRun({ text: r, size: 22 }) : r,
    ),
    spacing: { after: 120 },
  });

const Bold   = (t) => new TextRun({ text: t, bold: true, size: 22 });
const Normal = (t) => new TextRun({ text: t, size: 22 });
const Italic = (t) => new TextRun({ text: t, italics: true, size: 22, color: "444444" });
const Sep = () => new Paragraph({ text: "", spacing: { after: 100 } });

const Note = (text) =>
  new Paragraph({
    children: [new TextRun({ text: `ℹ  ${text}`, italics: true, size: 20, color: "446688" })],
    indent: { left: 360 },
    spacing: { before: 80, after: 140 },
  });

const Bullet = (text, level = 0) =>
  new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    bullet: { level },
    spacing: { after: 80 },
  });

const BulletB = (label, text) =>
  new Paragraph({
    children: [new TextRun({ text: label, bold: true, size: 22 }), new TextRun({ text, size: 22 })],
    bullet: { level: 0 },
    spacing: { after: 80 },
  });

const BulletSub = (text) =>
  new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    bullet: { level: 1 },
    spacing: { after: 70 },
  });

// ─── Table helpers — auto column widths (no fixed DXA) ──────────────────────

const CELL_BORDERS = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: "BBCCDD" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "BBCCDD" },
  left:   { style: BorderStyle.SINGLE, size: 4, color: "BBCCDD" },
  right:  { style: BorderStyle.SINGLE, size: 4, color: "BBCCDD" },
};

const makeCell = (text, isHeader = false) =>
  new TableCell({
    borders: CELL_BORDERS,
    shading: isHeader ? { type: ShadingType.SOLID, color: "D6E4F0" } : undefined,
    margins: { top: 80, bottom: 80, left: 160, right: 160 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: String(text), bold: isHeader, size: isHeader ? 20 : 20 })],
        spacing: { before: 0, after: 0 },
      }),
    ],
  });

const makeRow = (cells, isHeader = false) =>
  new TableRow({
    tableHeader: isHeader,
    children: cells.map((c) => makeCell(c, isHeader)),
  });

const makeTable = (rows) =>
  new Table({
    rows: rows.map((r, i) => makeRow(r, i === 0)),
    width: { size: 100, type: WidthType.PCT },
    borders: {
      top:     { style: BorderStyle.SINGLE, size: 8, color: "5B9BD5" },
      bottom:  { style: BorderStyle.SINGLE, size: 8, color: "5B9BD5" },
      left:    { style: BorderStyle.SINGLE, size: 8, color: "5B9BD5" },
      right:   { style: BorderStyle.SINGLE, size: 8, color: "5B9BD5" },
      insideH: { style: BorderStyle.SINGLE, size: 4, color: "BBCCDD" },
      insideV: { style: BorderStyle.SINGLE, size: 4, color: "BBCCDD" },
    },
  });

// ─── Document ─────────────────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        quickFormat: true,
        run: { size: 36, bold: true, color: "1F4E79" },
        paragraph: {
          spacing: { before: 560, after: 140 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "5B9BD5" } },
        },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        quickFormat: true,
        run: { size: 28, bold: true, color: "2E74B5" },
        paragraph: { spacing: { before: 360, after: 100 } },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        quickFormat: true,
        run: { size: 24, bold: true, color: "5B9BD5" },
        paragraph: { spacing: { before: 260, after: 80 } },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
      },
      children: [

        // ══════════════════════════════════════════════════════
        // TITLE PAGE
        // ══════════════════════════════════════════════════════
        new Paragraph({
          children: [new TextRun({ text: "HEX BATTLES", bold: true, size: 64, color: "1F4E79" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "AI Strategy — Complete Reference Guide", italics: true, size: 30, color: "444466" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "How the computer opponent thinks, decides, and plays", size: 22, color: "888888" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
        }),

        // ══════════════════════════════════════════════════════
        // 1. OVERVIEW
        // ══════════════════════════════════════════════════════
        H1("1. Overview"),

        P("Hex Battles supports up to five AI factions (labelled AI 1 through AI 5). Every time the human player ends their turn, each AI faction takes its turn in sequence. The AI uses a priority-based decision system: it goes through a ranked list of possible actions and performs the first one that is valid. After each action the list is re-checked from the top — this continues until no further action is possible or up to 100 loops per territory."),
        Sep(),
        P("Each AI faction may control multiple separate territories on the map. Each territory is managed independently — the AI considers one territory at a time, applies its full decision process to it, then moves on to the next."),
        Sep(),

        // ══════════════════════════════════════════════════════
        // 2. GAME PIECES
        // ══════════════════════════════════════════════════════
        H1("2. Game Pieces"),

        H2("2.1  Units and Buildings"),
        P("Every tile can hold one entity: a unit (which can move and fight), a building (which is stationary and provides passive benefits), or a rebel. The table below shows all entity types with their key attributes."),
        Sep(),
        makeTable([
          ["Name",       "Type",      "Buy Cost", "Upkeep / Round", "Combat Strength", "Can Move?"],
          ["Peasant",    "Unit",      "10 gold",  "3",              "1",               "Yes"],
          ["Warrior",    "Unit",      "20 gold",  "9",              "2",               "Yes"],
          ["Swordsman",  "Unit",      "30 gold",  "27",             "3",               "Yes"],
          ["Tower",      "Building",  "15 gold",  "Progressive*",   "1",               "No"],
          ["Castle",     "Building",  "30 gold",  "Progressive*",   "2",               "No"],
          ["City",       "Building",  "10 gold",  "0",              "0",               "Special"],
          ["Rebel",      "Neutral",   "—",        "—",              "0",               "No"],
        ]),
        Sep(),
        Note("* Tower and Castle upkeep scales with the number already owned in the territory — see section 3.2."),
        Sep(),

        H2("2.2  Cities — Special Rules"),
        P("Cities are a special permanent building with several unique rules:"),
        Sep(),
        BulletB("Pre-placed at game start: ", "Several Cities are placed automatically in the middle of neutral areas when the map is generated. They are not built by any player — they are simply there from the beginning, waiting to be captured."),
        BulletB("Built by player or AI: ", "Players and AI can also build new Cities in large territories (6+ tiles) for 10 gold each, as long as the territory does not already contain one."),
        BulletB("One per territory: ", "A territory can only ever have one City."),
        BulletB("Never removed: ", "Cities cannot be demolished, cannot go to ruins, and are never destroyed by bankruptcy. Once a City is on the map, it stays there for the entire game."),
        BulletB("Units can enter a City: ", "Any unit can move onto a City tile to capture it. When this happens, the tile changes owner and the City building stays — but the capturing unit is consumed in the process (it does not come out the other side). This is the cost of capturing a City."),
        BulletB("Income bonus: ", "Each City adds +2 gold per round to its territory's income."),
        Sep(),

        H2("2.3  Terrain Types"),
        makeTable([
          ["Terrain",   "Income per Tile per Round", "Movement Cost",     "Notes"],
          ["Grassland", "+2 gold",                   "1 point",           "Standard terrain"],
          ["Forest",    "+2 gold",                   "2 points",          "Slower to traverse"],
          ["Desert",    "+1 gold",                   "1 point",           "Lower income"],
          ["Mountain",  "0",                         "Impassable",        "Cannot be entered"],
          ["Lake",      "0",                         "1 point (special)", "Special sea-crossing rules — see section 5.3"],
        ]),
        Sep(),
        Note("A City building on a tile adds +2 gold to that tile's income on top of the normal terrain income. There are no special 'City terrain tiles' — the +2 bonus always comes from the City building entity."),
        Sep(),

        H2("2.4  Unit Upgrades"),
        P("Units can be upgraded one tier at a time. You pay only the price difference between tiers."),
        Sep(),
        makeTable([
          ["Upgrade",                    "Additional Cost", "New Upkeep", "New Strength"],
          ["Peasant → Warrior",          "+10 gold",        "9 / round",  "2"],
          ["Warrior → Swordsman",        "+10 gold",        "27 / round", "3"],
        ]),
        Sep(),

        // ══════════════════════════════════════════════════════
        // 3. ECONOMY
        // ══════════════════════════════════════════════════════
        H1("3. Economy"),

        H2("3.1  Income"),
        P("At the end of each round, every territory earns gold based on the tiles it contains. The calculation is simple: add up the income of every tile in the territory. Rebel-occupied tiles contribute nothing — the rebel blocks the income from that tile until removed."),
        Sep(),

        H2("3.2  Upkeep"),
        P("Upkeep is the running cost of all units and buildings in a territory. If upkeep exceeds income, the territory runs a deficit and will eventually go bankrupt."),
        Sep(),
        BulletB("Units: ", "Each unit has a fixed upkeep per round (3 for Peasant, 9 for Warrior, 27 for Swordsman)."),
        BulletB("Towers: ", "The upkeep for towers is progressive. The first tower costs 1/round, the second costs 2/round extra (total 3), the third costs 3/round extra (total 6), and so on."),
        BulletB("Castles: ", "Castle upkeep works the same way but at five times the rate. The first castle costs 5/round, the second costs 10/round extra (total 15), and so on."),
        Sep(),

        makeTable([
          ["Tower Count",       "Total Tower Upkeep", "Castle Count",  "Total Castle Upkeep"],
          ["1",                 "1 / round",          "1",             "5 / round"],
          ["2",                 "3 / round",          "2",             "15 / round"],
          ["3",                 "6 / round",          "3",             "30 / round"],
          ["4",                 "10 / round",         "4",             "50 / round"],
          ["5",                 "15 / round",         "5",             "75 / round"],
        ]),
        Sep(),
        Note("The progressive upkeep makes stacking many defensive buildings in one territory increasingly expensive. The AI's building-removal logic (Priority H) exists specifically to avoid paying for buildings that are no longer useful."),
        Sep(),

        H2("3.3  Can the AI Afford a Purchase?"),
        P("Before any purchase — whether a unit, building, or upgrade — the AI checks two conditions simultaneously. Both must be true:"),
        Sep(),
        BulletB("Gold check: ", "The territory's current gold balance must cover the purchase price."),
        BulletB("Sustainability check: ", "After the purchase, the territory's income must still cover its total upkeep (including the new entity's upkeep). The AI never buys something that would put the territory into a recurring deficit."),
        Sep(),
        Note("This means the AI sometimes has enough gold saved up but still won't buy something — because it would make the territory cash-flow negative going forward."),
        Sep(),

        H2("3.4  Difficulty Income Modifiers"),
        P("On top of normal income, the difficulty setting adjusts how much gold AI territories gain or lose each round:"),
        Sep(),
        makeTable([
          ["Difficulty",  "Gold Modifier per Round",         "Effect in Practice"],
          ["Super Easy",  "Loses 1 gold per tile owned",     "Territory shrinks in purchasing power over time — AI is economically crippled"],
          ["Easy",        "No modifier",                     "Standard economy"],
          ["Medium",      "No modifier",                     "Standard economy"],
          ["Hard",        "No modifier",                     "Standard economy"],
          ["Super Hard",  "Gains 1 gold per tile owned",     "Territory snowballs financially — AI gets richer faster the more land it holds"],
        ]),
        Sep(),

        H2("3.5  Bankruptcy"),
        P("At the end of each round, if a territory's gold balance plus its income (after the difficulty modifier) minus its upkeep goes below zero, the territory goes bankrupt. The consequences happen in two stages:"),
        Sep(),
        BulletB("Stage 1 — Units die first: ", "All units in the territory are killed and sent to the graveyard. This frees up their upkeep."),
        BulletB("Stage 2 — Buildings demolished (if still in deficit): ", "If killing all units still does not bring the territory into balance, all buildings (except Cities and Rebels) are demolished and become ruins."),
        Sep(),
        Note("Cities and Rebels are never destroyed by bankruptcy — only units and defensive buildings are affected."),
        Sep(),

        H2("3.6  The 1-Tile Isolation Rule"),
        P("When a territory is cut down to a single tile (for example, when the enemy splits it by capturing an adjacent tile), the surviving one-tile fragment is immediately penalised:"),
        Sep(),
        BulletB("Gold zeroed: ", "The isolated tile's gold balance is reset to zero."),
        BulletB("Units die immediately: ", "Any unit on the isolated tile is killed on the spot and sent to the graveyard."),
        BulletB("Buildings become ruins: ", "Any defensive building on the tile (tower or castle) is immediately demolished."),
        Sep(),
        Note("This penalty triggers the moment the isolation happens — not at the start of the next round. Cities and Rebels on an isolated tile are exempt from demolition but the gold is still zeroed."),
        Sep(),

        // ══════════════════════════════════════════════════════
        // 4. HOW THE AI THINKS
        // ══════════════════════════════════════════════════════
        H1("4. How the AI Thinks"),

        H2("4.1  Attacking vs. Defending"),
        P("At the start of every decision loop, the AI classifies itself as either Attacking or Defending for the current territory. This classification determines which priorities become available."),
        Sep(),
        P(Bold("Defending mode triggers when: "), Normal("an enemy unit is located on a territory that shares a border with the AI's current territory, that unit is within 3 tiles of the AI's border, AND that unit is stronger than any unit the AI currently has in this territory. Only units count for this comparison — towers and castles are ignored when determining whether the AI can handle the threat on its own.")),
        Sep(),
        P(Bold("Attacking mode: "), Normal("the default. Applies whenever the above condition is not met.")),
        Sep(),
        Note("Neutral territories never trigger Defending mode. Only active enemy factions can cause the AI to switch to a defensive posture."),
        Sep(),

        H2("4.2  Difficulty and Randomness"),
        P("Each difficulty level controls how reliably the AI acts each turn. At lower difficulties, the AI randomly skips some decision loops — it still knows what to do but \"chooses\" not to. At Hard and Super Hard, the AI always takes every available action."),
        Sep(),
        makeTable([
          ["Difficulty",  "Chance of Skipping Each Action Loop", "Special Modifier"],
          ["Super Easy",  "None (see note)",                     "Loses 1 gold per tile per round"],
          ["Easy",        "40% per loop",                        "None"],
          ["Medium",      "20% per loop",                        "None"],
          ["Hard",        "None",                                "None"],
          ["Super Hard",  "None",                                "Gains 1 gold per tile per round"],
        ]),
        Sep(),
        Note("Super Easy does not skip loops — it is handicapped through the income penalty instead. This means even Super Easy AI will always react to threats; it just cannot afford to act on them as often."),
        Sep(),

        H2("4.3  Rounds 1 and 2 — When Income Starts"),
        P(Bold("Round 1: "), Normal("Both the player and all AI factions are limited to placing one free Tower per territory. No units can be bought, no tiles can be captured, and no income or upkeep is processed for anyone. All territories start with 10 gold as their initial reserve.")),
        Sep(),
        P(Bold("Round 2: "), Normal("The game opens up — units can be bought, tiles can be captured. However, income and upkeep are still suspended for AI in round 2. This matches the player's experience: the player also does not receive income at the start of round 2. Income begins flowing from round 3 onwards for everyone.")),
        Sep(),
        Note("The income you see at the start of round 3 represents what was earned when you ended your turn in round 2. This is by design — both player and AI get their first income at the same time."),
        Sep(),

        // ══════════════════════════════════════════════════════
        // 5. COMBAT & MOVEMENT
        // ══════════════════════════════════════════════════════
        H1("5. Combat and Movement"),

        H2("5.1  Combat Strength and Zone of Control"),
        P("Every entity with a combat strength exerts influence over its own tile and all six adjacent tiles. This influence is called Zone of Control. When the AI (or player) tries to capture a tile, the attack only succeeds if the attacker's strength is strictly greater than the defender's Zone of Control on that tile."),
        Sep(),
        makeTable([
          ["Attacker",     "Strength", "Can capture tiles defended by...",          "Blocked by..."],
          ["Peasant",      "1",        "Undefended tiles only (ZoC = 0)",           "Any enemy Tower, Castle, Warrior, or Swordsman"],
          ["Warrior",      "2",        "Undefended tiles, Peasants, Towers (ZoC 1)", "Castles and Swordsmen (ZoC 2 or 3)"],
          ["Swordsman",    "3",        "Everything up to Castle strength (ZoC ≤ 2)", "Another Swordsman (ZoC 3)"],
          ["Tower",        "1",        "—",                                          "Towers do not attack"],
          ["Castle",       "2",        "—",                                          "Castles do not attack"],
        ]),
        Sep(),
        Note("A Swordsman (strength 3) can directly capture a tile protected by a Castle (strength 2) because 3 > 2. Only another Swordsman — or a tile with multiple overlapping defenders — can stop a Swordsman."),
        Sep(),

        H2("5.2  Movement Rules"),
        P("Units can move up to 3 tiles per turn. Forest tiles cost 2 movement points to enter; all other passable terrain costs 1. Mountains cannot be entered. A unit that moves partially (e.g. 1 tile into forest) has its remaining movement tracked — it can continue moving that same turn if enough points remain."),
        Sep(),
        BulletB("Moving to a friendly tile: ", "allowed and the unit can continue. If a friendly unit is already there, the two units merge (see section 5.4)."),
        BulletB("Moving to an enemy or neutral tile: ", "only permitted if the attacker's strength exceeds the defender's Zone of Control on that tile. The move captures the tile."),
        BulletB("Moving to a lake tile: ", "special rules apply — see section 5.3."),
        Sep(),

        H2("5.3  Lake Crossings"),
        P("A unit can sail across a lake to reach land on the other side, but only if there is a strategically worthwhile target on the far side. The AI checks whether crossing the lake would allow it to split, bankrupt, or isolate an enemy territory. If there is no such opportunity, the unit stays on land."),
        Sep(),
        P(Bold("Cost of entering a lake: "), Normal("The territory pays a sailing fee equal to twice the unit's upkeep (minimum 2, maximum 15 gold). This fee is held in reserve on the lake tile and returned to whichever territory the unit lands on.")),
        Sep(),
        P(Bold("Getting stranded: "), Normal("If a unit is already on a lake tile and the strategic opportunity is gone (e.g. the enemy territory it was targeting no longer exists), the AI immediately retreats the unit back to its own land. The retreat uses a pathfinding search that can chain through multiple lake tiles if necessary — the unit will always find the shortest path back to friendly land, even if it is several lake tiles away.")),
        Sep(),

        H2("5.4  Merging Units"),
        P("When two friendly units occupy the same tile, they automatically merge into a single stronger unit:"),
        Sep(),
        makeTable([
          ["First Unit",  "Second Unit", "Result"],
          ["Peasant",     "Peasant",     "Warrior (strength 2)"],
          ["Peasant",     "Warrior",     "Swordsman (strength 3)"],
          ["Warrior",     "Peasant",     "Swordsman (strength 3)"],
        ]),
        Sep(),
        Note("Merging above strength 3 is impossible — a tile already holding a Swordsman cannot receive another unit."),
        Sep(),

        // ══════════════════════════════════════════════════════
        // 6. DECISION PRIORITY ORDER
        // ══════════════════════════════════════════════════════
        H1("6. Decision Priority Order"),

        P("The AI evaluates the following priorities in strict order, top to bottom. The first priority that has a valid action performs that one action, then the process restarts from the top. If no priority finds anything to do, the territory is done for this turn."),
        Sep(),
        makeTable([
          ["Priority",    "Active In",       "Action"],
          ["0",           "All states",      "Retreat any stranded lake units back to own land"],
          ["DEF-1",       "Defending only",  "Attack to split or destroy the threatening enemy territory"],
          ["DEF-2",       "Defending only",  "Reinforce to match the threatening enemy's strength"],
          ["A",           "All states",      "Tactically split an enemy territory (divide and bankrupt)"],
          ["B",           "All states",      "Bridge the gap to a separated own territory"],
          ["C",           "All states",      "Build defensive buildings on unprotected border tiles"],
          ["D",           "All states",      "Build a City inside large territories"],
          ["E1",          "All states",      "Attack enemy tiles that have a defender (unit or building)"],
          ["E2",          "All states",      "Capture empty enemy tiles"],
          ["E3",          "All states",      "Capture neutral tiles"],
          ["F",           "All states",      "March units toward the nearest enemy territory"],
          ["G",           "All states",      "Clear rebel tiles from own territory"],
          ["H",           "All states",      "Demolish distant defensive buildings to save upkeep"],
        ]),
        Sep(),

        // ─── PRIORITY 0 ─────────────────────────────────────────
        H2("Priority 0 — Retreat Stranded Lake Units"),
        P("If any AI unit is on a lake tile and there is no longer a worthwhile target on the far shore, the AI retreats it immediately. The pathfinding searches through lake tiles as well as land tiles — it can chain across multiple lake hexes if needed — and moves the unit one step closer to the nearest friendly land tile. This repeats each loop until the unit is back on solid ground."),
        Sep(),
        Note("If no retreat path exists at all (the unit is completely surrounded by enemy land and open water), the unit is marked as having acted and will try again next round."),
        Sep(),

        // ─── DEF-1 ──────────────────────────────────────────────
        H2("Priority DEF-1 (Defending) — Split the Threatening Enemy"),
        P("When the AI is in Defending mode, its first response is to go on the offensive against the threatening territory — not to fight the strong unit directly, but to split, isolate, or bankrupt the territory it belongs to. This reduces the threat indirectly by cutting off its income and resources."),
        Sep(),
        P("The AI evaluates every tile it can capture from the threatening faction and scores each option:"),
        Sep(),
        BulletB("Highest priority: ", "captures that would reduce the enemy to a single isolated tile (that tile then immediately loses its units and gold)."),
        BulletB("Second priority: ", "captures that would push the enemy territory into bankruptcy next round (income no longer covers upkeep after the loss)."),
        BulletB("Third priority: ", "captures that split the enemy into two or more separate territories."),
        Sep(),
        P("If no single unit can reach a qualifying tile, the AI may first merge two of its own units to create a stronger attacker for the next loop. If neither a direct move nor a merge is possible, the AI falls back to attacking whichever enemy tile minimises the size of enemy territory components that still contain units."),
        Sep(),

        // ─── DEF-2 ──────────────────────────────────────────────
        H2("Priority DEF-2 (Defending) — Reinforce Against the Threat"),
        P("If DEF-1 cannot act (or has already acted this loop), the AI tries to match the threatening unit's strength through upgrades and new construction. The steps are tried in order — the first that succeeds ends this priority:"),
        Sep(),
        BulletB("Step 1 — Upgrade an existing building: ", "promote a tower to a castle (or similar) if the result would match the threat's strength."),
        BulletB("Step 2 — Upgrade an existing unit: ", "upgrade one of the AI's own units that is within 5 tiles of the threat, if doing so matches or exceeds the threat's strength."),
        BulletB("Step 3 — Buy a new unit near the threat: ", "purchase a unit directly on a border tile close to the threat (within 5 tiles). Strongest affordable unit is tried first."),
        BulletB("Step 4 — Build a new defensive building near the threat: ", "construct a Castle or Tower within 5 tiles of the threat. Castles are preferred but require at least one Warrior or Swordsman in the territory."),
        BulletB("Step 5 — Fortify the border directly: ", "build a Tower or Castle on a border tile if the building's strength would at least match the threat minus one."),
        Sep(),

        // ─── A ──────────────────────────────────────────────────
        H2("Priority A — Tactical Split"),
        P("Even when not in Defending mode, the AI actively looks for opportunities to split enemy territories. A territory that is split may go bankrupt because one of its fragments can no longer cover its upkeep. The AI uses the same scoring as DEF-1: 1-tile isolation first, then bankruptcy, then any split that creates multiple separate fragments."),
        Sep(),
        Note("If no unit can reach a qualifying tile directly, the AI may merge two units to create a stronger attacker for the next loop iteration."),
        Sep(),

        // ─── B ──────────────────────────────────────────────────
        H2("Priority B — Bridge Own Territories"),
        P("If the AI controls multiple disconnected territories, it tries to link them together by capturing the tiles in between. Connected territories share resources more efficiently and create a larger, harder-to-split front."),
        Sep(),
        BulletB("1-tile bridge: ", "a single unclaimed tile sits between two AI territories. The AI captures it to merge them."),
        BulletB("2-tile bridge: ", "two adjacent unclaimed tiles connect two AI territories. The AI takes the first tile."),
        Sep(),
        P("The AI prefers bridges that connect to its largest other territory. It will move an existing unit, merge units to create one strong enough to break through, or buy a new unit near the bridge — whichever is available first."),
        Sep(),

        // ─── C ──────────────────────────────────────────────────
        H2("Priority C — Defend Unprotected Borders"),
        P("Border tiles that face an enemy territory with no defensive building are vulnerable. The AI places Towers or Castles to cover them. Rather than placing directly on the border, the AI prefers to place one tile inside the territory — this way the building's Zone of Control reaches out to the border tile and beyond."),
        Sep(),
        P("Buildings are spaced at least 2–3 tiles apart to avoid clustering (which wastes upkeep). Castles are only built if the territory already has at least one Warrior or Swordsman present."),
        Sep(),

        // ─── D ──────────────────────────────────────────────────
        H2("Priority D — Build a City"),
        P("In large territories (6 or more tiles), the AI will build a City to increase its long-term income. The City is placed inside the defensive Zone of Control of an existing tower or castle when possible, and as far from enemy territory as possible to reduce capture risk."),
        Sep(),
        Note("A territory can only have one City. If one already exists (either built or captured), this priority is skipped."),
        Sep(),

        // ─── E1 ─────────────────────────────────────────────────
        H2("Priority E1 — Attack Enemy Defenders"),
        P("The AI attacks enemy tiles that have a unit or building on them. Before attacking, it checks that its unit is strong enough to overcome the enemy's Zone of Control."),
        Sep(),
        P("Targets are prioritised in this order:"),
        BulletB("First: ", "attacks that would leave the enemy with a single isolated tile (immediate destruction)."),
        BulletB("Second: ", "attacks that push the enemy into bankruptcy."),
        BulletB("Third: ", "attacks that split the enemy territory."),
        BulletB("Fourth: ", "attacks on the strongest available target."),
        BulletB("Fifth: ", "attacks by the strongest available attacker."),
        Sep(),
        P("If no unit can reach a defended enemy tile right now, the AI may merge two units to build up for next loop, or buy a new unit adjacent to the target."),
        Sep(),

        // ─── E2 ─────────────────────────────────────────────────
        H2("Priority E2 — Capture Empty Enemy Tiles"),
        P("Enemy tiles with no defenders (no unit or building) can be captured by even a Peasant, as long as there is no adjacent enemy unit projecting Zone of Control onto that tile. The AI prefers to attack tiles belonging to the largest enemy territory — taking tiles from a big territory does more economic damage."),
        Sep(),

        // ─── E3 ─────────────────────────────────────────────────
        H2("Priority E3 — Expand into Neutral Territory"),
        P("When no enemy tiles are within reach, the AI grabs neutral land to grow its income base. Neutral tiles are prioritised by terrain value:"),
        Sep(),
        BulletB("Highest: ", "City tiles (high income bonus)."),
        BulletB("Middle: ", "Grassland and Forest (+2 gold/round each)."),
        BulletB("Lowest: ", "Desert (+1 gold/round)."),
        Sep(),

        // ─── F ──────────────────────────────────────────────────
        H2("Priority F — March Toward the Enemy"),
        P("Units that are not already next to an enemy territory are moved as close to the nearest enemy as possible. The AI uses the unit's full movement allowance (up to 3 tiles) in one action — it does not take one small step and wait; it moves the unit all the way to the best reachable position in a single move."),
        Sep(),
        Note("Units already adjacent to enemy territory are skipped here — they are handled by Priorities E1 and E2 instead."),
        Sep(),

        // ─── G ──────────────────────────────────────────────────
        H2("Priority G — Clear Rebels"),
        P("Rebels occupy tiles inside the AI's own territory and block income from those tiles. The AI clears them by moving the weakest available unit onto the rebel tile (using minimum force) or buying a Peasant directly on the rebel tile."),
        Sep(),
        P(Bold("Important: "), Normal("units that are stationed on the border of the AI territory — adjacent to enemy land — are never used for rebel clearing. Those units are kept in position for attack and defence. Only interior units (not touching enemy territory) are assigned to rebel-clearing duty.")),
        Sep(),
        Note("Rebel clearing is a low priority — the AI only does it when there are no expansion, movement, or attack opportunities left for interior units."),
        Sep(),

        // ─── H ──────────────────────────────────────────────────
        H2("Priority H — Demolish Distant Defensive Buildings"),
        P("Towers and Castles that are far from any active enemy border become an unnecessary drain on upkeep. The AI removes any defensive building that is more than 5 tiles away from the nearest live border. A 'live' border is one that faces an enemy territory with at least 2 tiles (tiny 1-tile enemy fragments are not considered real threats)."),
        Sep(),
        Note("Demolishing a building is immediate — no ruins are left behind, and the upkeep saving takes effect the following round."),
        Sep(),

        // ══════════════════════════════════════════════════════
        // 7. STRATEGIC CONCEPTS
        // ══════════════════════════════════════════════════════
        H1("7. Key Strategic Concepts"),

        H2("7.1  Splitting and Isolating"),
        P("One of the AI's most powerful tactics is splitting enemy territories. When a territory is divided into two separate pieces, each fragment must cover its own upkeep from its own (now smaller) income. A fragment that cannot break even will go bankrupt and lose its units at the end of the round. A fragment with exactly one tile is destroyed immediately."),
        Sep(),
        P("The AI actively scores every capture opportunity against three criteria: does it create a 1-tile death fragment? Does it push any fragment into bankruptcy? Does it split the territory at all? These checks are used at Priority DEF-1, A, E1, and E2."),
        Sep(),

        H2("7.2  The Income-Sustainability Test"),
        P("Before any purchase, the AI checks that its territory can sustain the new entity's upkeep in perpetuity — not just right now, but every round going forward. This prevents the AI from over-spending and collapsing under its own upkeep burden."),
        Sep(),

        H2("7.3  Merging as a Setup Move"),
        P("When the AI cannot directly take an enemy tile because its available units are too weak, it may instead merge two of its own weaker units together to create a stronger unit. This is a deliberate setup: the merged unit will be strong enough to break through on the next loop iteration. Merging costs nothing — it is always worth doing when a stronger unit is needed."),
        Sep(),

        H2("7.4  Spacing Defensive Buildings"),
        P("The AI avoids stacking multiple towers or castles close together. When choosing where to place a defensive building, it filters out any tile that is within 2 tiles of an existing building. This spreading-out policy maximises the territory covered per upkeep point paid."),
        Sep(),

        // ══════════════════════════════════════════════════════
        // 8. QUICK REFERENCE
        // ══════════════════════════════════════════════════════
        H1("8. Quick Reference Tables"),

        H2("8.1  All Entities at a Glance"),
        makeTable([
          ["Entity",    "Cost",    "Upkeep",     "Strength", "Type",     "Special"],
          ["Peasant",   "10",      "3/round",     "1",        "Unit",     "Cheapest attacker"],
          ["Warrior",   "20",      "9/round",     "2",        "Unit",     "Beats towers and peasants"],
          ["Swordsman", "30",      "27/round",    "3",        "Unit",     "Beats everything except another swordsman"],
          ["Tower",     "15",      "Progressive", "1 (ZoC)",  "Building", "First tower = 1/round upkeep"],
          ["Castle",    "30",      "Progressive", "2 (ZoC)",  "Building", "Requires Warrior+ in territory to build"],
          ["City",      "10",      "0",           "—",        "Building", "Adds +2 income; permanent (never removed); capturing unit is consumed; one per territory"],
          ["Rebel",     "—",       "—",           "—",        "Neutral",  "Blocks tile income; cleared by any unit"],
        ]),
        Sep(),

        H2("8.2  Strength vs. Zone of Control — Can This Attack Succeed?"),
        makeTable([
          ["Defender's ZoC on tile", "Peasant (1) can attack?", "Warrior (2) can attack?", "Swordsman (3) can attack?"],
          ["0 (no defenders)",       "✓ Yes",                   "✓ Yes",                   "✓ Yes"],
          ["1 (Tower or Peasant)",   "✗ No",                    "✓ Yes",                   "✓ Yes"],
          ["2 (Castle or Warrior)",  "✗ No",                    "✗ No",                    "✓ Yes"],
          ["3 (Swordsman)",          "✗ No",                    "✗ No",                    "✗ No"],
        ]),
        Sep(),

        H2("8.3  Priority Summary"),
        makeTable([
          ["Priority", "Condition",       "Goal"],
          ["0",        "Always",          "Retrieve lake units with no target"],
          ["DEF-1",    "Defending mode",  "Split / bankrupt the threatening territory"],
          ["DEF-2",    "Defending mode",  "Match the threat through upgrades or new construction"],
          ["A",        "Always",          "Split any enemy territory opportunistically"],
          ["B",        "Always",          "Connect separated own territories"],
          ["C",        "Always",          "Place defensive buildings on exposed borders"],
          ["D",        "Always",          "Build a City in large safe territories"],
          ["E1",       "Always",          "Attack tiles with enemy defenders — strategic targets first"],
          ["E2",       "Always",          "Take undefended enemy tiles — biggest territory first"],
          ["E3",       "Always",          "Grab neutral land — city tiles and high-income terrain first"],
          ["F",        "Always",          "Move interior units toward the enemy at full speed"],
          ["G",        "Always",          "Clear rebels using interior units only"],
          ["H",        "Always",          "Demolish buildings more than 5 tiles from any active border"],
        ]),
        Sep(),

        // ══════════════════════════════════════════════════════
        // END
        // ══════════════════════════════════════════════════════
        new Paragraph({
          children: [
            new TextRun({ text: "— End of AI Strategy Reference —", italics: true, size: 22, color: "888888" }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 600, after: 200 },
        }),
      ],
    },
  ],
});

const buf = await Packer.toBuffer(doc);
const outPath = path.resolve(
  "/home/runner/workspace/artifacts/mockup-sandbox/public/ai-strategy.docx",
);
fs.writeFileSync(outPath, buf);
console.log(`✅  Saved → ${outPath}  (${Math.round(buf.length / 1024)} KB)`);
