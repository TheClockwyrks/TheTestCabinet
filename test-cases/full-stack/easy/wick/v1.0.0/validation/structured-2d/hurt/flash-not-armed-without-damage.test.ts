// hurt/flash-not-armed-without-damage — a tick on which no contact hit lands
// leaves `hurtFlash` where it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/world.md`, Contact damage:
// `hurtFlash` "is set to `HURT_FLASH` on every tick on which a contact hit
// lands", and "a contact hit is the only thing that sets it, so a heal from
// any source leaves it as it was". A tick that lands no hit therefore leaves
// the timer counting, and a timer already at `0` is "held at `0`"
// (`specs/world.md`, Timers).
//
// WHAT IS READ, AND WHY. `run.hurtFlash` after ten ticks with a rat on the
// field and no overlap. A rat is posed rather than an empty field so the tick
// has an enemy to consider: what separates a build that arms the flash on a
// HIT from one that arms it on any enemy, on any tick, or on the mere passing
// of time is exactly this arrangement. `hp` is read alongside, as the reading
// that establishes no hit landed: "hp falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`" on a hit, so unchanged `hp`
// over the ten ticks is no hit over the ten ticks.
//
// WHY THE RAT STANDS 200 UNITS OFF. "The enemy's circle overlaps the
// lamplighter's when the distance between their centers is less than the
// enemy's radius plus `PLAYER_RADIUS`" — `12 + 12`, `24`, for a rat
// (`specs/enemies.md`, Common enemies). A center distance of `200` is eight
// times that bound, so no overlap rule a build could write reaches it, and the
// rat is still well inside the stage.
//
// THE DRIVE. An isolated `playing` run holding that one rat, with
// `enemyContact` ON — the switch is the faculty under test rather than
// something held still, since a flash that never arms because contact was
// switched off would decide nothing — and `enemyMotion` off, so the rat stays
// where it was posed instead of closing the distance.
//
// THE TOLERANCE. None: `hurtFlash` is `0` on a run that has taken no hit
// (`specs/state.md`, The idle run), and a timer held at `0` is exactly `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  type Harness,
} from "../harness";
import { CLEAR_OFFSET, poseRat } from "./flash";

/** How many ticks run with no enemy overlapping, as the checklist states them. */
const QUIET_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves hurtFlash 0 over ten ticks with no enemy overlapping the lamplighter", async () => {
  poseRat(h, CLEAR_OFFSET);
  enable(h, "enemyContact");
  const before = h.snapshot();
  assertEqual(
    before.run.hurtFlash,
    0,
    "hurtFlash on a run that has taken no hit (specs/state.md, The idle run)",
  );

  const quiet = await advanceTicks(h, QUIET_TICKS);
  captureStill(h, "unarmed");

  assertEqual(
    quiet.run.player.hp,
    before.run.player.hp,
    `hp over the ${QUIET_TICKS} ticks, so no contact hit landed (specs/world.md, Contact damage)`,
  );
  assertEqual(
    quiet.run.hurtFlash,
    0,
    `hurtFlash after ${QUIET_TICKS} ticks landing no contact hit (specs/world.md, Contact damage)`,
  );
});
