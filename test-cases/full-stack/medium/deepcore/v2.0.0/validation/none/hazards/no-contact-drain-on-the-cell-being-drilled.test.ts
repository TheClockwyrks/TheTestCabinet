// hazards/no-contact-drain-on-the-cell-being-drilled — one charge, not two.
//
// `specs/hazards.md` carves the exception out by hand: "The contact drain is not
// charged on the cell currently being drilled: that cell's heat is the lump." So
// cutting into lava costs `LAVA_DRILL_DEEPSTONE` and nothing else, however long
// the cut takes.
//
// THE POSE IS THE ONE THAT MAKES IT DECIDABLE. `specs/character.md` says a down
// cut sinks: "the miner's feet travel from the top of that cell to its bottom in
// proportion to the cut's progress", but only where the cell below the one being
// cut is solid, since "With open space or lava below the cell being cut, the
// miner does not sink." So a plain rock cell is laid under the lava, and the
// miner really does travel down through the lava cell it is cutting, with its
// box inside that cell for most of the cut. A build that charged the drain on
// the cell under the drill would charge it for nearly the whole descent.
//
// The cut runs at drill tier 1 on purpose, where `specs/upgrades.md`'s twelve
// hits take a second and a half: the whole point is a long stay inside the cell,
// and the drain that stay would carry is 48 hull, which no tolerance here could
// hide.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLessThan } from "../assert";
import {
  BAND_HEALTH,
  DRILL_DAMAGE,
  DRILL_HIT_INTERVAL,
  drillHitsFor,
  LAVA_CONTACT_DPS,
  LAVA_DRILL_DEEPSTONE,
} from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  openScene,
  standOn,
  type Harness,
} from "../harness";
import { armHull, bandRow, HAZARD_COL } from "./scene";

/** The tier whose hull survives the lump and would survive the drain as well. */
const HULL_TIER = 5;

/** How far the reading may sit from the lump, in hull points. */
const TOLERANCE = 3;

/** The seconds twelve hits at drill tier 1 take, which is how long a drain would run. */
const CUT_SECONDS =
  drillHitsFor(BAND_HEALTH.deepstone, DRILL_DAMAGE[0]) * DRILL_HIT_INTERVAL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("charges a lava cut the lump alone, not the lump and a drain", async () => {
  await openScene(h);
  await h.debug.setTier("drill", 1);
  await h.debug.setTier("radiator", 1);
  const full = await armHull(h, HULL_TIER);
  const row = bandRow(await h.snapshot(), "deepstone");

  // Lava to cut, with solid rock beneath it so the miner sinks through the cell
  // it is cutting rather than hovering above an opening.
  await h.debug.setTile(HAZARD_COL, row, "lava");
  await h.debug.setTile(HAZARD_COL, row + 1, "rock");
  await standOn(h, HAZARD_COL, row);

  const cut = await captureReplay(h, "once", () =>
    driveCut(h, "down", { col: HAZARD_COL, row }),
  );

  assertEqual(cut.broke, true, "specs/hazards.md");
  const loss = full - cut.snapshot.miner.hull;
  assertBetween(
    loss,
    LAVA_DRILL_DEEPSTONE - TOLERANCE,
    LAVA_DRILL_DEEPSTONE + TOLERANCE,
    "specs/hazards.md, the lump alone",
  );
  // Stated the other way round as well, against the drain the cut would have
  // carried had the cell under the drill been charged for it.
  assertLessThan(
    loss,
    LAVA_DRILL_DEEPSTONE + LAVA_CONTACT_DPS * CUT_SECONDS * 0.5,
    "specs/hazards.md, no contact drain on the cell being drilled",
  );
});
