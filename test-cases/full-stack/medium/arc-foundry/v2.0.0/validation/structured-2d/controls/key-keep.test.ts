// controls/key-keep — `KeyK` harvests the selected candidate.
//
// THE REQUIREMENT. `specs/controls.md` binds `keep` to `KeyK`: "Harvests the
// selected candidate." `specs/scrap-press.md` says what that produces — "the
// selected candidate becomes a permanent component at its rolled type and
// quality" — and that committing the harvest is what starts the wave, there being
// no send control at all.
//
// HOW IT IS DECIDED. One candidate is dropped through the real press onto an
// otherwise empty yard, with its roll armed so the check knows what it is holding
// against, and selected. `KeyK` is then pressed as a player presses it, a real key
// event dispatched at the engine's own surface. What is read back is the structure
// standing on those tiles and the phase the run is now in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTruthy } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  pressAction,
  standCandidate,
  structureAt,
} from "../harness";
import { keyFor } from "../constants";

/** Where the candidate is dropped: clear of the chain and of the yard edges. */
const ANCHOR = { col: 10, row: 0 };

/** What the press is armed to roll, so the harvest has a known type and tier. */
const TYPE = "capacitor";
const TIER = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("harvests the selected candidate and starts the wave when KeyK is pressed", async () => {
  openYard(h);
  const id = standCandidate(h, TYPE, TIER, ANCHOR.col, ANCHOR.row);
  h.debug.select(id);

  const posed = h.snapshot();
  assertEqual(
    posed.phase,
    "build",
    "a build phase, which is where `keep` is available (specs/controls.md)",
  );

  await pressAction(h, "keep");
  captureStill(h, "kept");

  const after = h.snapshot();
  const kept = structureAt(after, ANCHOR.col, ANCHOR.row);
  assertTruthy(
    kept,
    `a structure still standing at (${ANCHOR.col}, ${ANCHOR.row}) after the ` +
      "keep key (specs/scrap-press.md)",
  );
  assertEqual(
    kept!.kind,
    "component",
    `pressing ${keyFor("keep")} to turn the selected candidate into a ` +
      "permanent component (specs/controls.md, specs/scrap-press.md)",
  );
  assertEqual(
    kept!.type,
    TYPE,
    "the harvested component's type, which keep leaves as it rolled " +
      "(specs/scrap-press.md)",
  );
  assertEqual(
    kept!.quality,
    TIER,
    "the harvested component's quality, which keep leaves as it rolled " +
      "(specs/scrap-press.md)",
  );

  // Committing the harvest is what starts the wave: there is no send control
  // (specs/campaign.md, specs/scrap-press.md).
  assertEqual(
    after.phase,
    "wave",
    "the phase after the level's harvest is committed (specs/scrap-press.md)",
  );
});
