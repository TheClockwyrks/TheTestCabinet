// channel/merge-clamp — a catching-up segment stops exactly one spacing behind
// the segment ahead rather than passing it.
//
// THE SPEC LINE. `specs/channel.md`, "Merging": "A segment merges with the
// segment ahead of it when its head reaches the arc position `SPACING` behind
// that segment's tail. On the tick its advance would carry its head past that
// position, the head is clamped to exactly that position and every core behind
// the head moves by the same amount, so the arc positions across the join differ
// by exactly `SPACING`". `SPACING` is 28 units.
//
// THE DRIVE. A lead core at 2000 and a trailing core a hundred units behind it.
// The trailing one is its own segment (the gap is not the spacing), so it closes
// at the catch-up rate of 180 units/s against a lead riding at level 1's feed
// speed of 22 — a closing rate of 158 units/s over the 72 units of gap it has to
// give up, which is 0.46 s, or 28 ticks. Ninety ticks is three times that, so
// the clamp has long since happened and has had a further second to be violated
// by a build that lets the trailing core keep closing. The two carry different
// charges, so the merge cannot extract ("the merging segment's head core and the
// segment ahead's tail core carry the same charge" is what an extraction on a
// merge needs), and the inlet is held so nothing arrives behind them.
//
// WHAT IS READ. The gap across the join, which the spec fixes at exactly one
// spacing, and the direction of the pair — the trailing core is still behind the
// lead one, which is what "rather than passing it" means. Where the pair as a
// whole has got to is `channel/feed-advance`'s point and not read here.
//
// THE TOLERANCE. +/- 0.5 units, the case's standing tolerance for an arc
// position. The clamp is a placement rather than an integration ("clamped to
// exactly that position"), so a conformant build sits on 28 exactly whatever
// tick it reaches it on; the half unit covers a build that keeps rounded
// positions. A build that lets the trailing core pass, or that stops it a core
// radius short, is out by whole units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { ARC_TOL, SPACING } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  head,
  poseHall,
  tail,
  type Harness,
} from "../harness";

/** The lead core. */
const LEAD_S = 2000;

/** The trailing core, a hundred units back: its own segment, and closing. */
const TRAIL_S = 1900;

/** Well past the 28 ticks the close takes, so the clamp is read at rest. */
const TICKS = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clamps the catching-up core exactly one spacing behind the one ahead", async () => {
  await poseHall(h, {
    cores: [
      [LEAD_S, "halide", null],
      [TRAIL_S, "sulfur", null],
    ],
  });

  const after = await captureReplay(h, "merge", () => h.step(TICKS));

  assertEqual(coreCount(after), 2, "the cores on the channel after the drive");
  assertGreaterThan(
    head(after).s,
    tail(after).s,
    "the head's arc position against the trailing core's",
  );
  assertNear(
    head(after).s - tail(after).s,
    SPACING,
    ARC_TOL,
    "the arc gap across the join once the segments have met",
  );
});
