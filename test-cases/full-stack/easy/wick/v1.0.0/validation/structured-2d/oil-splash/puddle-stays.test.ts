// oil-splash/puddle-stays — a puddle stays where it landed.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "A
// puddle is a circle of `radius` that stays where it landed for `duration`
// seconds and then vanishes." `specs/state.md` ("ZoneState"): "`x`, `y`: the
// center of the circle ... A lantern and an aura are placed relative to the
// lamplighter every tick, so their positions follow the lamplighter" — the
// puddle is not among them, so its center holds its landing point tick over
// tick however the lamplighter moves. `specs/instrumentation.md`
// (`setPlayerPosition`): "Sets the lamplighter's center to `(x, y)`. Nothing
// else moves: the camera follows on the next render, and the aura and
// lanterns follow on the next tick." And `spawnPuddle` adds "one zone of kind
// `puddle` ... centered at `(x, y)`", which is the landing point read here.
//
// WHY THE LAMPLIGHTER IS WALKED BY POSE. The requirement is about the puddle,
// so the lamplighter is moved through `setPlayerPosition` before each tick, a
// walking pace of `MOVE_SPEED × TICK_DT` a tick, rather than through a held
// key: a build with a broken control and a puddle that stays must fail the
// control checks and pass this one. Each tick is run one at a time and the
// puddle's center read after each, so a drift on any tick is seen.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy, no weapon,
// and no passive, one posed puddle, and `effectMotion` the one switch on: the
// switch under which "projectiles integrate, lanterns revolve" and every
// other effect that moves moves, so a build that moved its puddles with the
// rest is caught rather than held still. The walk covers 120 ticks, inside
// the level-1 duration of 2.5 seconds (150 ticks), so the puddle is live for
// every reading; that it vanishes on time is `puddle-duration`'s point.
//
// THE TOLERANCE. `REAL_EPS` on each coordinate: a stored value read back,
// which a conformant build never touches. A puddle carried by the lamplighter
// is off by 3 units after the first tick and 360 after the last.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { MOVE_SPEED, REAL_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  isolate,
  placePuddle,
  zoneById,
  type Harness,
} from "../harness";

/** Where the puddle is posed to land: off the origin, off the lamplighter. */
const LANDING = { x: 40, y: -25 };

/** How many ticks the lamplighter walks: inside the puddle's 150-tick life. */
const TICKS = 120;

/** The lamplighter's walking pace, `MOVE_SPEED × TICK_DT` = 3 units a tick. */
const PACE = MOVE_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds a puddle's x and y at its landing point tick over tick while the lamplighter walks away", async () => {
  isolate(h);
  enable(h, "effectMotion");
  const puddle = placePuddle(h, "oil-splash", LANDING.x, LANDING.y);
  const posed = zoneById(h.snapshot(), puddle);
  assertDefined(
    posed,
    "the puddle in zones after the pose (specs/instrumentation.md, spawnPuddle)",
  );
  assertNear(posed?.x ?? NaN, LANDING.x, REAL_EPS, "the posed puddle's x");
  assertNear(posed?.y ?? NaN, LANDING.y, REAL_EPS, "the posed puddle's y");

  await captureReplay(h, "stayed", async () => {
    for (let tick = 1; tick <= TICKS; tick += 1) {
      h.debug.setPlayerPosition(PACE * tick, 0);
      const s = await advanceTicks(h, 1);
      const seen = zoneById(s, puddle);
      assertDefined(
        seen,
        `the puddle in zones after tick ${tick} of the walk (specs/weapons.md, Oil Splash)`,
      );
      assertNear(
        seen?.x ?? NaN,
        LANDING.x,
        REAL_EPS,
        `the puddle's x after tick ${tick} of the walk, against where it landed (specs/weapons.md, Oil Splash)`,
      );
      assertNear(
        seen?.y ?? NaN,
        LANDING.y,
        REAL_EPS,
        `the puddle's y after tick ${tick} of the walk, against where it landed (specs/weapons.md, Oil Splash)`,
      );
    }
  });
});
