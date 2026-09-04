// foes/dropper-first-bolt-speeds-up — a dropper falls faster once it has taken
// its first bolt.
//
// specs/foes.md: "It sets the dropper's hit flag, and from that moment the
// dropper falls at DROPPER_SPEED_HIT for the rest of its fall."
//
// So the rate is measured AFTER a real bolt has struck, over a span that begins
// once the bolt has certainly resolved. What the check asserts is the rate
// alone: whether the dropper survives that bolt and carries the flag is
// foes/dropper-first-bolt-survives's requirement, so a build that got that wrong
// is docked there — but the flag it is carrying is carried into the failure
// here, so a rate that came out at the unhit DROPPER_SPEED names why.
//
// The dropper's mind is held off, since laying nodes is a faculty of the mind
// (specs/instrumentation.md) and takes no part in how fast it falls. Its travel
// runs throughout — the fall is the reading. It is posed high on the board, so
// the approach, the strike and the whole measured span stay well above the
// bottom edge it would leave through.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOLT_SPEED,
  DROPPER_SPEED,
  DROPPER_SPEED_HIT,
  FOE_HALF,
  TILE,
} from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldFoe, poseFoePoint, tileCenter } from "./harness";

/** The tile the dropper is posed on: high on the board, clear of the bottom. */
const TILE_C = 10;
const TILE_R = 2;
const START = tileCenter(TILE_C, TILE_R);

/**
 * How far below the dropper the bolt is posed, in tiles. Two tiles is `64`
 * units between the two centers, which begins the bolt well outside the foe's
 * FOE_HALF box, so it has to travel into it.
 */
const APPROACH_TILES = 2;
const APPROACH = APPROACH_TILES * TILE;

/**
 * How long the bolt is given to climb before the measured span opens. The bolt
 * closes on the falling dropper at BOLT_SPEED plus DROPPER_SPEED, which covers
 * the approach in `0.061` s, so a tenth of a second is more than it takes.
 */
const FLIGHT_SECONDS = 0.1;

/** The span the fall is measured over, once the bolt has resolved. */
const SPAN_SECONDS = 1;
const SPAN_FRAMES = ticksFor(SPAN_SECONDS);

/** What specs/foes.md fixes a hit dropper falls over that span. */
const EXPECTED_FALL = DROPPER_SPEED_HIT * SPAN_SECONDS;

/** The review item's margin: 5% of the specified fall. */
const TOLERANCE = 0.05 * EXPECTED_FALL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("falls at the hit dropper's speed once a bolt has struck it", async () => {
  startPlaying(h);
  const id = poseFoePoint(h, "dropper", START.x, START.y);
  h.debug.setFoeMind(id, false);

  poseBolt(h, TILE_C, TILE_R + APPROACH_TILES);
  await h.advance(ticksFor(FLIGHT_SECONDS));

  const before = heldFoe(h.snapshot(), id);
  await h.advance(SPAN_FRAMES);
  const after = heldFoe(h.snapshot(), id);
  captureStill(h, "faster");

  const fell = (after?.y ?? Number.NaN) - (before?.y ?? Number.NaN);
  assertLessThanOrEqual(
    Math.abs(fell - EXPECTED_FALL),
    TOLERANCE,
    `the center falls ${EXPECTED_FALL} units over ${SPAN_SECONDS} s ` +
      `(DROPPER_SPEED_HIT ${DROPPER_SPEED_HIT}, against the unhit ` +
      `DROPPER_SPEED ${DROPPER_SPEED}) after a bolt climbing ${APPROACH} ` +
      `units at BOLT_SPEED ${BOLT_SPEED} into its ${FOE_HALF}-unit box left ` +
      `its hit flag ${String(before?.hit)}; the distance fallen was ${fell}, ` +
      `off by`,
  );
});
