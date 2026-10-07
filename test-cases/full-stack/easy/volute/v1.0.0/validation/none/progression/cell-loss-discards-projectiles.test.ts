// progression/cell-loss-discards-projectiles — a spent cell discards every
// projectile in flight.
//
// THE SPEC LINE. `specs/progression.md` — "Cells", the row after the one
// `progression/cell-loss-clears-channel` reads: "| Projectiles | every one
// discarded |". It is its own point because a build clears the channel and
// discards the shots in two different places, and one of the two is easy to
// forget.
//
// THE DRIVE. One core posed 20 units short of the intake, ridden until it is
// within a few units of arriving, and a shot raised at that moment so a
// projectile is certainly still in the air on the tick the cell is spent — which
// is the only way this row can be read at all.
//
// WHERE THE SHOT GOES, AND WHY IT MISSES. It is fired straight up the field at
// the opening aim of 270 degrees, from the injector's fixed center at (420, 330)
// (`specs/injector.md`). The posed core stands on the channel's second-to-last
// leg, which `specs/channel.md` runs from (620, 320) to (480, 320), so it is more
// than 60 units from the line the projectile flies up — well outside the 28-unit
// strike distance. The shot therefore leaves the field untouched after 330 units
// at `PROJECTILE_SPEED`, which is 32 ticks, while the head covers its last 5 units
// in 14 at level 1's feed speed — so the projectile is in the air for the spend
// with better than half its life to spare.
//
// TOLERANCES. None on the answer: the reading is a count of what is left in
// flight. The two sweep ceilings are ceilings rather than tolerances — 120 ticks
// covers the ride several times over at level 1's feed speed, and 40 covers the
// last few units while staying inside the 32 ticks the shot lives for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { INTAKE_S, OPENING_AIM } from "../constants";
import {
  captureReplay,
  createHarness,
  fireAt,
  head,
  poseHall,
  projectileCount,
  type Harness,
} from "../harness";

/** The arriving core's opening arc position: 20 units short of the intake. */
const POSED_S = INTAKE_S - 20;

/** How close the head is let get before the shot is raised. */
const FIRE_WITHIN = 5;

/** Ceilings on the two sweeps, in ticks. */
const RIDE_TICKS = 120;
const LOSS_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards every projectile in flight when a cell is spent", async () => {
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: [[POSED_S, "halide", null]],
  });
  const opened = await h.snapshot();

  const swept = await captureReplay(h, "discarded", async () => {
    const approach = await h.stepUntil(
      (snapshot) => head(snapshot).s >= INTAKE_S - FIRE_WITHIN,
      { maxTicks: RIDE_TICKS, poll: 1 },
    );
    assertTrue(
      approach.hit,
      `the head within ${FIRE_WITHIN} units of the intake inside ` +
        `${RIDE_TICKS} ticks of being posed ${INTAKE_S - POSED_S} units short`,
    );

    await fireAt(h, OPENING_AIM);
    const armed = await h.snapshot();
    assertGreaterThan(
      projectileCount(armed),
      0,
      "a projectile in flight when the cell is about to be spent",
    );

    return h.stepUntil((snapshot) => snapshot.cells !== opened.cells, {
      maxTicks: LOSS_TICKS,
      poll: 1,
    });
  });

  assertTrue(
    swept.hit,
    `a cell spent within ${LOSS_TICKS} ticks of the head reaching ` +
      `${INTAKE_S - FIRE_WITHIN}`,
  );
  assertEqual(
    projectileCount(swept.snapshot),
    0,
    "the projectiles left in flight after the spend",
  );
});
