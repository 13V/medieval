# Kingshot Defense Mode — Research & Design Notes

This game was designed from a focused research pass: **10 parallel research agents** analysed
Kingshot's defense mode and the tower-defense genre, each covering a different angle (mode
identification, core loop, turrets & slows, enemies & waves, placement & map, in-match economy,
heroes & abilities, progression & rewards, UI/UX & game feel, art style & comparable games).
This document distills their findings and maps them to concrete implementation choices.

> TL;DR: Kingshot's marketing leans on a tower-defense fantasy that the live game only partly
> delivers. We built the game **Kingshot's ads promise** — a readable, strategic wave defense —
> while borrowing Kingshot's actual defense mechanics (auto Defense Towers, slowing Barricades,
> a castle/Guard-Station "base HP", ~20 waves with boss waves) and filling its biggest gap
> (no dedicated slow tower) with a first-class **Frost tower**.

---

## 1. What Kingshot is, and what its "defense mode" actually is

- **Kingshot** (Century Games, 2025) is primarily a **4X / city-builder SLG** in a *medieval*
  (not snow/ice — that's Whiteout Survival) setting. Its Google Play id is literally
  `com.run.tower.defense`, underscoring how central the TD hook is to its marketing.
- The defense content people mean is the **"Rebel Invasion" Tower-Defense mode**: a real-time, 3D,
  hero-controlled segment where the player **manually fights while placing automatic defense
  towers (crossbows & cannons)** and uses **Barricades to slow and funnel** enemies into kill
  zones at chokepoints. Reviewers note the live version is "elementary"/"the bait" — the ad
  fantasy outshines the shipped mode.
- A separate **Viking Vengeance** alliance event is the best-documented wave structure:
  **20 waves**, with **boss/HQ waves at 10 and 20**, ~1-minute gaps between waves (≈3 min before
  boss waves), and **exponential** enemy scaling (~300 troops on wave 1 → ~240,000 on wave 20).
- The **Guard Station** is the city's defensive "HP bar"; if it falls, you lose your position.

**→ Our design:** a real-time **wave defense** with **20 waves**, **boss waves at 10 & 20**, a
**prep phase between waves** (with a *call-early* gold bonus), and a **castle HP** loss condition.

Sources: [BlueStacks beginner guide](https://www.bluestacks.com/blog/game-guides/kingshot/kgst-beginners-guide-en.html),
[Gamigion UA funnel](https://www.gamigion.com/inside-kingshot-the-ua-funnel-every-game-needs/),
[Kingshot Wiki – Defense Tower](https://kingshotwiki.com/buildings/defense-tower/),
[Viking Vengeance guide](https://kingshotguides.com/guide/viking-vengeance-expert-guide-beginner-to-advanced/),
[Pocket Gamer hands-on](https://www.pocketgamer.com/kingshot/hands-on/).

---

## 2. Core loop & match structure

Kingshot's invasion = ambient build (towers are persistent city buildings) → **Alarm Bell** warns
→ real-time wave → auto-repair + guaranteed rewards. There is no classic per-wave build timer, and
fast-forward/auto only exist in the turn-based Suppress mode.

**→ Our design** (genre best practice over Kingshot's diffuse version): discrete numbered waves
(`WAVE x/20`), a **prep phase** to build/upgrade, an explicit **castle HP bar**, a **fail screen +
retry**, a **3-star** result (3★ = castle untouched), per-wave clear bonuses, and **1×/2× speed +
pause**. Implemented in `game.js` (`_enterPrep`/`_startWave`/`_onWaveCleared`) and `waves.js`.

Sources: [AppGrowing](https://appgrowing.net/blog/en/kingshot/),
[Fortress of Doors – Defender's Quest](https://www.fortressofdoors.com/optimizing-tower-defense-for-focus-and-thinking-defenders-quest/).

---

## 3. Defensive structures — and the slowing gap

Confirmed Kingshot structures: **Defense Tower** (auto-fires on enemies in its "alert zone";
crossbow & cannon variants), **Barricade** (the *only* structure that **slows/funnels** enemies;
NPC-mode only), **Guard Station** (base durability), **Watchtower** (non-combat). Notably, **no
dedicated slow/freeze tower** exists — slows come from the Barricade and from hero skills.

The genre, by contrast, treats slow as a pillar (BTD6 Glue/Ice, Kingdom Rush, Realm Defense's ice
sorceress). The player explicitly asked for "turrets to slow them down."

**→ Our 4 towers** (`config.js → TOWERS`):

| Tower | Maps to | Role |
| --- | --- | --- |
| 🏹 Archer (watchtower model) | Crossbow Defense Tower | cheap fast single-target |
| 💣 Cannon (cannon-tower model) | Cannon Defense Tower | slow heavy **splash** |
| 🪨 Catapult (catapult-tower model) | siege engine | long-range lobbed **splash** |
| ❄️ **Frost** (tower_B, cyan-tinted) | **Barricade's slow, made a real tower** | AoE **slow** specialist |

Each has **3 upgrade levels** (Kingshot upgrades towers; genre uses tiered upgrades).

Sources: [Kingshot Wiki – Barricade](https://kingshotwiki.com/buildings/barricade/),
[BTD6 Glue Gunner](https://bloons.fandom.com/wiki/Glue_Gunner_(BTD6)),
[Realm Defense slow strategies](https://realm-defense-hero-legends-td.fandom.com/wiki/Realm_Siege_Strategies).

---

## 4. Enemies & waves

Kingshot: enemies are "rebels" (infantry/cavalry/archers) plus **siege engines** later and
**battering rams** that target structures; bosses like the **Giant Rhino "Terror"**. Counts scale
**exponentially**; troop *tiers* climb T1→T10 across 20 waves. Genre adds the standard archetypes
(swarm runner, armored brute, healer, flyer, boss with **CC immunity**).

**→ Our roster** (`config.js → ENEMIES`) and **20-wave generator** (`generateWaves`):

| Enemy | Archetype | Notes |
| --- | --- | --- |
| Footman (pawn) | baseline infantry | the bread-and-butter |
| Raider (horse) | fast swarm | punishes coverage gaps |
| Brute (big pawn) | armored tank | **partly resists slow** |
| Warlord (siege/catapult) | boss (waves 10 & 20) | high HP, **strongly resists slow** |

HP scales `×(1 + 0.14·(wave−1))`; composition escalates; bosses at 10 & 20. (See `tests/hex.test.mjs`.)

Sources: [Viking Vengeance data](https://www.kingshotguide.org/data-center/viking-vengeance-data),
[Kingdom Rush armor/immunity](https://support.ironhidegames.com/support/solutions/articles/4000223666-armor-types-breakdown-kingdom-rush-battles-guide).

---

## 5. Slowing mechanics (the headline feature)

Genre best practices we adopted:

- **Multiplicative, capped** slow — never below ~20% speed (a 90% floor is the canonical anti-stuck
  rule). We cap at **80% slow** (`SLOW.maxSlow`) and use a strongest-wins model (BTD6 glue style).
- **Bosses/heavies resist** slow (`slowResist`) — Kingdom Rush's "contractual boss immunity".
- **Telegraph it**: blue/cyan is the universal "chill" colour. Slowed enemies are **tinted toward
  frost-blue and visibly move slower**; the Frost tower & Frost Nova emit cyan rings.

Implemented in `entities.js` (`Enemy.applySlow` / tint) and `config.js` (`SLOW`, Frost tower, Frost Nova).

Sources: [BTD6 Ice Monkey/Permafrost](https://bloons.fandom.com/wiki/Ice_Monkey_(BTD6)),
[ElementCrush 90% cap devlog](https://vfqd.itch.io/elementcrush/devlog/44951/ice-and-fulcrum-towers).

---

## 6. In-match economy

Kingshot's *invasion* economy is undocumented (resources flow to the persistent city), so we used
the genre-standard loop: **start gold → kill rewards → spend on towers/upgrades**, plus a **sell
refund** and a **call-wave-early bonus**. (`config.js → ECONOMY`, handled in `game.js`.)

---

## 7. Heroes / player abilities

Kingshot's hero abilities are the real CC layer: **AoE damage, stun/immobilize, attack-speed slow,
heal, buffs** (e.g., Marlin's AoE immobilize, Vivian's −50% attack-speed, Sophia's confusion). In
the TD mode the player manually triggers a hero (a stun slash). Suppress ultimates are tapped when
charged.

**→ Our two player-triggered, cooldown-based abilities** (`config.js → ABILITIES`): **Arrow Storm**
(targeted AoE damage) and **Frost Nova** (targeted AoE slow) — bottom-left buttons with radial
cooldowns, armed-then-tap-the-field targeting.

Sources: [Kingshot hero skills & builds](https://kingshotmastery.com/guides/hero-skills-and-builds),
[BlueStacks advanced tips](https://www.bluestacks.com/blog/game-guides/kingshot/kgst-tips-tricks-en.html).

---

## 8. UI/UX & game feel

Genre-proven HUD: **corner-anchored** panels (wave top-left, base HP top-center, currency
top-right, abilities bottom-left, speed bottom-right), **range circles**, **two-tap placement**,
**greyed-unaffordable** build buttons, **floating damage numbers**, **fast-forward**, and a
**rewarding 3-star victory / instant retry on defeat**. Slow must be telegraphed (blue tint).

**→ Implemented** across `index.html`, `styles.css`, `hud.js`, and `effects.js` (damage numbers,
hit/explosion pops, AoE rings, camera shake on castle hits).

Sources: [Kingdom Rush UI analysis](https://emilym.space/thumbelina-hurts-mobile-ui-blog/2018/6/26/kingdom-rush-a-tower-defense-trilogy-with-ui-design-approaching-perfection-and-entertainment-worth-missing-bedtime-for),
[Visual hierarchy in TD](https://www.wesplays.com/wes-plays/from-chaos-to-clarity-visual-hierarchy-in-tower-defense-design).

---

## 9. Art direction & comparables

Kingshot is **bright, low-poly, cartoony medieval** with a near-isometric defense view — a natural
fit for the **KayKit Medieval Hexagon Pack** (CC0 low-poly). Comparables (Kingdom Rush, BTD6,
Plants vs. Zombies, Realm Defense, **Thronefall** — which Kingshot's onboarding mimics) reinforced:
distinct enemy silhouettes/colour-coding, a dedicated slow archetype, boss every ~5–10 waves, a
fixed fully-visible battlefield, and chokepoint synergies.

**→ Implemented:** a centered hex board, a winding **road** (chokepoint), an angled orbit camera,
red enemies vs. blue towers for instant readability, and a serpentine path that rewards Frost +
splash combos.

Sources: [Gamigion – WOS vs Kingshot](https://www.gamigion.com/4x/),
[Thronefall maps wiki](https://throne-fall.github.io/game-content/maps/).

---

## 10. Research → implementation map

| Research finding | Where it lives |
| --- | --- |
| 20 waves, bosses at 10 & 20, prep between waves, exponential scaling | `config.js: generateWaves()` |
| Auto Defense Towers (crossbow/cannon) + siege | `config.js: TOWERS` (archer/cannon/catapult) |
| Barricade slow → first-class **Frost tower** + **Frost Nova** | `config.js: TOWERS.frost, ABILITIES.frostnova` |
| Multiplicative, capped slow; bosses resist; blue telegraph | `config.js: SLOW`, `entities.js: Enemy` |
| Guard Station base HP → **castle HP** loss condition | `config.js: CASTLE`, `game.js` |
| Kill-gold economy, sell refund, call-early bonus | `config.js: ECONOMY`, `game.js` |
| Hero CC abilities → 2 cooldown abilities | `config.js: ABILITIES`, `game.js: _castAbility` |
| Corner HUD, range rings, 2-tap, fast-forward, 3-star, damage numbers | `hud.js`, `effects.js`, `game.js` |
| Low-poly medieval, isometric, readable colours | KayKit assets + `board.js` / `game.js` camera |

*Research conducted via 10 parallel agents; this is a distilled synthesis with representative
citations, not the full source list (dozens of guides/wikis/reviews were consulted).*
