// Wick — lantern/follows-player: the circle the lanterns ride is centered on
// the lamplighter every tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"): "the circle they ride is centered on
//     the player's center every tick. `orbit` and `radius` are fixed when the
//     set is created"; row 2 has orbit `90`.
//   - `specs/state.md` (`ZoneState`): "A lantern and an aura are placed
//     relative to the lamplighter every tick, so their positions follow the
//     lamplighter", and "each tick places it at that angle ... at the orbit
//     radius around the lamplighter's position of that tick; a lamplighter
//     pose moves the lantern with it and changes its angle not at all."
//   - `specs/world.md` ("One tick"), phase 5, the placement: "each lantern's
//     center [is] placed about the lamplighter's position of this tick";
//     `specs/instrumentation.md` (`setPlayerPosition`): "the aura and
//     lanterns follow on the next tick".
//   - `specs/world.md` ("The lamplighter"): `MOVE_SPEED` (`180`) units per
//     second, so 90 units over 30 ticks is the distance a walking lamplighter
//     covers in the same span.
//
// WHAT IS READ. After each of 30 ticks, the lamplighter posed 3 units further
// along +x before every one of them: every lantern's distance from the
// lamplighter's center of that tick, the orbit, 90. The lanterns revolve
// throughout, so the reading is the circle's center and not a frozen offset.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 2, two lanterns, so
// "every lantern" is more than one; no passive held; nothing on the field;
// every switch off but `weaponFire` and `effectMotion`. The lamplighter is
// moved through `setPlayerPosition` rather than a held key, so the reading
// is the placement rule alone and never the movement rule, which the
// lamplighter points decide.
//
// TOLERANCE. `MOTION_TOLERANCE` on each distance: a stated figure times the
// hypotenuse of a cosine and a sine of an integrated angle, read back as a
// double.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { MOTION_TOLERANCE, MOVE_SPEED, TICK_DT, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  distance,
  enable,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { armLantern, lanternRow, lanternsOf } from "./orbit";

/** The level this point holds Lantern at: two lanterns. */
const LEVEL = 2;

/** Row 2 of LANTERN_LEVELS. */
const ROW = lanternRow(LEVEL);

/** How long the set is watched: half a second. */
const WATCH_SECONDS = 0.5;

/** The ticks watched after the firing tick: 30. */
const WATCH_TICKS = ticksFor(WATCH_SECONDS);

/** How far the lamplighter is posed along +x before each tick: 180 × 1/60 = 3. */
const STEP = MOVE_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps every lantern exactly the orbit from the lamplighter on each of 30 ticks", async () => {
  const orbit = armLantern(h, LEVEL);
  enable(h, "effectMotion");
  const fired = await h.tick(1);
  assertGreaterThan(
    lanternsOf(fired).length,
    0,
    "Lantern lanterns after the firing",
  );

  const seen = await captureReplay(h, "following", async () => {
    const snapshots: WickSnapshot[] = [];
    for (let tick = 1; tick <= WATCH_TICKS; tick += 1) {
      h.debug.setPlayerPosition(orbit.player.x + STEP * tick, orbit.player.y);
      snapshots.push(await h.tick(1));
    }
    return snapshots;
  });

  seen.forEach((snapshot, index) => {
    const tick = index + 1;
    const { player } = snapshot.run;
    assertWithin(
      player.x,
      orbit.player.x + STEP * tick,
      MOTION_TOLERANCE,
      `the lamplighter's x after tick ${tick}`,
    );
    const lanterns = lanternsOf(snapshot);
    assertEqual(
      lanterns.length,
      lanternsOf(fired).length,
      `Lantern lanterns after tick ${tick}`,
    );
    for (const lantern of lanterns) {
      assertWithin(
        distance(player, lantern),
        ROW.orbit,
        MOTION_TOLERANCE,
        `lantern ${lantern.id}'s distance from the lamplighter after tick ${tick}`,
      );
    }
  });
});
