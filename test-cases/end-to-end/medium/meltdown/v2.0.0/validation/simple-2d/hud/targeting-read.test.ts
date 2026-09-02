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
import { TOWER_DEFS, TOWER_TYPES } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { readPanel, textsOf } from "./read";

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

/** A reading's runs, normalized so two spellings of one line compare equal. */
function linesOf(texts: readonly string[]): Set<string> {
  return new Set(
    texts.map((text) => text.trim().replace(/\s+/g, " ").toLowerCase()),
  );
}

/** The lines every set in `sets` holds. */
function sharedBy(sets: readonly Set<string>[]): Set<string> {
  const [first, ...rest] = sets;
  return new Set(
    [...first].filter((line) => rest.every((other) => other.has(line))),
  );
}

/** The lines of `held` that none of `others` holds. */
function without(held: Set<string>, others: readonly Set<string>[]): string[] {
  return [...held].filter((line) => !others.some((other) => other.has(line)));
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
    hovered.set(type, linesOf(textsOf(info)));
  }
  h.debug.setHoverShop(null);

  /** The information area a selected tower draws, for each type. */
  const selected = new Map<TowerType, Set<string>>();
  for (const type of TOWER_TYPES) {
    const id = poseTower(h, type, AT.col, AT.row);
    h.debug.setSelected(id);
    const { info } = await readPanel(h);
    if (type === AIR_ONLY) captureStill(h, "targeting");
    selected.set(type, linesOf(textsOf(info)));
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
