// insertion/insert-ahead — a shot arriving from the front seats ahead.
//
// THE SPEC LINES. `specs/injector.md`, "Striking a core": "Let `c` be the struck
// core, `d` the projectile's center on the tick of the strike, and `f` the
// channel's forward direction at `c`'s arc position. The core enters **ahead** of
// `c` when `dot(d - c.position, f)` is greater than `0`". And "Insertion": "The
// insertion position `p` is `c`'s arc position when the core enters ahead of `c`
// ... Every core whose arc position before the strike is at most `p` shifts back
// by the channel spacing."
//
// Read together for a hall holding one core: the seated core takes the struck
// core's arc position, and the struck core — whose position equals `p`, so "at
// most `p`" catches it — shifts back one spacing. The seated core therefore ends
// AHEAD of the core it struck, which is what the review item states.
//
// WHY THE STRAIGHT TOP RUN. Leg 0 runs from the inlet `(40, 40)` to `(920, 40)`
// (specs/channel.md's vertex table), so `forward` there is `+x` and `dot(d - c,
// f)` is simply the difference in `x`. That makes "arriving on the forward side"
// and "arriving from larger `x`" the same statement, with no projection to get
// wrong, and lets the check arrange the sign of the dot product directly. The
// injector at `(420, 330)` sits below the run, so a shot fired at the opening aim
// of 270 degrees crosses it.
//
// THE TOLERANCE — there is none, and that is the point. What this check decides
// is a SIGN, not a distance: which of the two cores on the channel afterwards
// carries the charge the shot was fired with. So the reading is an identity, and
// the only figure that needs a margin is the arrangement that produces it. The
// shot passes 14 units to the `+x` side of the core's centre: half the 28-unit
// strike distance, so the contact is unambiguous (`hypot(14, 10.33) = 17.4` even
// a whole tick off the ideal sample), and 14 units of dot product, which one
// tick of the train's advance — `22 / 60 = 0.37` units at the level-1 feed
// (specs/progression.md, specs/channel.md) — cannot come near flipping.
//
// `insert-behind` is the same check with the sign reversed, and the two are posed
// identically so that the side is the one thing that differs between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { STRIKE_DISTANCE } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  head,
  poseHall,
  tail,
  topRunS,
  type Harness,
} from "../harness";
import {
  approach,
  assertInFlight,
  LEAD_STEP,
  PARKED,
  PLUMB_SHOT_X,
  poseFor,
  SHOT,
  UP_AIM,
} from "./stage";

/**
 * How far along `-x` of the shot's path the struck core's centre stands, so the
 * projectile arrives on the core's forward side. Half the strike distance: see
 * the note above.
 */
const LEAD = 14;

/** The charge the posed core carries: not the shot's, so nothing can extract. */
const TARGET = "halide";

/** Ticks driven after the strike, so the replay shows the pair riding on. */
const SETTLE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("seats the fired core ahead of the core it struck from the front", async () => {
  assertGreaterThan(
    STRIKE_DISTANCE,
    LEAD,
    "the arrangement is inside the strike distance",
  );

  await poseHall(h, { cores: PARKED, loaded: SHOT });

  const after = await captureReplay(h, "ahead", async () => {
    const short = await approach(h, UP_AIM);
    assertInFlight(short);
    // The struck core stands LEAD units behind the shot's path in `x`, so at the
    // strike `dot(d - c.position, forward)` is `+LEAD`: the shot arrives ahead.
    h.debug.poseTrain([
      [poseFor(topRunS(PLUMB_SHOT_X - LEAD), LEAD_STEP), TARGET, null],
    ]);
    const struck = await h.step(1);
    await h.step(SETTLE);
    return struck;
  });

  assertEqual(coreCount(after), 2, "the shot seated into the train");
  assertEqual(
    head(after).charge,
    SHOT,
    "the fired core holds the greater arc position: it entered ahead of the " +
      "core it struck (specs/injector.md, Insertion)",
  );
  assertEqual(
    tail(after).charge,
    TARGET,
    "the struck core holds the lesser arc position",
  );
  assertGreaterThan(
    head(after).s,
    tail(after).s,
    "the seated core stands ahead on the channel",
  );
});
