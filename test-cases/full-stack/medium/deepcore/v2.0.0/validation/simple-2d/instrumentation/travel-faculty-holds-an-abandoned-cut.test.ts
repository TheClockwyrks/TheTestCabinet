// instrumentation/travel-faculty-holds-an-abandoned-cut — a cut given up part
// way moves a held miner nowhere.
//
// `specs/instrumentation.md`, on the travel faculty: with it off "the miner's
// body holds the position it stands at, however long the scenario runs and
// whatever is held on the keyboard: gravity, walking, thrust, knockback, and
// collision displacement all move it nowhere, and its velocity stays where it
// was posed."
//
// `instrumentation/travel-faculty` decides that rule against gravity, a walk and
// thrust, and against a cut that is HELD. This is the edge case beside it: a down
// cut that is ABANDONED. A build that sinks the miner into the cell it is boring
// has to put the body back when the key comes up, or its own collision resolver
// reads the embedding as walking into a wall — and that put-back is a write to
// the body like any other, so the faculty holds it too. It is the one body write
// a scenario only reaches by letting a key UP and then running a frame, which is
// why the held cut never sees it.
//
// The cell's health is read at the end as well, because what the faculty holds is
// TRAVEL and not the drill: the cut must really have run for the abandonment to
// be an abandonment.
//
// ISOLATION. An empty mine holding one minable cell, the miner stood on it with
// its body held and its drill left running, and nothing else in the world.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BAND_HEALTH } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinMiner,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 8;

/** A row well inside the coreshell, whose cells take many hits to break. */
const ROW = 440;

/** Half a second held, so the cut is well under way but nowhere near through. */
const HELD_FRAMES = TICK_HZ / 2;

/** Frames run after the key comes up, which is when the put-back would land. */
const RELEASED_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the body exactly as posed when a down cut is given up part way", async () => {
  openScene(h);
  h.debug.setTile(COL, ROW, "rock");
  standOn(h, COL, ROW);
  pinMiner(h);

  const posed = h.snapshot();
  assertEqual(posed.miner.travel, false, "the travel faculty");
  assertEqual(posed.miner.x, minerXOn(COL), "the posed x");
  assertEqual(posed.miner.y, minerYOn(ROW), "the posed y");

  const run = await captureReplay(h, "held", async () => {
    h.hold(ACTION_KEY.down);
    await h.advance(HELD_FRAMES);
    const cutting = h.snapshot();

    // The key comes up and the frames that follow it are RUN. That is the whole
    // of the edge case: a put-back happens on the frame after the release, and a
    // check that released and read the same instant would never see it.
    h.releaseAll();
    await h.advance(RELEASED_FRAMES);
    return { cutting, after: h.snapshot(), tile: h.tileAt(COL, ROW) };
  });

  assertEqual(
    run.cutting.miner.drilling?.dir,
    "down",
    "the cut that is then abandoned was a down cut",
  );
  assertEqual(run.cutting.miner.drilling?.row, ROW, "the cell it was boring");

  assertEqual(
    run.after.miner.x,
    minerXOn(COL),
    "specs/instrumentation.md: the x a held body holds",
  );
  assertEqual(
    run.after.miner.y,
    minerYOn(ROW),
    "specs/instrumentation.md: the y a held body holds",
  );
  assertEqual(
    run.after.miner.vx,
    0,
    "specs/instrumentation.md: the vx it was posed with",
  );
  assertEqual(
    run.after.miner.vy,
    0,
    "specs/instrumentation.md: the vy it was posed with",
  );

  // The faculty held is travel, not the drill: the cut really ran.
  assertGreaterThan(
    BAND_HEALTH.coreshell - (run.tile.health ?? 0),
    0,
    "the health the abandoned cut took off the cell",
  );
});
