// instrumentation/snapshot-derived — the derived figures follow their sources.
//
// `specs/instrumentation.md`: "Several fields are derived rather than stored:
// `depthMeters` and `deepestDepthMeters` from the miner's position, `overloaded`
// from `loadKg` against `liftLimitKg`, and `drilling.progress`, which runs `0` to
// `1` as the target cell's health drains."
//
// The point is not what those figures read at one moment — the depth in meters
// belongs to the world's own point, the overload wall to the weight ones — it is
// that each MOVES WHEN ITS SOURCE MOVES. A build that computes a figure once and
// keeps it reports a prospector at the depth it started from, a bay that is
// overloaded until something else refreshes the flag, and a cut whose progress bar
// jumps from empty to full.
//
// So each is read against its source twice over, at values the check moved:
//
//  - `depthMeters` across two posed positions, as the DIFFERENCE the positions
//    imply, which follows the specification's formula without restating the
//    calibration the world's own point owns.
//  - `overloaded` across a load under the lift limit and one over it, against
//    `loadKg` and `liftLimitKg` as the snapshot itself reports them.
//  - `drilling.progress` sampled through a real cut, against the health the same
//    surface reports for the cell being cut, hit by hit.
//
// The cut runs in the coreshell, whose `BAND_HEALTH` of `16` gives the deepest
// band's cells the most hits to break and so the most points on the way from `0`
// to `1`.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_HEALTH, METERS_PER_ROW, TILE } from "../../src/constants";
import { assertCloseTo, assertEqual, assertNotNull } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  loadToFraction,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  placeAt,
  standOn,
  type Harness,
} from "../harness";

const COL = 8;
/** A row well inside the coreshell at the Standard size. */
const DEEP_ROW = 440;
/** Two posed positions the depth is read across. */
const SHALLOW_ROW = 40;

/** How often the cut is sampled, in frames: a little over one hit's interval. */
const SAMPLE_EVERY = 16;
const CUT_FRAMES = 240;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves depthMeters, overloaded and drilling.progress with their sources", async () => {
  openScene(h);
  pinDrill(h);

  // depthMeters follows the position: the difference between two posed depths is
  // the difference the specification's formula gives for them.
  placeAt(h, minerXOn(COL), minerYOn(SHALLOW_ROW));
  await h.advance(1);
  const shallow = h.snapshot().depthMeters;
  placeAt(h, minerXOn(COL), minerYOn(DEEP_ROW));
  await h.advance(1);
  const deep = h.snapshot().depthMeters;
  assertCloseTo(
    deep - shallow,
    ((DEEP_ROW - SHALLOW_ROW) * TILE * METERS_PER_ROW) / TILE,
    1,
    "the depth gained between two posed positions",
  );

  // overloaded follows the load against the lift limit, in both directions.
  loadToFraction(h, 0.5);
  await h.advance(1);
  const light = h.snapshot();
  assertEqual(
    light.miner.overloaded,
    light.cargo.loadKg >= light.cargo.liftLimitKg,
    `overloaded at ${light.cargo.loadKg} kg against a limit of ${light.cargo.liftLimitKg}`,
  );
  assertEqual(
    light.miner.overloaded,
    false,
    "overloaded at half the lift limit",
  );

  loadToFraction(h, 1);
  await h.advance(1);
  const heavy = h.snapshot();
  assertEqual(
    heavy.miner.overloaded,
    heavy.cargo.loadKg >= heavy.cargo.liftLimitKg,
    `overloaded at ${heavy.cargo.loadKg} kg against a limit of ${heavy.cargo.liftLimitKg}`,
  );
  assertEqual(heavy.miner.overloaded, true, "overloaded at the lift limit");

  // drilling.progress follows the target cell's health, all the way down.
  h.debug.clearCargo();
  h.debug.setTile(COL, DEEP_ROW, "rock");
  standOn(h, COL, DEEP_ROW);
  h.debug.setMinerDrill(true);

  const samples = await captureReplay(h, "derived", async () => {
    const taken: { progress: number; health: number }[] = [];
    h.hold(ACTION_KEY.down);
    try {
      for (let frames = 0; frames < CUT_FRAMES; frames += SAMPLE_EVERY) {
        await h.advance(SAMPLE_EVERY);
        const tile = h.tileAt(COL, DEEP_ROW);
        if (tile.kind !== "rock" || tile.health === null) break;
        const cut = h.snapshot().miner.drilling;
        assertNotNull(cut, "the cut in progress while down is held");
        taken.push({ progress: cut?.progress ?? -1, health: tile.health });
      }
    } finally {
      h.release(ACTION_KEY.down);
    }
    return taken;
  });

  assertEqual(
    samples.length >= 3,
    true,
    `samples taken through the cut, and got ${samples.length}`,
  );
  for (const { progress, health } of samples) {
    assertCloseTo(
      progress,
      1 - health / BAND_HEALTH.coreshell,
      3,
      `drilling.progress at ${health} of ${BAND_HEALTH.coreshell} health`,
    );
  }
});
