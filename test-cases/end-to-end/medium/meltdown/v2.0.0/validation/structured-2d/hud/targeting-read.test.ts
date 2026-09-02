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
    hovered.set(type, runTexts(await readPanel(h)));
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
    selected.set(type, runTexts(await readPanel(h)));
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
