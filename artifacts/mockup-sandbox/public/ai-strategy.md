# Hex Battles — AI Strategi (Detaljeret)

## Overordnet turnstruktur

Hver gang spillerens tur slutter, kører AI'en for **alle** AI-fraktioner (`ai1`–`ai5`) i rækkefølge.
For **hvert sammenhængende territorium** kører AI'en en beslutningsløkke op til **100 iterationer**.
I hver iteration vælges og udføres én handling — den med højest prioritet der er mulig lige nu.

### Undtagelse: Runde 1
AI'en lægger **kun** et gratis tårn (hvis territoriet har ≥ 2 felter) og gør intet andet.
Der købes ingen enheder, og ingen felter erøbres.

---

## Indkomst & udgifter

### Feltindkomst pr. felt
| Terræntype  | Indkomst |
|-------------|----------|
| Græs        | +2       |
| Skov        | +2       |
| Ørken       | +1       |
| Bjerg       | 0        |
| Sø          | 0        |
| By-felt     | +2 bonus |
| Bygget by   | +2 bonus |

### Vedligeholdelse (upkeep) af enheder
| Enhed      | Styrke | Upkeep/runde |
|------------|--------|--------------|
| Bonde      | 1      | 3            |
| Kriger     | 2      | 9            |
| Sværdmand  | 3      | 27           |

### Vedligeholdelse af bygninger (skalerer med antal)
- **Tårn nr. n:** `n × (n+1) / 2`  → 1., 2., 3. tårn koster 1, 2, 3 pr. runde
- **Slot nr. n:** `5 × n × (n+1) / 2` → 1., 2., 3. slot koster 5, 10, 15 pr. runde

### Råd-til-køb (`canAfford`)
AI'en køber **kun** hvis:
1. `Nuværende balance ≥ Pris`
2. `Indkomst − (eksisterende upkeep + ny upkeep) ≥ 0`

---

## Beslutningsprioriteter (strenge rækkefølge)

### DEF-1 og DEF-2 — Forsvarsrespons (udløses, hvis stærkere fjende er inden for 3 grænsefelter)
- **DEF-1 (Split fjende):** Angrib felter der isolerer truslen og potentielt bankrotter den
- **DEF-2 (Mod-byg):** Opgrader enheder/bygninger til at matche trusselen, maks. 5 felter fra grænsen

### A — Taktisk split
Del et fjendeterritorium i to eller flere dele.
Et territorium der splittes kan gå bankrot, fordi dets enhedsomkostninger nu kan overstige den mindste dels indkomst.

### B — Broforbindelser
Forbind AI'ens egne adskilte territorier hvis de er **1–2 felter fra hinanden**.

### C — Grænse-forsvar
Byg tårn eller slot på ubeskyttede grænsefelter.
Prioriterer de felter der grænser op til fjenden.

### D — Byg by
Bygger by inde i territoriet hvis:
- Territoriet har **≥ 6 felter**
- Der er **ingen eksisterende by** i territoriet
- Prioriterer felter der er dækket af et tårn/slot

### E — Ekspansion (tre underniveauer)
**E1 — Angrib fjendtlige enheder/bygninger**
- Angriber det stærkeste mål der kan overvindes
- Tager altid et slot/tårn frem for en åben fjende-felt hvis muligt

**E2 — Erobre tomme fjende-felter**
- Foretrækker at angribe det **største** fjendeterritorium

**E3 — Erobre neutrale felter**
- Prioriteringsorden: By-felt > Græs/Skov > Ørken

### F — Rebelltryk
Bevæg enheder til felter inden for territoriet der er besat af rebeller, eller køb enheder der kan håndtere dem.

### G — Bevægelse (patrulje)
Bevæg uvirkende enheder **nærmere** nærmeste fjendegrænse via BFS-ruteplanlægning.

### H — Nedrivning
Fjern forsvarsbygninger der er **> 5 felter** fra enhver aktiv grænse — for at spare upkeep.

---

## Bevægelses- og kamplogik

### Zone of Control (ZoC)
En AI-enhed kan **ikke** lande på et felt hvor fjenden har en enhed/bygning med styrke ≥ angriberen.
- Styrke 1 kan slå styrke 0 (tomt, neutralt)
- Styrke 2 kan slå styrke 1
- Styrke 3 kan slå styrke 1 og 2 — men **ikke** slå et slot (bygning der giver styrke 3)

### Sø-bevægelse (lake transfer)
Enheder på sø betaler `2 × upkeep` (max 15) som en "sejlads-skat".
- Skatten opbevares på søfeltet og returneres til territoriet, når enheden lander på land
- AI'en sejler kun ud på sø, hvis der er et tilgængeligt landmål på den anden side
- Balancen kontrolleres **før** enhver tilstandsmutation — fejlet check strander ikke enheder

### Enheds-sammensmeltning
AI'en flytter bevidst enheder sammen på samme felt:
- Styrke 1 + Styrke 1 = Styrke 2 (Kriger)
- Styrke 2 + Styrke 1 = Styrke 3 (Sværdmand)

### Byovertagelse
Når en AI-enhed bevæger sig til et felt med en fjendtlig/neutral by:
- Byens entitet bevares (ændres til AI's ejerskab)
- Den erøbrende enhed forbruges (den "opofres" for at tage byen)

---

## Sværhedsgrader

| Niveau      | Skip-chance pr. iteration | Effekt                                                     |
|-------------|---------------------------|------------------------------------------------------------|
| Super Easy  | ~70–80%                   | AI springer de fleste beslutninger over, spiller næsten tilfældigt |
| Easy        | 40%                       | AI springer ca. halvdelen af mulige handlinger over         |
| Medium      | 20%                       | AI springer hver femte handling over                       |
| Hard        | 0%                        | AI udfører **alle** mulige handlinger, optimalt             |
| Super Hard  | 0% + aggressiv bonus      | Som Hard, men med øget aggressivitet og ressource-boost    |

---

## Bankerot-regler

Når en fraktions saldo + indkomst-delta bliver negativ:
1. **Alle enheder** i territoriet dræbes (flyttes til graveyard)
2. Hvis underskuddet fortsætter: **Alle bygninger** (ekskl. byer og rebeller) nedrives og bliver ruiner

---

## Sammenfattet prioriteringsoversigt

```
Runde 1 → STOP (kun gratis tårn)
     │
     ▼
DEF-1: Fjend-split (trussel inden for 3 felter)
DEF-2: Mod-opgradering (trussel inden for 5 felter)
     │
     ▼
A: Taktisk split af fjendeterritorium
B: Bro til eget territorium
C: Grænse-forsvar (tårn/slot)
D: Byg by (≥6 felter, ingen by endnu)
     │
     ▼
E1: Angrib fjende-enhed/-bygning
E2: Erobre tom fjende-felt
E3: Erobre neutralt felt
     │
     ▼
F: Rebelltryk
G: Bevæg enhed mod fjendegrænse
H: Nedrev fjernt tårn/slot
     │
     ▼
Ingen handlinger mulige → slut territorium
```
