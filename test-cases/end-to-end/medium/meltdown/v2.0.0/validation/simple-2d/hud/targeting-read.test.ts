// hud/targeting-read — the panel reads what a tower fires on, and it reads the
// same thing for every tower of the same class.
//
// THE RULE. specs/hud.md, The targeting read: "Both the hover panel and the
// inspector read what the tower fires on. Every emitter but the Flak reads as
// hitting ground and air, the Flak reads as air-only, and the Forge and the Sink
// read as never firing." So the eight towers fall into three classes, and the
// read is a function of the CLASS and of nothing else.
//
// THE CHECK IS THE THREE CLASSES, NOT THE THREE PHRASES, because the phrases are
// the build's. specs/hud.md fixes the label of each status readout and no other
// copy in the panel: "TARGETS GROUND + AIR", "GROUND & AIR" and "HITS EVERYTHING"
// are all conformant, and a check that demanded any one of them would be
// asserting a reference rather than a specification. What the specification does
// fix is the PARTITION, and a partition is decidable without knowing a single
// word:
//
//   THE FIVE GROUND-AND-AIR EMITTERS MUST SHARE A READING NONE OF THE OTHER THREE
//   HAS. Take the runs of text every one of the Arc, Stutter, Rime, Bloom and
//   Lance panels drew, and subtract every run the Flak, the Forge or the Sink
//   drew. What is left is non-empty exactly when those five say something in
//   common that the other three do not — which is the targeting read, because
//   nothing else on their panels is shared: specs/towers.md gives all five a
//   different size, range, fire rate, mass, redline and radiator layout, and
//   everything the panel draws that does not vary with the tower is drawn on the
//   Flak's panel too and so is subtracted.
//
//   THE TWO MOVERS MUST SHARE A READING NO EMITTER HAS, by the same subtraction
//   the other way round. That is the "never firing" class.
//
// Together those two say that the Flak carries neither class's reading, which is
// the third class: it reads apart from the five and apart from the movers.
//
// BOTH SURFACES, BECAUSE THE ITEM NAMES BOTH. The eight are read once as hovered
// shop entries and once as selected towers, and the partition must hold on each.
//
// THE READING IS THE INFORMATION AREA, NOT THE WHOLE STRIP. The shop draws all
// eight names and costs at all times, and a selected tower's Upgrade and Sell
// carry figures that vary with the tower, so a subtraction over the whole panel
// would be dominated by them. The controls are subtracted by the rectangles the
// build itself reported, which is how this check reads the information area
// without the specification fixing where it sits.
//
// ONE TOWER AT A TIME, AT ONE LEVEL AND ONE HEAT. Each inspector reading poses a
// single tower on the same quiet anchor, at level I and heat 0, and takes it away
// again — so the eight readings differ in the tower's TYPE and in nothing else,
// which is what makes a shared run a statement about the class.
//
// WHAT IT DOES NOT DECIDE. What each tower actually fires on is
// `combat.flak-hits-flyers-only` and `movers.forge-never-fires`; this point
// decides that the panel says so.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { TOWER_DEFS, TOWER_TYPES } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { readPanel, spellingsOf } from "./read";

/** The five emitters specs/hud.md has reading as hitting ground and air. */
const GROUND_AND_AIR: readonly TowerType[] = [
  "arc",
  "stutter",
  "rime",
  "bloom",
  "lance",
];

/** The one emitter that reads air-only. */
const AIR_ONLY: TowerType = "flak";

/** The two towers that read as never firing. */
const NEVER_FIRES: readonly TowerType[] = ["forge", "sink"];

/** The six emitters, for the mover subtraction. */
const EMITTERS: readonly TowerType[] = TOWER_TYPES.filter(
  (type) => TOWER_DEFS[type].kind === "emitter",
);

/**
 * How many readings a class must share that no other class has: one.
 *
 * The targeting read is one line of the panel, so one shared run is the whole
 * requirement. A build that draws its targeting over two lines clears it just as
 * well.
 */
const SHARED_MIN = 1;

/** A quiet anchor: no opening and no corridor within a 4x4 footprint of it. */
const AT = { col: 4, row: 4 };

/** The run the panels are read on. The purse is above every cost, so no entry is
 * drawn disabled and the eight readings differ in the tower alone. */
const MODE = "containment";
const DIFFICULTY = "hard";
const MONEY = 9999;
const LIVES = 17;
const WAVE = 3;

/**
 * Where a drawn line is cut into the fields it lays side by side, and how long a
 * word has to be for a field to be a reading at all.
 *
 * A panel packs several readings onto one line and parts them with a rule of its
 * own — a middot, a bullet, a bar, a dash, a slash, or simply a wider gap. Every
 * one of those is a separator; `+`, `&` and `/` INSIDE a word are not, which is
 * why the cut is on a slash only when it stands alone. A field has to carry a
 * word of at least `MIN_LETTERS` letters, so a bare figure or a run of
 * punctuation — `2x2`, `—`, `·` — can never be the reading a class "shares".
 */
