// Wick — sconce/returns-past-launch-point: a sconce returns past the point it
// was launched from, and that point stays where the lamplighter was.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): a sconce
// "reverses once `speed / SCONCE_DECEL` seconds of motion have passed and
// returns past the launch point, which stays where the player's center was on
// the tick of firing", and "it is removed after `duration` seconds". Row 1 of
// `SCONCE_LEVELS` launches at speed `600` for a duration of `2.5` seconds, and
// `specs/world.md` ("Timers") makes `2.5` seconds `round(2.5 × 60)` = `150`
// ticks, so the ttl falls due on moving tick `150` and every tick before it is
// a tick the sconce is alive on. So on one of the `149` moving ticks before
// that, the sconce stands on the far side of its launch point along `d`,
// having stood on the near side earlier; the tick it crosses on is left to the
// build, because the rate it slows at is what `sconce/decelerates` decides.
//
// WHAT IS READ. The sconce's offset from the launch point, resolved along `d`
// and across it. The along component is positive while the sconce is on its
// way out and negative once it is past the launch point, and the across
// component stays `0` for a shape whose whole acceleration lies along `d`:
// together they say the sconce came back THROUGH the launch point rather than
// around it or toward something else.
//
// WHY THE WORLD IS POSED AS IT IS. The launch point is the requirement, so the
// lamplighter is moved `1000` units away on both axes straight after the
// launch tick, through `setPlayerPosition`: a build that carried the launch
// point along with the lamplighter, or turned the sconce back toward wherever
// the lamplighter now stands, sends it off the line this check reads and fails
// the across component, while a build that holds the point where the launch
// left it passes whatever the lamplighter does afterwards. The night holds one
// moth and nothing else, at `(300, 400)`, because "Sconce needs at least one
// enemy to fire" and one alive enemy makes `d` unambiguous; it stands `500`
// units out, beyond the `305` units a sconce launched at `600` covers before
// it turns, so it is never hit and never dies. `weaponFire` is turned back off
// after the launch so the one sconce in the world is the one whose flight is
// read, and `effectMotion` on alone makes every stepped tick a moving tick.
//
// TOLERANCE. The two along readings are signs, and the specification puts the
// sconce hundreds of units either side of the launch point, so no tolerance
// belongs on them. `POSITION_TOL` on the across component, a position
// integrated across up to `149` ticks whose drift is of order `1e-11`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertTrue } from "../assert";
import { POSITION_TOL, TICK_HZ, dueTicks, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  directionToward,
  disable,
  enable,
  fireWeapon,
  isolate,
  mustProjectile,
  placeEnemy,
  projectileById,
  type Harness,
  type XY,
} from "../harness";
import { SCONCE, across, along, sconcesOf } from "./stage";

/** The level whose row is held: speed `600`, duration `2.5`. */
const LEVEL = 1;

/** The one moth: `500` from the origin, so `d` is `(0.6, 0.8)`. */
const MOTH = { x: 300, y: 400 };

/** Where the lamplighter is walked to after the launch, well off the flight line. */
const WALKED: XY = { x: -1000, y: -1000 };

/** The last moving tick the sconce is alive on: one before its ttl is due. */
const TICKS = dueTicks(weaponRow(SCONCE, LEVEL).duration!) - 1;

/** The tick the turn falls on: `speed / SCONCE_DECEL` = `1` second of motion. */
const TURN = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("brings a level-1 sconce back through its launch point and past it before its ttl is due, with the lamplighter walked away", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const firing = await fireWeapon(h, SCONCE, LEVEL);
  const sconces = sconcesOf(firing);
  assertGreaterThan(
    sconces.length,
    0,
    "Sconce projectiles the launch tick created",
  );
  const launched = sconces[0]!;
  const launch = {
    x: firing.before.run.player.x,
    y: firing.before.run.player.y,
  };
  const d = directionToward(firing.before, MOTH);

  await disable(h, "weaponFire");
  await h.debug.setPlayerPosition(WALKED.x, WALKED.y);
  await enable(h, "effectMotion");

  const ticks = await captureReplay(h, "return", () => h.stepWatching(TICKS));
  const offsets = ticks.map((snapshot) => {
    const sconce = projectileById(snapshot, launched.id);
    if (sconce === undefined) return undefined;
    return { x: sconce.x - launch.x, y: sconce.y - launch.y };
  });

  const turned = mustProjectile(ticks[TURN - 1]!, launched.id);
  assertGreaterThan(
    along({ x: turned.x - launch.x, y: turned.y - launch.y }, d),
    0,
    `the units the sconce stood past its launch point along d on moving tick ${TURN}`,
  );

  const past = offsets.findIndex(
    (offset) => offset !== undefined && along(offset, d) < 0,
  );
  assertTrue(
    past >= 0,
    `a moving tick among the ${TICKS} before the sconce's ttl is due on which it stands past its launch point along d`,
  );

  const crossed = offsets[past]!;
  assertNear(
    across(crossed, d),
    0,
    POSITION_TOL,
    `the units the sconce stood across d on moving tick ${past + 1}, the tick it came back past its launch point`,
  );
  mustProjectile(ticks[past]!, launched.id);
});
