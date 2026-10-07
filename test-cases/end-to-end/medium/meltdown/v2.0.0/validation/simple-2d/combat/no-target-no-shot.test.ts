// Meltdown — combat/no-target-no-shot: an idle gun fires nothing.
//
// specs/combat.md reports `firing` "on a frame in which it has a target and is
// online", and gives the emitter no target at all when nothing is in range — "The
// Forge and the Sink target nothing", and every other emitter targets "the
// in-range unit with the smallest `remaining`", of which there is none here. On
// such a frame the accumulator "neither grows nor falls", so no shot resolves, and
// specs/heat.md adds `heatPerShot` for a SHOT rather than for a frame, so an idle
// emitter gains nothing.
//
// THE HEAT READING IS WHAT MAKES THIS MORE THAN A FLAG. A build could report
// `firing` false and go on resolving shots underneath it; the heat is the
// observable that says whether the fire clock actually ran. It is read at heat
// `0`, where specs/heat.md's air cooling — proportional to `H / 100` — is exactly
// nothing, so the reading is one-sided and exact: any movement at all is a gain,
// and the only thing that can produce one on an empty floor is a shot.
//
// THE THERMAL MODEL IS LEFT RUNNING, deliberately: this is the one combat point
// whose reading is a heat, so pinning it would remove the very thing being
// measured. Nothing else stands on the floor, so there is no neighbour to conduct
// with and no mover to feed it — which is why the gun is posed with `poseTower`
// rather than through this group's `poseGun`.
//
// THE FLOOR IS EMPTY RATHER THAN HOLDING A UNIT OUT OF RANGE. What is decided here
// is that an emitter with nothing to shoot at fires nothing;
// `combat/range-outside` decides that a unit beyond the radius is nothing to shoot
// at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";
import { GUN } from "./duel";

/** The emitter read. Its guns and its thermal model both run. */
const TOWER = "arc";

/** How long the idle floor is driven for, in seconds of game time. */
const IDLE_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("An idle gun fires nothing", async () => {
  startRun(h);
  const id = poseTower(h, TOWER, GUN.col, GUN.row);

  await h.advance(ticksFor(IDLE_SECONDS));
  captureStill(h, "idle");
  const gun = towerOf(h.snapshot(), id);

  assertEqual(
    gun.firing,
    false,
    `firing after ${IDLE_SECONDS}s with nothing on the floor`,
  );
  assertNull(
    gun.targeting,
    `targeting after ${IDLE_SECONDS}s with nothing on the floor`,
  );
  assertEqual(
    gun.heat,
    0,
    `heat after ${IDLE_SECONDS}s idle, opened at 0 where air cooling is nothing`,
  );
});
