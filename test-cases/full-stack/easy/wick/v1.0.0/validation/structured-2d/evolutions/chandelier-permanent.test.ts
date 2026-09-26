// evolutions/chandelier-permanent — Chandelier's lanterns never vanish.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"):
// "Chandelier is Lantern's orbit made permanent: its lanterns never vanish,
// and it has no cooldown and no duration, so its slot's cooldown timer holds
// `0`", and each lantern is "a zone of kind `lantern` with `ttl` `null`".
// `specs/state.md` (`ZoneState`): "`ttl`: the seconds the zone has left ...
// and `null` for a zone that never expires: an aura, and a Chandelier
// lantern." So over any span the four zones the placing tick created are still
// the four zones in the world, with the ids they were created with, and the
// slot's timer reads `0` on every one of those ticks.
//
// WHY 600 TICKS. Ten seconds of game time (`specs/world.md`, The plane:
// `TICK_HZ` (`60`) ticks a second), longer than the 4.0-second duration of
// Lantern's own longest set (`specs/weapons.md`), so a build that gave the
// evolved set a duration — even the longest one the base weapon has — loses
// its lanterns inside the span.
//
// WHY BOTH FACULTIES ARE ON. `weaponFire` is on, so a build that gave
// Chandelier a cooldown counts it down and refires, replacing the set with
// zones carrying fresh ids; `effectMotion` is on, so the lanterns revolve as
// they do in play, and what is read is that revolving does not renew them.
// Nothing else is on, so no enemy, no spawn and no other weapon touches the
// scene.
//
// WHAT IS READ. Every tick of the span, one at a time: the ids of the
// Chandelier lanterns standing, and the slot's cooldown timer. The tick that
// first differs is named in the failure, so a set that vanished at its
// duration and a set that was refired both report where.
//
// THE TOLERANCE. `REAL_EPS` on the timer, which the rule holds at `0`; the id
// lists are compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { CHANDELIER_STATS, REAL_EPS, TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  type Harness,
} from "../harness";
import { chandelierLanterns, placeChandelier } from "./evolved";

/** The span the set is watched over: ten seconds of game time. */
const TICKS = 10 * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the same four lantern ids and a cooldown of 0 across 600 ticks", async () => {
  const placed = await placeChandelier(h);
  assertEqual(
    placed.lanterns.length,
    CHANDELIER_STATS.amount,
    "the Chandelier lanterns standing after the placing tick (specs/evolutions.md, Chandelier)",
  );
  const ids = placed.lanterns
    .map((lantern) => lantern.id)
    .sort((a, b) => a - b);

  enable(h, "weaponFire", "effectMotion");

  const watched = await captureReplay(h, "permanent", async () => {
    let changedAt = -1;
    let changedTo: number[] = [];
    let worstTimer = 0;
    let worstTimerAt = -1;
    for (let tick = 1; tick <= TICKS; tick += 1) {
      const s = await advanceTicks(h, 1);
      const standing = chandelierLanterns(s)
        .map((lantern) => lantern.id)
        .sort((a, b) => a - b);
      if (
        changedAt < 0 &&
        (standing.length !== ids.length ||
          standing.some((id, i) => id !== ids[i]))
      ) {
        changedAt = tick;
        changedTo = standing;
      }
      const timer = s.run.weapons[placed.slot]?.cooldown ?? Number.NaN;
      if (!(Math.abs(timer) <= Math.abs(worstTimer))) {
        worstTimer = timer;
        worstTimerAt = tick;
      }
    }
    return { changedAt, changedTo, worstTimer, worstTimerAt };
  });

  assertDeepEqual(
    watched.changedAt < 0 ? ids : watched.changedTo,
    ids,
    watched.changedAt < 0
      ? `the Chandelier lantern ids across ${TICKS} ticks (specs/evolutions.md, Chandelier)`
      : `the Chandelier lantern ids on tick ${watched.changedAt} of ${TICKS}, the first tick they differed from the set the placing tick created (specs/evolutions.md, Chandelier)`,
  );
  assertNear(
    watched.worstTimer,
    0,
    REAL_EPS,
    watched.worstTimerAt < 0
      ? `Chandelier's cooldown timer across ${TICKS} ticks (specs/evolutions.md, Chandelier)`
      : `Chandelier's cooldown timer on tick ${watched.worstTimerAt}, the furthest it stood from 0 (specs/evolutions.md, Chandelier)`,
  );
});
