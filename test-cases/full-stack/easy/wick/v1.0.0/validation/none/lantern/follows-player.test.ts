// Wick — lantern/follows-player: the orbit is centered on the lamplighter every
// tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "the circle
// they ride is centered on the player's center every tick", on "a circle of
// radius `orbit`", `90` at level 2 times an `areaMul` of `1`. `specs/world.md`
// ("One tick", phase 5): "each lantern's center [is] placed about the
// lamplighter's position of this tick", and `specs/instrumentation.md`
// (`setPlayerPosition`) has "the aura and lanterns follow on the next tick".
// So on every tick after the lamplighter's center is posed, each lantern of a
// live set is exactly `orbit` from the center it was posed to.
//
// THE POSE. An isolated night with `effectMotion` on, so the set revolves as it
// follows and a build that re-centers only a still set is told apart; Lantern
// held at level 2 and fired by one tick, so two lanterns follow, then
// `weaponFire` off. The lamplighter is then moved `90` units right over `30`
// ticks — `MOVE_STEP` (`3`) per tick, the distance a tick of walking covers —
// each step a `setPlayerPosition` pose followed by one tick, and each tick's
// snapshot is read for where the set stands. The replay covers the thirty
// ticks of the walk.
//
// TOLERANCE. `POSITION_TOL` on each lantern's distance from the lamplighter's
// center on each tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOVE_STEP, POSITION_TOL, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  mustZone,
  player,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { assertOnOrbit, lanternsOf } from "./stage";

/** The first level whose row carries amount `2`, so every lantern is two. */
const LEVEL = 2;

/** The ticks the walk covers: `30 × 3 = 90` units. */
const WALK_TICKS = 30;

const ROW = weaponRow("lantern", LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps every lantern exactly orbit from the lamplighter on each of 30 ticks of a walk right", async () => {
  await isolate(h, { on: ["effectMotion"] });
  const firing = await fireWeapon(h, "lantern", LEVEL);
  await disable(h, "weaponFire");
  const lanterns = lanternsOf(firing);
  assertEqual(
    lanterns.length,
    ROW.amount,
    "the lanterns the level-2 firing tick created",
  );
  const start = player(firing.after);

  const ticks = await captureReplay(h, "following", async () => {
    const seen: WickSnapshot[] = [];
    for (let i = 1; i <= WALK_TICKS; i += 1) {
      await h.debug.setPlayerPosition(start.x + i * MOVE_STEP, start.y);
      seen.push(await h.step(1));
    }
    return seen;
  });

  assertNear(
    player(ticks[WALK_TICKS - 1]!).x - start.x,
    WALK_TICKS * MOVE_STEP,
    POSITION_TOL,
    "how far right the lamplighter was moved over the walk",
  );
  ticks.forEach((snapshot, i) => {
    const set = lanterns.map((lantern) => mustZone(snapshot, lantern.id));
    assertOnOrbit(
      set,
      player(snapshot),
      ROW.orbit ?? NaN,
      `tick ${i + 1} of the walk`,
    );
  });
});
