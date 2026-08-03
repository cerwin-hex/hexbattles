# Hex Battles — Google Play store listing

Copy-paste source for the Play Console listing. Character limits are Google's;
the counts in brackets are what the text below actually uses.

Current release: **1.1.0 (versionCode 7)**

---

## App details

| Field | Value |
|-------|-------|
| App name (max 30) | `Hex Battles` [11] |
| Package name | `dk.hextek.hexbattles` |
| Category | Games → Strategy |
| Tags | Turn-based, Strategy, Single player |
| Contains ads | No |
| In-app purchases | No |
| Contact email | ht@spilcafeen.dk |

---

## Short description — en-US (max 80)

```
Turn-based hex strategy. Claim land, raise armies, outthink your AI rivals.
```
[75]

## Short description — da-DK (max 80)

```
Turbaseret hex-strategi. Erobr land, byg hære, og udtænk dine AI-modstandere.
```
[77]

---

## Full description — en-US (max 4000)

```
Hex Battles is a turn-based strategy game on a hexagonal map. You start with a
handful of scattered tiles and a little gold. Every other colour on the board is
an AI opponent, and they all want what's yours.

CLAIM, DEFEND, EXPAND
Every tile you hold pays income each turn — and every unit you own eats into it.
Push too fast and your treasury collapses before your army reaches the enemy.
Sit still and the AI grows past you. The whole game is that balance.

UNITS WITH A JOB
Peasants, warriors, swordsmen and knights take ground. Bowmen don't — they shoot
one adjacent enemy per turn from behind your line and let the infantry hold the
tile. Towers and castles cost more the more of them you build, so fortifying
everything is never the answer.

BUILD UP YOUR LAND
Found cities to grow your income, then raise fields, sawmills and mines inside a
city's reach. Cities must stand four tiles apart and each one builds once per
turn, so where you put them decides how your whole territory develops.

WATCH THE BORDERS
A territory cut in two pays an administrative penalty. Lose a region entirely and
rebels rise in the ruins. Bridges let you cross water your enemy can't.

PLAY IT YOUR WAY
Choose map size, number of AI opponents and difficulty from Easy to Expert. The
Game Elements list in Settings lets you switch individual systems — rebels,
improvements, ranged units, the admin burden — on or off, so you can play the
full game or a stripped-down one. Your last setup is remembered.

NO STRINGS
No ads. No in-app purchases. No account. No internet connection needed. Your
saved game stays on your device.
```
[1608] of 4000

## Full description — da-DK (max 4000)

```
Hex Battles er et turbaseret strategispil på et sekskantet kort. Du starter med
en håndfuld spredte felter og lidt guld. Alle andre farver på brættet er
AI-modstandere, og de vil alle sammen have det, der er dit.

EROBR, FORSVAR, UDVID
Hvert felt du ejer giver indkomst hver tur — og hver enhed du har, æder af den.
Presser du for hurtigt på, bryder økonomien sammen før hæren når frem. Sidder du
stille, vokser AI'en fra dig. Hele spillet er den balance.

ENHEDER MED EN OPGAVE
Bønder, krigere, sværdmænd og riddere tager land. Bueskytter gør ikke — de
skyder én nabofjende per tur bagfra og lader infanteriet holde feltet. Tårne og
borge koster mere, jo flere du bygger, så det kan aldrig betale sig at befæste
alt.

BYG DIT LAND OP
Grundlæg byer for at øge indkomsten, og anlæg marker, savværker og miner inden
for en bys rækkevidde. Byer skal ligge fire felter fra hinanden, og hver by
bygger én gang per tur, så placeringen afgør hele din udvikling.

HOLD ØJE MED GRÆNSERNE
Et område der skæres over, betaler en administrativ straf. Mister du en region
helt, rejser oprørere sig i ruinerne. Broer lader dig krydse vand, fjenden ikke
kan.

SPIL DET SOM DU VIL
Vælg kortstørrelse, antal AI-modstandere og sværhedsgrad fra Let til Ekspert.
Under Game Elements i indstillingerne kan du slå enkelte systemer til og fra —
oprørere, forbedringer, skytteenheder, administrationsbyrden — så du kan spille
det fulde spil eller en enklere udgave. Dine sidste valg bliver husket.

INGEN BETINGELSER
Ingen reklamer. Ingen køb i appen. Ingen konto. Ingen internetforbindelse. Din
gemte spilstilling bliver på din enhed.
```
[1610] of 4000

---

## Release notes 1.1.0 — en-US (max 500)

```
Bowmen arrive. Shortbowmen, longbowmen and crossbowmen shoot an adjacent enemy
instead of taking the tile.

Build fields, sawmills and mines straight from the Build ribbon — no peasant
needed. Improvements now belong to a city: four tiles between cities, one build
per city per turn.

A new Game Elements list in Settings turns individual systems on or off.

The menu remembers your last setup, neutral cities scale with map size, and the
AI is both sharper and faster.
```
[469] of 500

## Release notes 1.1.0 — da-DK (max 500)

```
Bueskytterne er kommet. Korte buer, langbuer og armbrøster skyder en nabofjende
i stedet for at tage feltet.

Byg marker, savværker og miner direkte fra Build-båndet — uden en bonde.
Forbedringer hører nu til en by: fire felter mellem byer, én bygning per by per
tur.

Ny Game Elements-liste i indstillingerne slår enkelte systemer til og fra.

Menuen husker dine sidste valg, neutrale byer skalerer med kortstørrelsen, og
AI'en er både skarpere og hurtigere.
```
[459] of 500

---

## Data safety form

The app makes no network requests: no analytics, no ads, no crash reporting, no
backend. Settings and the saved game live in local AsyncStorage only.

Answer the form as:

- **Does your app collect or share any of the required user data types?** → No
- **Is all of the user data collected by your app encrypted in transit?** → n/a
- **Do you provide a way for users to request that their data is deleted?** → n/a

Permissions the built AAB declares, and why: `INTERNET` and `VIBRATE` from the
React Native / Expo runtime, `READ/WRITE_EXTERNAL_STORAGE` capped at API 32, and
`SYSTEM_ALERT_WINDOW` from `expo-dev-client`. None back a user-facing feature.
`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` shipped in versionCode 6 via an
unused `expo-location` dependency; that dependency was removed for 1.1.0 and the
permissions are gone from the manifest. Verify with
`npx expo prebuild --platform android --no-install` before a release, then
`rm -rf android` and `git checkout -- package.json`.

> **Note:** `privacy.html` in the repo root is a generated boilerplate policy that
> claims the app collects IP address, page views and session length, and that the
> provider may send marketing. None of that is true of this app. It contradicts a
> "no data collected" declaration and should be rewritten before the next
> listing review.

---

## Graphics checklist

| Asset | Spec | Status |
|-------|------|--------|
| App icon | 512×512 PNG | `assets/images/icon.png` ✅ |
| Feature graphic | 1024×500 PNG/JPG | not in repo |
| Phone screenshots | 2–8, min 320px side | not in repo |

`orientation` is `"default"`, so the game runs both portrait and landscape —
decide which one the screenshots show.
