// rocks/fragment-kick-opposite-sides — the two pieces are thrown to opposite sides.
//
// `specs/collision.md`, The fragment fan: the kick is applied with "the two
// fragments kicked to opposite sides". This item decides that word — opposite —
// and nothing else: how wide the fan opens is `fragment-kick-magnitude`'s item, and
// which line it opens across is `fragment-kick-is-perpendicular-to-the-shot`'s.
//
// WHAT EACH DEVIATION IS MEASURED FROM, AND WHY IT IS NOT THE PAIR'S OWN AVERAGE.
// The review item words the reading as each fragment's velocity against the average
// of the two, but that reading decides nothing: for ANY two vectors, `a` less their
// average is exactly the negative of `b` less their average, so a build that threw
// both fragments the same way, or gave them the same velocity, or drew both at
// random would clear a bound of five degrees every time. The reference the
// specification actually names is the DESTROYED ROCK'S VELOCITY — each fragment's
// velocity is that "plus a kick... the two fragments kicked to opposite sides" — so
// each deviation is taken from the parent's velocity on the last tick it was
// standing, and the two must point within five degrees of opposite. A build that
// kicks both pieces the same way reads `180` degrees out.
//
// EACH DEVIATION IS REQUIRED TO EXIST. A build that hands a fragment the parent's
// velocity unchanged has kicked it to no side at all, and a zero vector has no
// direction to compare, so both are hard-asserted to have a length before the
// bearing between them is read.
//
// THE POSE IS THE ONE THE SIBLING FAN ITEMS NAME — the parent at `(320, 620)`
// drifting `(-60, -60)`, shot horizontally. The drift is what gives this item its
// teeth: against a parent at rest the deviation from the parent and the raw
// velocity are the same vector, and a build that ignored the parent's motion
// entirely would still read as opposite.
//
// THE BOUND IS THE REVIEW ITEM'S FIGURE, five degrees. At the kick
// `specs/collision.md` fixes (`90`) that is seven and a half units per second of
// misalignment, which is room for a build's own arithmetic and for the quarter of a
// unit per second the well adds to each piece over the tick between the split and
// the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { DEG } from "../constants";
import { angleBetween, bearingOf, magnitude, subtract } from "../geometry";
import {
  captureStill,
  createHarness,
  requireRock,
  startPlaying,
  ticksFor,
  velocityOf,
  type Harness,
} from "../harness";
import {
  FAN_DRIFT,
  QUIET_GROUND,
  fragmentPair,
  killHorizontally,
  poseRockAt,
} from "./scene";

/** How far from opposite the two deviations may lie, in radians: the item's figure. */
const TOLERANCE = 5 * DEG;

/** Seconds of the pair separating, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws the two fragments off the parent's course in opposite directions", async () => {
  await startPlaying(h);
  const parentId = await poseRockAt(h, "large", QUIET_GROUND, FAN_DRIFT);

  const kill = await killHorizontally(h, parentId);

  await h.advance(AFTERMATH_TICKS);
  await captureStill(h, "fan");

  const parent = requireRock(
    kill.before,
    parentId,
    "the Large on the tick before the fatal round landed",
  );
  const [a, b] = fragmentPair(
    kill.at,
    "medium",
    "fragment-kick-opposite-sides",
  );
  const course = velocityOf(parent);
  const kicks = [
    subtract(velocityOf(a), course),
    subtract(velocityOf(b), course),
  ];

  for (const [index, kick] of kicks.entries()) {
    assertGreaterThan(
      magnitude(kick),
      0,
      `units per second fragment ${index + 1} was kicked off the parent's course (specs/collision.md)`,
    );
  }

  assertLessThanOrEqual(
    Math.abs(angleBetween(bearingOf(kicks[0]), bearingOf(kicks[1])) - Math.PI) /
      DEG,
    TOLERANCE / DEG,
    "degrees the two fragments' kicks fall short of opposite (specs/collision.md)",
  );
});
