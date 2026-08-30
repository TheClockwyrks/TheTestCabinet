// injector/aim-pointer — a pointer position sets the aim to the bearing from the
// injector's center to that position.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("Aiming"): "A pointer
// position delivered that update sets the aim to the angle from the injector's
// center to that position, and a pointer position exactly at the injector's
// center leaves the aim unchanged." specs/injector.md ("Figures") fixes that
// center at `(420, 330)`, and specs/overview.md ("The field") fixes the angle
// convention: degrees, `0` along `+x`, increasing toward `+y`. So the two
// positions this check drives have bearings the geometry alone decides —
// `(720, 330)` is 300 units due `+x` of the center, an aim of `0`; `(420, 130)`
// is 200 units straight up the field, an aim of `270`. Nothing here is read off
// any build.
//
// WHY IN THIS ORDER. The review item names both positions, `(420, 130)` first.
// They are driven the other way round because the hall opens with the aim
// ALREADY at 270 — specs/instrumentation.md's `reset` restores "the aim at `270`
// degrees", and specs/injector.md says the aim "opens at 270 degrees" — so a
// build that never reads the pointer at all would pass a first reading of 270
// while doing nothing. Taking the aim off its opening value first makes both
// readings say the pointer was read. Both expected bearings are unchanged.
//
// THE HALL. The pointer is live on `playing` alone (specs/controls.md, "What
// each screen reads"), so the level has to stay open. An exhausted quota over
// an empty channel clears the level on the next tick (specs/channel.md, "The
// order of a tick", step 6), which would take the screen off `playing` — so one
// core is parked at the inlet (`parkedCore()`), which specs/channel.md's
// polyline puts at `(40, 40)`, far from the injector and from anything this
// check reads. It rides the feed at level 1's 22 units/s
// (specs/progression.md), so two ticks move it by under a unit. Nothing else is
// on the channel and no shot is fired: the aim is the only thing this check
// touches.
//
// TOLERANCE. `ANGLE_TOL`, the case's standing +/- 1 degree. Neither reading is
// integrated over ticks — each is one bearing of a posed geometry, so the only
// slack a conformant build needs is how the pointer lands: the harness runs at
// one CSS pixel per logical unit, so half a pixel of rounding at 200 units of
// reach is under a sixth of a degree. A degree is generous room on that, and the
// two bearings the check reads are 90 degrees apart, so a build that reads the
// pointer wrongly cannot slip through it.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertEqual } from "../assert";
import { ANGLE_TOL, INJECTOR } from "../constants";
import {
  captureStill,
  createHarness,
  parkedCore,
  poseHall,
  type Harness,
} from "../harness";

/** 300 units due `+x` of the injector's center: an aim of 0 degrees. */
const EAST = { x: INJECTOR.x + 300, y: INJECTOR.y };

/** 200 units straight up the field from it: an aim of 270 degrees. */
const NORTH = { x: INJECTOR.x, y: INJECTOR.y - 200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the aim to the angle from the injector's center to the pointer", async () => {
  await poseHall(h, { cores: parkedCore() });

  // "An update resolves the pointer first": the move is delivered, then one tick
  // runs, then the aim is read off the state that tick left.
  h.movePointer(EAST.x, EAST.y);
  const east = await h.step(1);

  h.movePointer(NORTH.x, NORTH.y);
  const north = await h.step(1);

  captureStill(h, "aim");

  assertEqual(north.screen, "playing", "the screen the pointer was read on");
  assertAngleNear(
    east.injector.aim,
    0,
    ANGLE_TOL,
    "the aim with the pointer 300 units right of the injector",
  );
  assertAngleNear(
    north.injector.aim,
    270,
    ANGLE_TOL,
    "the aim with the pointer 200 units above the injector",
  );
});
