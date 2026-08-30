// foes/dropper-first-bolt-speeds-up — a dropper falls faster once it has taken
// its first bolt.
//
// `specs/foes.md`: "It sets the dropper's hit flag, and from that moment the
// dropper falls at DROPPER_SPEED_HIT for the rest of its fall." So the rate is
// measured AFTER a real bolt has struck, over a span that opens once the bolt
// has certainly resolved, and it is `DROPPER_SPEED_HIT` (`320`) that the
// distance is read against — a build that left the dropper at the unhit
// `DROPPER_SPEED` (`150`) is named by the number it produced.
//
// WHAT THIS POINT DOES NOT DECIDE. Whether the dropper survives that bolt and
// carries the flag is foes/dropper-first-bolt-survives's requirement, and a
// build that got that wrong is docked there rather than twice — but the flag the
// dropper is carrying when the span opens is carried into this failure message,
// so a rate that came out unchanged says why.
//
// THE MIND IS HELD OFF and the travel runs throughout: laying a node is a
// faculty of the mind (`specs/instrumentation.md`) and takes no part in how fast
// a dropper falls, while the fall itself is the reading. The dropper is posed
// high on the board, so the approach, the strike and the whole measured span
// stay well above the bottom edge it would leave through.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOLT_SPEED,
  DROPPER_SPEED,
  DROPPER_SPEED_HIT,
  FOE_HALF,
  TILE,
} from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseBolt,
  poseFoe,
  requireFoe,
  startPlaying,
  type Harness,
} from "../harness";

/** The tile the dropper is posed on: high on the board, clear of the bottom. */
const TILE_C = 10;
const TILE_R = 2;

/**
 * How far below the dropper the bolt is posed, in tiles. Two tiles is `64` units
 * between the two centers, which starts the bolt well outside the `FOE_HALF`
 * box, so it has to travel into it rather than beginning inside it.
 */
const APPROACH_TILES = 2;
const APPROACH = APPROACH_TILES * TILE;

/**
 * How long the bolt is given to climb before the measured span opens, in
 * seconds.
 *
 * The bolt closes on a falling dropper at `BOLT_SPEED` plus its fall rate, which
 * covers the `APPROACH` in under `0.061` s however fast the dropper is falling,
 * so a tenth of a second is more than the strike takes.
 */
const FLIGHT_SECONDS = 0.1;

/** The span the fall is measured over, once the bolt has resolved. */
const SPAN_SECONDS = 1;
const SPAN_FRAMES = framesFor(SPAN_SECONDS);

/** What `specs/foes.md` fixes a hit dropper falls over that span. */
const EXPECTED_FALL = DROPPER_SPEED_HIT * SPAN_SECONDS;

/** The review item's margin: 5% of the specified fall. */
const TOLERANCE = 0.05 * EXPECTED_FALL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("falls at the hit dropper's speed once a bolt has struck it", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "dropper", TILE_C, TILE_R, { mind: false });

  await poseBolt(h, TILE_C, TILE_R + APPROACH_TILES);
  await h.advance(framesFor(FLIGHT_SECONDS));

  const before = requireFoe(
    await h.snapshot(),
    id,
    "the dropper the first bolt struck, whose fall rate is being measured",
  );
  await h.advance(SPAN_FRAMES);
  const after = requireFoe(
    await h.snapshot(),
    id,
    "the hit dropper that was falling",
  );

  await captureStill(h, "faster");
  const fell = after.y - before.y;
  assertLessThanOrEqual(
    Math.abs(fell - EXPECTED_FALL),
    TOLERANCE,
    `the center falls ${EXPECTED_FALL} units over ${SPAN_SECONDS} s ` +
      `(DROPPER_SPEED_HIT ${DROPPER_SPEED_HIT}, against the unhit ` +
      `DROPPER_SPEED ${DROPPER_SPEED}) after a bolt climbing ${APPROACH} ` +
      `units at BOLT_SPEED ${BOLT_SPEED} into its ${FOE_HALF}-unit box left ` +
      `its hit flag ${String(before.hit)}; the distance fallen was ${fell}, ` +
      `off by`,
  );
});
