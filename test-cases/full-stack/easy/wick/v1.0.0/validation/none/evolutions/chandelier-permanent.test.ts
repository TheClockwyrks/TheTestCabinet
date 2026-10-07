// Wick — evolutions/chandelier-permanent: Chandelier's lanterns never vanish
// and its slot's timer holds `0`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"):
// "Chandelier is Lantern's orbit made permanent: its lanterns never vanish, and
// it has no cooldown and no duration, so its slot's cooldown timer holds `0`."
// The set is created on the first `playing` tick it is held, "each a zone of
// kind `lantern` with `ttl` `null`", and nothing in that section removes a
// lantern while the weapon is held and the amount is unchanged. `CHANDELIER_STATS`
// gives amount `4`, and `amountBonus` is `0` with no Mirror held. So over
// `WATCHED_TICKS` (`600`, ten seconds at `TICK_HZ`) the same four ids stand in
// the snapshot on every tick and the slot reads cooldown `0` on every tick.
//
// THE POSE. An isolated night with `weaponFire` and `effectMotion` turned back
// on: `weaponFire` because while it is off "Every cooldown timer holds where it
// stands" (`specs/instrumentation.md`), so a timer read under a held switch
// would say nothing about a timer the weapon keeps at `0`; and `effectMotion`
// because that is the switch the lanterns revolve under, and a set that
// survives ten seconds of revolving is what the requirement is about. Nothing
// else runs: no spawn, no event, no enemy, so nothing arrives to be hit and no
// death removes anything. The replay covers the ten seconds.
//
// TOLERANCE. `TIMER_TOL` on the timer, which a build holds rather than
// integrates; the set of ids is exact on every tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { TICK_HZ, TIMER_TOL, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { chandelierLanterns, placeChandelierSet } from "./stage";

/** Chandelier's fixed amount, `4`. */
const AMOUNT = weaponRow("chandelier").amount as number;

/** How long the set is watched: ten seconds, as the review item states. */
const WATCHED_TICKS = 10 * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the same four lantern ids and a cooldown of 0 across 600 ticks", async () => {
  await isolate(h, { on: ["weaponFire", "effectMotion"] });

  const watched = await captureReplay(h, "permanent", async () => {
    const set = await placeChandelierSet(h);
    const wanted = set.lanterns
      .map((lantern) => lantern.id)
      .sort((a, b) => a - b);
    const wrong: { tick: number; ids: number[]; cooldown: number }[] = [];
    await h.stepWatching(WATCHED_TICKS, (snapshot, tick) => {
      const ids = chandelierLanterns(snapshot)
        .map((lantern) => lantern.id)
        .sort((a, b) => a - b);
      const cooldown =
        (snapshot.run.weapons ?? [])[set.slot]?.cooldown ?? Number.NaN;
      const sameIds =
        ids.length === wanted.length &&
        ids.every((id, index) => id === wanted[index]);
      if (!sameIds || !(Math.abs(cooldown) <= TIMER_TOL)) {
        if (wrong.length < 5) wrong.push({ tick, ids, cooldown });
      }
      return false;
    });
    return { set, wanted, wrong };
  });

  assertEqual(
    watched.wanted.length,
    AMOUNT,
    "Chandelier lantern zones the placing tick created",
  );
  assertDeepEqual(
    watched.wrong,
    [],
    `ticks of the ${WATCHED_TICKS} on which the set's ids changed or the timer left 0`,
  );
  const ending = await h.snapshot();
  assertDeepEqual(
    chandelierLanterns(ending)
      .map((lantern) => lantern.id)
      .sort((a, b) => a - b),
    watched.wanted,
    `the set's ids after ${WATCHED_TICKS} ticks`,
  );
  assertNear(
    (ending.run.weapons ?? [])[watched.set.slot]?.cooldown ?? NaN,
    0,
    TIMER_TOL,
    `Chandelier's timer after ${WATCHED_TICKS} ticks`,
  );
});