const SEPARATOR = /[·•|,;]|\s[—–/]\s|\s{2,}/;
const MIN_LETTERS = 3;

/** A word long enough to make a field a reading. */
const WORD = new RegExp(`[a-z]{${String(MIN_LETTERS)},}`);

/**
 * The fields a panel's drawn lines lay side by side.
 *
 * WHY FIELDS AND NOT WHOLE LINES. specs/hud.md fixes that both panels read what
 * the tower fires on; it fixes neither the words nor the LINE the reading is
 * drawn on. `2x2 · GROUND + AIR` and `GROUND + AIR · MASS 1.8` have each said
 * exactly the thing, and a partition taken over whole lines fails them both for
 * having laid the panel out differently — and the layout is the build's
 * (specs/overview.md hands it "the palette, the type, the glow, and every other
 * aspect of the look"). Over fields the partition is unchanged in what it
 * decides: the five must still share a reading that the Flak and the two movers
 * all lack, and the only thing five emitters can share that the Flak — which
 * carries a size, a range, a fire rate, a damage, a mass, radiator faces and a
 * redline exactly as they do, all of them different figures — does not is that
 * they hit the ground.
 *
 * A WHOLE FIELD, NOT ANY RUN OF WORDS INSIDE ONE. The reading a build draws is a
 * field it wrote as a field; a window taken at every word offset would let half
 * of one field and half of the next stand in for it, and `THERMAL CLASS A` folded
 * into a longer line would be a "shared read" the moment a build wrote `B` for
 * the Flak. Cutting only at the separators the build itself wrote keeps the
 * candidate the thing the panel drew.
 *
 * WHAT THIS POINT THEREFORE ACCEPTS, STATED PLAINLY. Any field the five draw and
 * the other three do not passes it, whatever it says. A build that drew no
 * targeting read at all but happened to print some other per-class field that
 * separated the Flak from the other five emitters would pass — and nothing here
 * can tell those apart, because telling them apart means naming the words, and
 * specs/hud.md fixes none. That surface is the price of not grading a build
 * against one vocabulary, and it is narrow: the field has to partition the eight
 * towers exactly the way the targeting read does.
 */
function fieldsOf(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const field of text.toLowerCase().split(SEPARATOR)) {
      const words = (field ?? "").trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      if (!words.some((word) => WORD.test(word))) continue;
      out.add(words.join(" "));
    }
  }
  return out;
}

/** The phrases every set in `sets` holds. */
function sharedBy(sets: readonly Set<string>[]): Set<string> {
  const [first, ...rest] = sets;
  return new Set(
    [...first].filter((phrase) => rest.every((other) => other.has(phrase))),
  );
}

/** The phrases of `held` that none of `others` holds. */
function without(held: Set<string>, others: readonly Set<string>[]): string[] {
  return [...held].filter(
    (phrase) => !others.some((other) => other.has(phrase)),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the three targeting classes apart, on the hover panel and the inspector", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);

  /** The information area a hovered shop entry draws, for each type. */
  const hovered = new Map<TowerType, Set<string>>();
  for (const type of TOWER_TYPES) {
    h.debug.setHoverShop(type);
    const { info } = await readPanel(h);
    hovered.set(type, fieldsOf(spellingsOf(info)));
  }
  h.debug.setHoverShop(null);

  /** The information area a selected tower draws, for each type. */
  const selected = new Map<TowerType, Set<string>>();
  for (const type of TOWER_TYPES) {
    const id = poseTower(h, type, AT.col, AT.row);
    h.debug.setSelected(id);
    const { info } = await readPanel(h);
    if (type === AIR_ONLY) captureStill(h, "targeting");
    selected.set(type, fieldsOf(spellingsOf(info)));
    h.debug.setSelected(null);
    h.debug.removeTower(id);
  }

  for (const [surface, read] of [
    ["hover panel", hovered],
    ["inspector", selected],
  ] as const) {
    const readingOf = (type: TowerType): Set<string> =>
      read.get(type) as Set<string>;

    const groundAndAir = without(
      sharedBy(GROUND_AND_AIR.map(readingOf)),
      [AIR_ONLY, ...NEVER_FIRES].map(readingOf),
    );
    assertGreaterThanOrEqual(
      groundAndAir.length,
      SHARED_MIN,
      `readings the ${surface} gives all five of ` +
        `${GROUND_AND_AIR.join(", ")} and gives neither the ${AIR_ONLY} nor ` +
        `the movers — the "hitting ground and air" the five share and the ` +
        `other three do not (specs/hud.md, The targeting read)`,
    );

    const neverFires = without(
      sharedBy(NEVER_FIRES.map(readingOf)),
      EMITTERS.map(readingOf),
    );
    assertGreaterThanOrEqual(
      neverFires.length,
      SHARED_MIN,
      `readings the ${surface} gives both the ${NEVER_FIRES.join(" and the ")} ` +
        `and gives no emitter — the "never firing" the two movers share ` +
        `(specs/hud.md, The targeting read)`,
    );
  }
});
