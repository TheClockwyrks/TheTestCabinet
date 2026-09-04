// Wick — evolutions/chandelier-permanent: Chandelier's lanterns never vanish
// and its slot's timer holds 0.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Chandelier"): "Chandelier is Lantern's orbit made
//     permanent: its lanterns never vanish, and it has no cooldown and no
//     duration, so its slot's cooldown timer holds `0`."
//   - `specs/evolutions.md` ("Chandelier"): the lanterns are created with "a
//     fresh id" only "On the first `playing` tick Chandelier is held and no
//     Chandelier lantern exists", so a set that lives keeps the ids it was
//     created with; `specs/state.md` (`ZoneState`): `id` is "unique for the
//     run, assigned from `nextId`".
//   - `specs/state.md` (`ZoneState`): `ttl` is "`null` for a zone that never
//     expires", so nothing counts the set down.
//   - `specs/world.md` ("Timers"): "a timer at `0` stays due on every tick until
//     it is set again", so a build that treats Chandelier as a firing weapon
//     would re-create the set or set a cooldown on every tick.
//
// WHAT IS READ. Ten seconds of game time, 600 ticks: after every one of them
// the Chandelier lanterns are the same four, by id, and Chandelier's slot reads
// cooldown `0`. A build whose lanterns expire loses them; a build that
// re-creates the set shows new ids; a build that gives Chandelier a cooldown
// shows a timer above 0.
//
// WHY THE NIGHT IS POSED AS IT IS. Chandelier alone, nothing else on the field,
// and `weaponFire` and `effectMotion` both on, which is how the game is played:
// `weaponFire` is the faculty that would count a timer down and fire, and it is
// exactly what must leave a permanent weapon alone, so holding it off would
// make the timer reading vacuous; `effectMotion` lets the set revolve as it
// does in play. `spawning`, `events`, `despawning`, `enemyMotion`, and
// `enemyContact` stay off, so nothing arrives, nothing touches the lamplighter,
// and no kill can end the run over the ten seconds.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the timer, a stated figure read back as a
// double. None on the ids or the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import { CHANDELIER_STATS, FIGURE_TOLERANCE, TICK_HZ } from "../constants";
import { captureReplay, createHarness, enable, type Harness } from "../harness";
import { poseEvolved } from "./evolved";
import { chandelierLanterns } from "./chandelier";

/** How long the set is watched: ten seconds of game time, 600 ticks. */
const WATCH_TICKS = 10 * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the same four lanterns and a timer of 0 across 600 ticks", async () => {
  const { slot } = poseEvolved(h, "chandelier");
  enable(h, "weaponFire", "effectMotion");

  const created = chandelierLanterns(await h.tick(1)).map((zone) => zone.id);
  assertEqual(
    created.length,
    CHANDELIER_STATS.amount,
    "Chandelier lanterns after the placing tick",
  );

  const seen = await captureReplay(h, "permanent", () => h.trace(WATCH_TICKS));

  seen.forEach((snapshot, index) => {
    const tick = index + 2;
    assertDeepEqual(
      chandelierLanterns(snapshot).map((zone) => zone.id),
      created,
      `the Chandelier lanterns after tick ${tick}, by id`,
    );
    assertWithin(
      snapshot.run.weapons[slot]?.cooldown ?? Number.NaN,
      0,
      FIGURE_TOLERANCE,
      `Chandelier's timer after tick ${tick}`,
    );
  });
});
