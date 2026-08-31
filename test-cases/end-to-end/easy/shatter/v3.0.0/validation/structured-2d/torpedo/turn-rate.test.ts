// torpedo/turn-rate — a torpedo swings its heading at TORPEDO_TURN and no faster.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The guidance: "With a target, the
// torpedo turns its heading toward that target's current position at up to
// `TORPEDO_TURN` (`160` degrees per second), keeping its speed."
//
// WHAT IS MEASURED IS THE PER-TICK STEP, NOT A TOTAL. The heading is read every
// tick and the SIGNED STEP between consecutive readings is compared against
// `TORPEDO_TURN * TICK_DT` (`1.333` degrees). Reading it that way is what makes
// the item decidable at all:
//
//   - A total over a window would be a tick's worth out for a build that acquires
//     on the tick after the pose rather than on it, and `specs/simulation.md`
//     leaves that free. One tick is a tenth of the window, twice the tolerance the
//     review item states — so a check on the total would fail conforming builds.
//     A step is the same number wherever the turn started.
//   - The rate is a CAP, so only a saturated turn measures it. A step is saturated
//     for exactly as long as the heading error exceeds one step's worth, and the
//     window below is chosen to sit inside that span.
//
// THE ERROR IS POSED AT THE EDGE OF THE CONE, `14` degrees, and it cannot be
// posed wider: `specs/weapons.md` makes a body a candidate only within
// `TORPEDO_CONE` (`15` degrees) of the current heading, so `15` degrees is the
// LARGEST heading error a torpedo can ever be carrying when it acquires. That is
// worth stating plainly, because it means the review item's "a target 90 degrees
// off" is not a scenario this specification allows: a body `90` degrees off the
// heading is never acquired, and a torpedo posed with one turns by nothing. What
// this check measures instead is the same rate, over the widest error the rules do
// allow.
//
// THE WINDOW IS TICKS 2 THROUGH 8. At `14` degrees of error closing at
// `TORPEDO_TURN` — a little slower in practice, because the bearing to a target
// off the beam drifts further off as the torpedo runs past it — the turn stays
// saturated for about eleven ticks. Starting at tick 2 skips whichever tick a
// build takes to acquire, and stopping at tick 8 leaves three ticks of margin
// before the error is spent and the torpedo settles onto the bearing.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build at half the rate reads
// `0.67` degrees a tick; one that turns instantly onto the bearing reads `14` on
// its first step and `0` after; one that took `TORPEDO_TURN` for a figure in
// DEGREES when `src/constants.ts` gives it in radians reads `0.023`. The sign is
// asserted too, so a build that turns the wrong way is not read as a build with
// the right rate.
//
// THE PAIR STANDS IN THE RIGHT OF THE FIELD, `574` units from the star's centre,
// where the well moves the rock under a unit over the twelve ticks that are read —
// and `specs/gravity.md` never pulls the torpedo at all. The separation is `485`
// units across and `121` up, inside half the field on both axes, so the bearing
// `specs/field.md` means is the bearing this check posed.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, TICK_DT, TORPEDO_TURN } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { angleDelta } from "../geometry";
import {
  captureReplay,
  createHarness,
  poseRock,
  sampleEvery,
  startPlaying,
  type Harness,
} from "../harness";
import { poseTorpedo, standTheShipClear } from "./scenario";

/** Where the torpedo starts, and which way it is going: right, away from the star. */
const TORPEDO_X = 700;
const TORPEDO_Y = 660;
const HEADING = 0;

/**
 * How far off the heading the target is posed, in radians, and how far out.
 *
 * `14` degrees: one degree inside `TORPEDO_CONE`, which is the widest heading
 * error the specification lets a torpedo acquire at. Negative, so the turn runs
 * counter-clockwise and a build that turns the other way reads the opposite sign.
 */
const TARGET_OFF = -14 * DEG;
const TARGET_RANGE = 500;

/** How many ticks are sampled, and the window of steps the rate is read from. */
const SAMPLE_TICKS = 12;
const FIRST_STEP = 2;
const LAST_STEP = 8;
/** More flight after the reading, so the recording ends on the torpedo landing. */
const TAIL_TICKS = 140;

/** What one tick of a saturated turn is worth, in radians. */
const STEP = TORPEDO_TURN * TICK_DT;

/**
 * How far each step may fall from it, in radians.
 *
 * 5 percent of the step, the figure the review item states — `0.067` degrees
 * against a step of `1.333`. While the turn is saturated the step IS the cap, so
 * a conforming build has no latitude on it beyond its own arithmetic; the window
 * is chosen so that every step read is saturated, which is what lets the tolerance
 * be this tight.
 */
const STEP_TOLERANCE = 0.05 * STEP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("swings a torpedo's heading at TORPEDO_TURN while its target is off the beam", async () => {
  startPlaying(h);
  standTheShipClear(h);
  poseRock(
    h,
    "large",
    TORPEDO_X + Math.cos(HEADING + TARGET_OFF) * TARGET_RANGE,
    TORPEDO_Y + Math.sin(HEADING + TARGET_OFF) * TARGET_RANGE,
  );
  const id = poseTorpedo(h, TORPEDO_X, TORPEDO_Y, HEADING);

  const headings = await captureReplay(h, "turn", async () => {
    const samples = await sampleEvery(
      h,
      SAMPLE_TICKS,
      1,
      (s) => s.torpedoes?.find((torpedo) => torpedo.id === id)?.heading,
    );
    // And the rest of the run onto the rock, for the reviewer.
    await h.advance(TAIL_TICKS);
    return samples;
  });

  const flown = headings.filter((heading) => heading !== undefined);
  assertEqual(
    flown.length,
    headings.length,
    `the torpedo in flight for all ${SAMPLE_TICKS} ticks of the turn — its ` +
      "target is a further second of travel on from where this window ends " +
      "(specs/weapons.md)",
  );

  for (let step = FIRST_STEP; step <= LAST_STEP; step += 1) {
    const turned = angleDelta(flown[step - 1], flown[step]);
    assertLessThanOrEqual(
      Math.abs(turned - Math.sign(TARGET_OFF) * STEP),
      STEP_TOLERANCE,
      `the torpedo's heading to swing ${(STEP / DEG).toFixed(3)} degrees on ` +
        `tick ${step} of a turn onto a target ` +
        `${Math.abs(TARGET_OFF / DEG).toFixed(0)} degrees off its heading — ` +
        `TORPEDO_TURN (${(TORPEDO_TURN / DEG).toFixed(0)} degrees per second) ` +
        `for one tick of TICK_DT, toward the target and so ` +
        `${TARGET_OFF < 0 ? "counter-clockwise" : "clockwise"} — within ` +
        `${(STEP_TOLERANCE / DEG).toFixed(3)} (specs/weapons.md); it swung ` +
        `${(turned / DEG).toFixed(3)} degrees`,
    );
  }
});
