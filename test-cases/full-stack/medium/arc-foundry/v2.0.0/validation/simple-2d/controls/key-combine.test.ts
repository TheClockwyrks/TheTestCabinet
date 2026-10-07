// controls/key-combine — `KeyC` commits a combine from the selection.
//
// THE REQUIREMENT. `specs/controls.md` binds `combine` to `KeyC`: "Commits a
// combine from the current selection", and makes it available on a base structure
// "when a matching partner or a reachable recipe exists".
// `specs/scrap-press.md` fixes what the matching-partner case produces: "Two base
// structures of the same type and the same quality fold into one structure of
// that type one tier higher", the result lands "at the footprint of the piece the
// combine was initiated from", and the fold is wall-neutral, so "every footprint
// a combine consumes hardens into a blocker rather than being freed".
//
// HOW IT IS DECIDED. Two standing components of the same type at the same quality
// are the only things on the yard, so the only combine reachable is the quality
// fold between them, and one of them is selected. `KeyC` is pressed as a player
// presses it, a real key event dispatched at the engine's own surface. Both
// footprints are then read: the one the fold was initiated from carries the folded
// component a tier higher, and the one it consumed carries a blocker.
//
// WHY STANDING COMPONENTS RATHER THAN CANDIDATES. A combine that consumes a
// candidate is the level's harvest and starts the wave; a fold of standing
// structures alone leaves the phase running (`specs/scrap-press.md`). This point
// is the key, so the quieter of the two is what it is decided on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTruthy } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  pressAction,
  standComponent,
  structureAt,
} from "../harness";
import { keyFor } from "../constants";

/** The two footprints the pair is stood on, clear of the chain. */
const INITIATOR = { col: 10, row: 0 };
const PARTNER = { col: 13, row: 0 };

const TYPE = "capacitor";
const TIER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("folds a matching pair when KeyC is pressed", async () => {
  openYard(h);
  const initiator = standComponent(h, TYPE, TIER, INITIATOR.col, INITIATOR.row);
  standComponent(h, TYPE, TIER, PARTNER.col, PARTNER.row);
  h.debug.select(initiator);

  await pressAction(h, "combine");
  captureStill(h, "folded");

  const after = h.snapshot();

  const folded = structureAt(after, INITIATOR.col, INITIATOR.row);
  assertTruthy(
    folded,
    "a structure at the initiating footprint after the combine key " +
      "(specs/scrap-press.md)",
  );
  assertEqual(
    folded!.kind,
    "component",
    `pressing ${keyFor("combine")} on a base structure with a matching ` +
      "partner to fold the pair (specs/controls.md)",
  );
  assertEqual(
    folded!.type,
    TYPE,
    "the folded structure's type, which a quality fold never changes " +
      "(specs/scrap-press.md)",
  );
  assertEqual(
    folded!.quality,
    TIER + 1,
    `two ${TYPE}s at quality ${TIER} folding into one a tier higher ` +
      "(specs/scrap-press.md)",
  );

  // Wall-neutral: the consumed footprint hardens into a blocker rather than
  // opening a hole in the maze (specs/scrap-press.md).
  const consumed = structureAt(after, PARTNER.col, PARTNER.row);
  assertTruthy(
    consumed,
    "the consumed footprint to still hold a structure, because a combine is " +
      "wall-neutral (specs/scrap-press.md)",
  );
  assertEqual(
    consumed!.kind,
    "blocker",
    "the footprint the fold consumed, which hardens into a blocker " +
      "(specs/scrap-press.md)",
  );
});
