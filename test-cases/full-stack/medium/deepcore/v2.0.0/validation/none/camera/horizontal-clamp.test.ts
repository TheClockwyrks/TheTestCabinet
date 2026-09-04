// camera/horizontal-clamp — the camera stops at the two edges of the mine.
//
// specs/world.md: `camX = clamp(mx - VIEW_W / 2, 0, WORLD_W - VIEW_W)`. The mine
// is `WORLD_W` (2560) wide and the viewport `VIEW_W` (1280), so the camera has
// 1280 units of travel and stops dead at each end. This check decides the CLAMP
// half of that rule in both directions; the centring half is
// `camera/centers-horizontally`.
//
// The two border columns are the natural ends: column 0 and column 31 are
// bedrock, so the furthest a player ever stands is the playable column beside
// each, and the centred answer there is already well past the clamp.
//
// ISOLATION. An empty mine with the miner's body and drill both gated, so each
// pose holds exactly where it was put and nothing cuts.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThan, assertGreaterThan } from "../assert";
import {
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  VIEW_W,
  WORLD_W,
} from "../constants";
import {
  captureStill,
  createHarness,
  minerCenter,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";

/** The row the miner is posed on. Any minable row does; the rule is in x alone. */
const ROW = 20;

/** The camera's two stops, as specs/world.md states them. */
const LEFT_STOP = 0;
const RIGHT_STOP = WORLD_W - VIEW_W;

/** Half a unit: the specification fixes both stops exactly. */
const TOLERANCE_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the camera at both world edges rather than scrolling past them", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);

  await h.debug.setMinerPosition(minerXOn(PLAYABLE_COL_MIN), minerYOn(ROW));
  await h.debug.setMinerVelocity(0, 0);
  await h.advance(1);
  const left = await h.snapshot();
  // The arrangement's own arithmetic: at this column the centred answer is left
  // of the stop, so a build that did not clamp would report a negative camera.
  assertLessThan(
    minerCenter(left.miner).x - VIEW_W / 2,
    LEFT_STOP,
    "the leftmost playable column is past the left stop",
  );
  assertCloseTo(
    left.camera.x,
    LEFT_STOP,
    TOLERANCE_DIGITS,
    "specs/world.md: camX is clamped to 0 at the left border",
  );
  await captureStill(h, "edge");

  await h.debug.setMinerPosition(minerXOn(PLAYABLE_COL_MAX), minerYOn(ROW));
  await h.debug.setMinerVelocity(0, 0);
  await h.advance(1);
  const right = await h.snapshot();
  assertGreaterThan(
    minerCenter(right.miner).x - VIEW_W / 2,
    RIGHT_STOP,
    "the rightmost playable column is past the right stop",
  );
  assertCloseTo(
    right.camera.x,
    RIGHT_STOP,
    TOLERANCE_DIGITS,
    "specs/world.md: camX is clamped to WORLD_W - VIEW_W at the right border",
  );
});
