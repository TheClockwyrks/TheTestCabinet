// hazards/lava-contact-drain — touching lava bleeds hull for as long as it lasts.
//
// `specs/hazards.md` fixes the drain: "Contact drains hull at `LAVA_CONTACT_DPS`
// for as long as the miner's box overlaps a lava cell", 32 hull a second before
// the radiator. So the miner's box is posed inside a single lava cell at
// radiator tier 1, a fixed span of game time is run, and the hull lost is held
// against `LAVA_CONTACT_DPS` times that span.
//
// Both faculties are gated. Travel is what would otherwise carry the miner out
// of the cell the moment the game's own collision resolved the overlap, and the
// drill is what would otherwise let the cell be cut, which
// `specs/hazards.md` charges differently. What is left running is the drain.
//
// The span is read as game time rather than as frames: every rate in this game
// is integrated against the frame's delta, so four seconds in a hundred and
// twenty frames drains what four seconds in ten thousand would.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { LAVA_CONTACT_DPS } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { armHull, bandRow, HAZARD_COL, soakIn } from "./scene";

/** The tier whose hull outlasts the whole span with room to read the loss. */
const HULL_TIER = 5;

/** The contact span, and the frames it is run in. */
const SECONDS = 4;
const FRAMES = 120;

/** How far the reading may sit from the rate: a couple of frames of drain. */
const TOLERANCE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drains LAVA_CONTACT_DPS a second for the whole of the overlap", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);
  h.debug.setTier("radiator", 1);
  armHull(h, HULL_TIER);
  const row = bandRow(h.snapshot(), "deepstone");
  h.debug.setTile(HAZARD_COL, row, "lava");
  soakIn(h, HAZARD_COL, row);

  const before = h.snapshot();
  const after = await captureReplay(h, "contact", async () => {
    await h.advanceSeconds(SECONDS, FRAMES);
    return h.snapshot();
  });

  const expected = LAVA_CONTACT_DPS * SECONDS;
  assertBetween(
    before.miner.hull - after.miner.hull,
    expected - TOLERANCE,
    expected + TOLERANCE,
    `specs/hazards.md, ${SECONDS} seconds of contact`,
  );
  // The cell is still lava, so the drain above is contact rather than a cell
  // that quietly broke under an idle miner.
  assertEqual(h.tileAt(HAZARD_COL, row).kind, "lava", "specs/world.md");
});
