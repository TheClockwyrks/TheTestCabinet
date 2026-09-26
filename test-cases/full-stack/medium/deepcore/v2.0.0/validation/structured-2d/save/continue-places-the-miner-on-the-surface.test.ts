// save/continue-places-the-miner-on-the-surface — a restored expedition opens
// with the miner back on the camp.
//
// specs/expedition.md: "The main menu shows `CONTINUE` while a save exists, which
// resumes it exactly as it was saved and places the miner on the surface", and
// specs/modes.md says the same of restoring after a Standard death. So wherever
// the miner was when the game went back to the title, the resumed expedition
// stands it on the camp ground at depth 0 rather than dropping it back down the
// shaft.
//
// THE MINER IS DEEP WHEN THE TITLE IS REACHED. The save is written at the camp,
// because that is the only place the pad allows it; the miner is then taken far
// underground and the game returned to the title from there, so the restore has
// somewhere to bring it back FROM. Its depth, its row and its grounded flag are
// the three readings that say it arrived.
//
// ISOLATION. An empty mine with the camp's ground laid back as generation leaves
// it, the slot cleared first, and nothing carried, held or installed. The drill
// is gated because nothing here cuts; travel is left running, because standing on
// the camp rather than falling through it is part of what is read.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  minerXOn,
  minerYOn,
  pinDrill,
  type Harness,
} from "../harness";
import {
  SURFACE_ROW,
  bankSave,
  continueFromTitle,
  openAtCamp,
} from "./expedition";

/** Where the miner is taken before the game goes back to the title. */
const DEEP_COL = 12;
const DEEP_ROW = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("stands the miner on the camp at depth 0 after a continue", async () => {
  await openAtCamp(h);
  bankSave(h);

  pinDrill(h);
  h.debug.setMinerPosition(minerXOn(DEEP_COL), minerYOn(DEEP_ROW));
  await h.advance(1);
  const deep = h.snapshot();
  // The arrangement's own reading: the miner really is far underground, so the
  // restore below has somewhere to bring it back from.
  assertGreaterThan(
    deep.depthMeters,
    0,
    "the miner was underground when the game returned to the title",
  );

  await continueFromTitle(h);
  await h.advance(1);

  const resumed = h.snapshot();
  captureStill(h, "surface");
  assertEqual(
    resumed.screen,
    "in-mine",
    "specs/ui.md: CONTINUE resumes the save into in-mine",
  );
  assertCloseTo(
    resumed.depthMeters,
    0,
    0,
    "specs/expedition.md: continuing places the miner on the surface",
  );
  assertLessThanOrEqual(
    resumed.miner.row,
    SURFACE_ROW,
    "specs/world.md: row 0 is the camp the miner is placed back on",
  );
  assertEqual(
    resumed.miner.grounded,
    true,
    "specs/expedition.md: the miner stands on the camp ground rather than falling",
  );
});
