// insertion/tie-break-forward — an exact tie is broken toward the head.
//
// THE SPEC LINE. `specs/injector.md`, "Striking a core": "The core with the
// smallest center distance is struck, and a tie is broken toward the core with
// the larger arc position." `nearest-core` decides the first half of that
// sentence; this check decides the second.
//
// WHY THE ARRANGEMENT LOOKS THE WAY IT DOES. A tie is only a tie if the two
// centre distances are the SAME NUMBER. Two distances arranged to be equal to
// within a rounding error are not a tie at all: whichever of them happens to come
// out smaller in a build's last bit decides the strike by "smallest distance",
// the tie-break never runs, and the check grades floating point rather than the
// rule. So the equality here is structural, and it is built from two facts the
// specification fixes.
//
//   Leg 5 of the channel runs from `(840, 120)` to `(840, 420)`
//   (specs/channel.md's vertex table), so every core on it stands at `x = 840` —
//   the same `x`, whatever its arc position and whatever the tick advanced it by.
//
//   A projectile "appears with its center at the injector center, its heading
//   fixed at the current aim angle" and "travels in a straight line"
//   (specs/injector.md). Fired along `+x`, its heading is `(1, 0)` exactly, so it
//   holds the injector's own `y` of 330 for the whole flight.
//
// Two cores placed `HALF_GAP` above and below `y = 330` on leg 5 are therefore
// the same horizontal distance from the shot and equal and opposite vertical
// distances from it. The two centre distances are the same two numbers combined
// the same way, so they are equal exactly, at every tick of the flight and
// however a build integrated it. The tie is a fact about the geometry rather than
// an accident of the arithmetic.
//
// The pair is posed with a THIRD core well ahead of it, which is what makes both
// of them "Every other segment" (specs/channel.md, "Advance") rather than one of
// them the lead. Both then close at the fixed catch-up rate of 180 units/s, both
// are posed one tick of that rate short of where they must stand, and the tick
// the strike resolves on moves them by the same amount — which is what keeps them
// symmetric about `y = 330` when it matters.
//
// WHAT THE TIE DECIDES. The pair is `PAIR_GAP` (42 units) apart, so the two
// answers differ: the tie-break's core is the one with the LARGER arc position,
// the lower of the two on screen, and the shot arrives on its trailing side
// (`dot(d - c.position, f)` is negative against leg 5's downward forward), so the
// insertion seats one spacing behind it — `PAIR_GAP - SPACING` = 14 units AHEAD
// of the rear core. Breaking the tie the other way would seat at the rear core's
// own arc position instead. The two readings are the two gaps around the seated
// core, 28 ahead and 42 behind for the right answer and the reverse for the
// wrong one, exactly as in `nearest-core` and with the two swapped.
//
// THE TOLERANCE. `ARC_TOL` (0.5 units, the case's standing tolerance on an arc
// position) on each gap, for the reason `nearest-core` gives: the gaps are
// arithmetic on the positions of the tick the insertion resolved on, and the two
// possible answers are 14 units — 28 tolerances — apart. The arrangement's own
// margin is the centre distance, `hypot(7, 21) = 22` units against the 28-unit
// window, so a build sampling its flight a whole tick either side still has both
// cores inside it and still has them exactly equidistant.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLessThan,
  assertNear,
  assertNotEqual,
} from "../assert";
import { ARC_TOL, SPACING, STRIKE_DISTANCE } from "../constants";
import {
  captureReplay,
  coreCount,
  coreWithCharge,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";
import {
  approach,
  assertInFlight,
  CATCHUP_STEP,
  leg5S,
  LEVEL_SHOT_Y,
  poseFor,
  RIGHT_AIM,
  SHOT,
} from "./stage";

/** How far apart in arc the two tied cores stand when the strike resolves. */
const PAIR_GAP = 42;

/** How far above and below the shot's line each of them sits, in field units. */
const HALF_GAP = PAIR_GAP / 2;

/**
 * The core that makes both tied cores trailing segments.
 *
 * Far enough ahead that nothing merges over the drive — the gap closes at
 * `180 - 22 = 158` units/s, and 229 units of it take 87 ticks against a drive of
 * about 60 — and far enough off the shot's line, at `(680, 420)`, that it is
 * never a candidate for the strike.
 */
const LEAD_S = 3700;

/** The charges: the lead core's, the two tied cores', and none of them the shot's. */
const LEAD = "cobalt";
const AHEAD = "sulfur";
const REAR = "halide";

/** Ticks driven after the strike, so the replay shows the seated core riding on. */
const SETTLE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("strikes the core with the larger arc position when two are tied", async () => {
  assertLessThan(
    HALF_GAP,
    STRIKE_DISTANCE,
    "both tied cores are inside the window",
  );
  assertNotEqual(
    PAIR_GAP,
    SPACING,
    "a pair one spacing apart would seat in the same slot either way",
  );

  await poseHall(h, {
    cores: [[LEAD_S, LEAD, null]],
    loaded: SHOT,
  });

  const after = await captureReplay(h, "tie", async () => {
    const short = await approach(h, RIGHT_AIM);
    assertInFlight(short);
    // Leg 5 descends, so the core BELOW the shot's line carries the larger arc
    // position. Both ride the catch-up rate behind the lead core, so both are
    // posed one tick of that rate short of the symmetric arrangement.
    const belowS = leg5S(LEVEL_SHOT_Y + HALF_GAP);
    const aboveS = leg5S(LEVEL_SHOT_Y - HALF_GAP);
    assertNear(
      belowS - aboveS,
      PAIR_GAP,
      0,
      "the pair straddles the shot's line",
    );
    h.debug.poseTrain([
      [LEAD_S, LEAD, null],
      [poseFor(belowS, CATCHUP_STEP), AHEAD, null],
      [poseFor(aboveS, CATCHUP_STEP), REAR, null],
    ]);
    const struck = await h.step(1);
    await h.step(SETTLE);
    return struck;
  });

  assertEqual(coreCount(after), 4, "the shot seated into the train");

  const seated = coreWithCharge(after, SHOT);
  const rear = coreWithCharge(after, REAR);
  const ahead = coreWithCharge(after, AHEAD);
  assertEqual(
    seated?.charge,
    SHOT,
    "a core carrying the fired charge stands on the channel",
  );

  assertNear(
    (seated?.s ?? NaN) - (rear?.s ?? NaN),
    PAIR_GAP,
    ARC_TOL,
    "the seated core stands the pair's own gap ahead of the rear core, which is " +
      "where an insertion measured from the core with the LARGER arc position " +
      "leaves it (specs/injector.md, Striking a core)",
  );
  assertNear(
    (ahead?.s ?? NaN) - (seated?.s ?? NaN),
    SPACING,
    ARC_TOL,
    "and one spacing behind the core it struck",
  );
});
