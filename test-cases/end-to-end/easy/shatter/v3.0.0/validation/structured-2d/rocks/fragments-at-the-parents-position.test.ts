// rocks/fragments-at-the-parents-position — a split leaves its fragments where the
// parent died.
//
// `specs/rocks.md`: "Both fragments appear at the destroyed rock's position." That
// is the whole rule, and it is what makes a split read as one rock coming apart
// rather than as two rocks arriving from somewhere else — a build that offsets its
// fragments to make them visible, or that places them at the point of impact on the
// rock's rim, or at the ship, puts them somewhere the specification does not.
//
// THE TOLERANCE IS ONE TICK OF THE PARENT'S OWN TRAVEL, and it is a tolerance about
// WHEN rather than about WHERE. The last position the snapshot can report for the
// parent is the one it held on the tick before it broke; on the tick it broke,
// `specs/simulation.md`'s order moves every body (step 4) before collision resolves
// (step 6), so the rock was one tick of its own travel further on at the moment it
// came apart. A fragment sitting exactly at the parent's position is therefore up to
// that far from the last centre the check could read, and no further. The figure is
// computed from the parent's OWN reported speed rather than from a constant, so it
// is the same rule whatever drift the scenario gave it.
//
// THE PARENT DRIFTS, which is what makes the bound meaningful. A rock posed at rest
// would give a tolerance of nothing at all and the check would rest on floating
// point; the `FRAGMENT_FAN` drift of `(-60, -60)` (85 units per second — a legal
// Large drift, `specs/rocks.md`) makes one tick of travel 0.71 units, so a build
// that offsets its fragments by even a couple of units fails.
//
// THE WELL IS ALLOWED FOR EXPLICITLY, and it is tiny: at the quiet ground 412 units
// out `specs/gravity.md` pulls at about 26 units per second squared, which over one
// tick moves a body by 26 / 120^2 — under two thousandths of a unit, a four
// hundredth of the budget above.
//
// WHAT THIS DOES NOT DECIDE. What velocity the fragments left with, which is
// `rocks/fragment-velocity-carries-the-parent` and the three `fragment-kick-*`
// items; and how many fragments there were, which is `rocks/split-large`'s — though
// `fragmentPair` still hard-asserts the two, so a build that split into one fails
// naming the split rather than crashing this script.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { FRAGMENT_FAN, QUIET_PULL } from "../fixtures";
import { speedOf, wrappedDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { destroyByGun, fragmentPair, roundAlong } from "./scenario";

/**
 * How much of the well's own work over one tick the bound allows for, in units.
 *
 * `specs/simulation.md` adds a tick's gravity to the velocity (step 3) before the
 * position moves by it (step 4), so the parent's step is its REPORTED velocity plus
 * `a x TICK_DT`, over `TICK_DT` — a shade further than the reported velocity alone
 * would carry it. At the quiet ground that shade is `QUIET_PULL` (about 26 units per
 * second squared) over a tick squared: 0.0018 units. Four times that is allowed
 * here, which leaves room for a build that rounds its tick differently and is still
 * a hundredth of the tick of travel it is added to — so a build that offsets its
 * fragments by even a fifth of a unit fails.
 */
const WELL_SLACK = 4 * QUIET_PULL * TICK_DT * TICK_DT;

/** Ticks of the fragments coming apart, run after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.35);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts both fragments within one tick of travel of the parent's last centre", async () => {
  startPlaying(h);
  const parentId = poseRock(
    h,
    "large",
    FRAGMENT_FAN.parent.x,
    FRAGMENT_FAN.parent.y,
    FRAGMENT_FAN.drift.vx,
    FRAGMENT_FAN.drift.vy,
  );

  const kill = await destroyByGun(h, parentId, (target) =>
    roundAlong(target, FRAGMENT_FAN.shotHeading, { carry: false }),
  );

  // The parent as it stood on the last tick it was still whole: the last centre
  // anything can report for it.
  const parent = requireRock(
    kill.before,
    parentId,
    "the Large on the tick before it broke",
  );
  const [first, second] = fragmentPair(
    kill.at,
    "medium",
    "fragments-at-the-parents-position",
  );

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "fragments");

  // One tick of the parent's own travel, and the well's work over that tick.
  const budget = speedOf(parent) * TICK_DT + WELL_SLACK;

  for (const [index, fragment] of [first, second].entries()) {
    assertLessThanOrEqual(
      wrappedDistance(fragment, parent),
      budget,
      `fragment ${index + 1}: units from the parent's last reported centre ` +
        `(${parent.x.toFixed(1)}, ${parent.y.toFixed(1)}) — both fragments ` +
        "appear at the destroyed rock's position, which is at most one tick " +
        "of its own travel past that centre (specs/rocks.md, " +
        "specs/simulation.md)",
    );
  }
});
