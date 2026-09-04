// world/deepest-depth-holds — the deepest depth reached does not fall back.
//
// `specs/instrumentation.md` carries `deepestDepthMeters` beside `depthMeters`,
// and `specs/gameplay.md` has the summary report "the deepest depth reached in
// meters" rather than where the expedition ended. So the figure is a high-water
// mark: it follows the miner down and holds while the miner climbs back toward
// the surface. A build that simply mirrored `depthMeters` would report a
// prospector who dug to two thousand meters and flew home as having reached the
// camp.
//
// THE READING IS TAKEN AT THE TOP OF THE CLIMB, not after it. The shaft has a
// floor, so a miner that let go would fall back to the depth it started at and
// the two figures would agree again for an honest reason; what decides the point
// is the moment the miner is demonstrably shallower than it has been.
//
// The drill is held for the climb, because thrust is what is being read.

import { afterEach, beforeEach, it } from "vitest";
import { METERS_PER_ROW, TILE } from "../../src/constants";
import { assertBetween, assertLessThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  digShaft,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

const COL = 8;
/** The shaft the climb runs up, and the solid cell the miner starts standing on. */
const TOP_ROW = 6;
const FLOOR_ROW = 41;

/** Seconds of held thrust, and the frames they are run in. */
const CLIMB_SECONDS = 2;
const CLIMB_FRAMES = 240;

/** How much shallower the climb has to leave the miner, in meters. */
const CLIMB_MARGIN = 40;

/**
 * The meters one world unit is worth: the slack a standing reading is taken to,
 * since a miner at rest may sit a fraction of a frame's travel short of the face
 * it rests on.
 */
const UNIT_METERS = METERS_PER_ROW / TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the deepest depth while the miner climbs back toward the surface", async () => {
  openScene(h);
  digShaft(h, COL, TOP_ROW, FLOOR_ROW - 1);
  standOn(h, COL, FLOOR_ROW);
  pinDrill(h);
  await h.advance(2);

  const bottom = h.snapshot();
  const reached = METERS_PER_ROW * (FLOOR_ROW - 1);
  assertBetween(
    bottom.depthMeters,
    reached - UNIT_METERS,
    reached + UNIT_METERS,
    "the depth the shaft bottoms at",
  );
  assertBetween(
    bottom.deepestDepthMeters,
    reached - UNIT_METERS,
    reached + UNIT_METERS,
    "the deepest depth on arriving",
  );

  const top = await captureReplay(h, "climb", async () => {
    h.hold(ACTION_KEY.up);
    await h.advanceSeconds(CLIMB_SECONDS, CLIMB_FRAMES);
    const climbed = h.snapshot();
    h.release(ACTION_KEY.up);
    return climbed;
  });

  // The climb really left the shaft's floor behind ...
  assertLessThan(
    top.depthMeters,
    reached - CLIMB_MARGIN,
    "the depth at the top of the climb",
  );
  // ... and the deepest depth stayed where the descent left it.
  assertBetween(
    top.deepestDepthMeters,
    reached - UNIT_METERS,
    reached + UNIT_METERS,
    "the deepest depth after climbing back",
  );
});
