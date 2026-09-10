// hud/targeting-read — the panel's targeting read tells the three classes of
// tower apart, on the hover panel and on the inspector.
//
// THE RULE. specs/hud.md, The targeting read: "Both the hover panel and the
// inspector read what the tower fires on. Every emitter but the Flak reads as
// hitting ground and air, the Flak reads as air-only, and the Forge and the Sink
// read as never firing." specs/combat.md is where those three classes come from.
//
// HOW THIS IS READ WITHOUT FIXING A SINGLE WORD. specs/hud.md fixes the three
// readout LABELS and no other copy the panel draws, so a point that looked for
// `GROUND + AIR` would be grading a build against one vocabulary — a build
// reading `HITS GROUND AND FLYERS` says exactly the right thing in the wrong
// words. What the specification does fix is a PARTITION: five of the eight towers
// share one read, one has another, and two have a third. So what is looked for is
// a run of text that the five ground-and-air emitters ALL draw and that the Flak,
// the Forge and the Sink ALL do not.
//
// That one existence check carries the whole rule, and it is worth seeing why.
// The five share their labels with the Flak and the movers, so a label cannot be
// it. No two of the eight share a value: every range, fire rate, mass, redline
// and per-shot heat in specs/towers.md is distinct, and so is every damage read.
// The radiator rows do not partition this way either — the Arc's faces are `N S`
// and the Stutter's, Bloom's and Lance's are `N E`. So the only run five of them
// can share while the Flak and the two movers lack it is the targeting read, and
// it exists exactly when:
//
//   - the five all read as hitting ground and air (else the run is not shared);
//   - the Flak does NOT read that way (else the run is not the Flak's to lack);
//   - neither mover reads that way either.
//
// A build that reads air-only on every emitter fails; one that reads ground and
// air on the Flak fails; one that reads ground and air on the Forge fails; one
// that draws no targeting read at all fails.
//
// BOTH PANELS, BECAUSE THE REQUIREMENT NAMES BOTH. The hover pass hovers each of
// the eight entries in turn on an empty floor. The inspector pass poses one tower
// of each type in turn, at level I with nothing else on the floor, and selects
// it. A build whose hover panel reads targeting and whose inspector does not must
// grade apart from one where both do, so the two are asserted separately.
//
// EACH TOWER STANDS ALONE. The floor is cleared between one type and the next, so
// the panel a reading is taken from is answering for that tower and no other, and
// no two footprints ever abut — which would move a heat and with it a damage
// read, and could make two panels differ for a reason that is not the targeting.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { TOWER_DEFS, TOWER_TYPES, type TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, runTexts } from "./panel";
import { FREE_SITE } from "./sites";

/** The five emitters specs/hud.md says read as hitting ground and air. */
const GROUND_AND_AIR: readonly TowerType[] = TOWER_TYPES.filter(
  (type) => TOWER_DEFS[type].kind === "emitter" && type !== "flak",
);

/** The three that must not: the air-only Flak, and the two that never fire. */
const NOT_GROUND_AND_AIR: readonly TowerType[] = TOWER_TYPES.filter(
  (type) => TOWER_DEFS[type].kind === "mover" || type === "flak",
);

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
function fieldsOf(texts: Iterable<string>): Set<string> {
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

/** The reads the five share and the other three lack. One is the targeting read. */
function sharedByTheFive(panels: Map<TowerType, Set<string>>): string[] {
  const [first, ...rest] = GROUND_AND_AIR;
  const start = panels.get(first) ?? new Set<string>();
  return [...start].filter(
    (run) =>
      rest.every((type) => panels.get(type)?.has(run) === true) &&
      NOT_GROUND_AND_AIR.every((type) => panels.get(type)?.has(run) !== true),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws one read the five ground-and-air emitters share and the other three lack", async () => {
  startRun(h);

  // The hover panel, on an empty floor.
  const hovered = new Map<TowerType, Set<string>>();
  for (const type of TOWER_TYPES) {
    h.debug.setHoverShop(type);
    hovered.set(type, fieldsOf(runTexts(await readPanel(h))));
    if (type === "flak") captureStill(h, "targeting");
  }
  h.debug.setHoverShop(null);

  // The inspector, one tower at a time so nothing else stands on the floor.
  const selected = new Map<TowerType, Set<string>>();
  for (const type of TOWER_TYPES) {
    h.debug.setSelected(null);
    h.debug.clearTowers();
    const id = poseTower(h, type, FREE_SITE.col, FREE_SITE.row);
    h.debug.setSelected(id);
    selected.set(type, fieldsOf(runTexts(await readPanel(h))));
  }

  const onHover = sharedByTheFive(hovered);
  const onInspector = sharedByTheFive(selected);

  assertGreaterThanOrEqual(
    onHover.length,
    1,
    "a read the hover panel draws for the Arc, Stutter, Rime, Bloom and Lance " +
      "and draws for neither the Flak nor the Forge nor the Sink, which is " +
      "the ground-and-air targeting read (specs/hud.md)",
  );
  assertGreaterThanOrEqual(
    onInspector.length,
    1,
    "the same read on the inspector of a selected tower of each of the eight " +
      "types (specs/hud.md)",
  );
});
