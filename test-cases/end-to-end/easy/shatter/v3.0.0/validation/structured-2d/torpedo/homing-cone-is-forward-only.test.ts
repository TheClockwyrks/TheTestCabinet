// torpedo/homing-cone-is-forward-only — a body behind a torpedo is never acquired.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The guidance: "A body is a
// candidate when it is a rock or the saucer and its bearing from the torpedo lies
// within `TORPEDO_CONE` (`15` degrees) of the torpedo's current heading, ON EITHER
// SIDE, so the cone spans `30` degrees and LOOKS FORWARD ALONE" — and, at the end
// of the same section, "a body behind it is never acquired."
//
// THE ROCK IS DIRECTLY BEHIND, at `180` degrees off the heading, which is as far
// outside a `15`-degree cone as a bearing can be. That is deliberate: a build that
// implements no cone at all — one that simply takes the nearest rock — turns
// straight round here, and a build whose cone is far too wide does too. A build
// whose cone is merely a few degrees generous is decided by
// `torpedo/cone-half-angle`, which reads the edge; this item reads the direction.
//
// BOTH HALVES OF THE OUTCOME. The heading is unchanged over the whole second —
// sampled throughout, not only at the end, because at `TORPEDO_TURN` a torpedo
// can swing `160` degrees in that second and a check that read only the ends could
// be shown a heading on its way back — and the rock is still on the field, because
// a torpedo that DID turn round would reach it and destroy it.
//
// THE HEADING IS COMPARED AS A SHORTEST ARC, never as a subtraction: a heading
// names a direction and the case fixes no range for it, so a build that keeps its
// headings in `[0, 2pi)` and one that keeps them in `(-pi, +pi]` read the same.
//
// NOTHING ELSE CAN MOVE EITHER BODY OFF ITS MARK. The lane is `y = 620`, at least
// `260` units from the star's centre, so neither the torpedo nor the rock comes
// near the core over the second; `specs/gravity.md` never pulls a torpedo at all,
// and the rock's own fall toward the star over one second is about `26` units,
// which leaves it behind the torpedo by every reading. `startPlaying` leaves
// nothing else on the field, so the rock the check counts is the rock it posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { DEG, angleBetween } from "../geometry";
import {
  captureReplay,
  createHarness,
  rockById,
  sampleEvery,
  startPlaying,
  poseRock,
  ticksFor,
  type Harness,
} from "../harness";
import { poseTorpedo, standTheShipClear } from "./scenario";

/** The lane both bodies stand on: the bottom of the field, clear of the core. */
const LANE_Y = 620;
/** Where the torpedo starts, and which way it is going. */
const TORPEDO_X = 700;
const HEADING = 0;
/** Where the rock stands: 200 units BEHIND the torpedo, on its own line. */
const ROCK_X = 500;
const ROCK = "large" as const;

/** How long the torpedo is watched, and how often its heading is read. */
const WATCH_TICKS = ticksFor(1);
const SAMPLE_EVERY = 8;
/** A little more flight after the reading, so the recording ends on the outcome. */
const TAIL_TICKS = 48;

/**
 * How far the heading may move over the second, in radians.
 *
 * One degree. The specification leaves this torpedo with no candidate at all, so
 * a conforming build turns it by exactly nothing and this is room for arithmetic
 * rather than for behaviour. The wrong model it separates is a turn toward a body
 * `180` degrees away, which at `TORPEDO_TURN` is `160` degrees inside the second
 * this check watches.
 */
const HEADING_TOLERANCE = 1 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a torpedo's heading and spares a rock standing directly behind it", async () => {
  startPlaying(h);
  standTheShipClear(h);
  const rockId = poseRock(h, ROCK, ROCK_X, LANE_Y);
  const torpedoId = poseTorpedo(h, TORPEDO_X, LANE_Y, HEADING);

  const headings = await captureReplay(h, "forward", async () => {
    const samples = await sampleEvery(
      h,
      WATCH_TICKS,
      SAMPLE_EVERY,
      (s) => s.torpedoes?.find((torpedo) => torpedo.id === torpedoId)?.heading,
    );
    // And the rest of the run on past the rock, for the reviewer.
    await h.advance(TAIL_TICKS);
    return samples;
  });

  for (const [index, heading] of headings.entries()) {
    assertTrue(
      heading !== undefined,
      `the torpedo in flight for the whole second it is watched; it was gone ` +
        `by tick ${index * SAMPLE_EVERY} on a field holding one rock 200 ` +
        "units behind it, which it should never have turned toward " +
        "(specs/weapons.md)",
    );
    if (heading === undefined) continue;
    const off = angleBetween(heading, HEADING);
    assertTrue(
      off <= HEADING_TOLERANCE,
      `the torpedo's heading unchanged with the only rock on the field 180 ` +
        `degrees behind it, within ${(HEADING_TOLERANCE / DEG).toFixed(0)} ` +
        "degree — the acquisition cone reaches TORPEDO_CONE (15 degrees) " +
        "either side of the heading and looks forward alone, so a body behind " +
        `it is never acquired (specs/weapons.md); at tick ` +
        `${index * SAMPLE_EVERY} it had turned ${(off / DEG).toFixed(2)} degrees`,
    );
  }

  assertTrue(
    rockById(h.snapshot(), rockId) !== undefined,
    "the rock standing behind the torpedo still on the field — a torpedo that " +
      "never acquires it never comes back to destroy it (specs/weapons.md, " +
      "specs/collision.md)",
  );
});
