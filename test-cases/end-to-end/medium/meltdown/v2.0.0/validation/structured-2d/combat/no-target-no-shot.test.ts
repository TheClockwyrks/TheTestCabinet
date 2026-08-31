// combat/no-target-no-shot — an idle gun fires nothing.
//
// specs/combat.md, The fire clock: an emitter reports `firing` on a frame in
// which it has a target and is online, and on a frame in which it has no target
// its accumulator neither grows nor falls. With nothing on the floor there is no
// target to take, so the tower reports `firing` false, `targeting` null, and
// resolves no shot at all.
//
// The last of those is read as HEAT rather than as a claim about `firing`,
// because heat is the consequence a shot leaves behind that a build cannot
// report its way out of: `specs/heat.md` adds `shotsFired * heatPerShot` to a
// tower's heat every frame, so an Arc that fired at nothing for a second would
// stand at two shots' worth of its 10.3 per shot. The tower is posed cold with
// its thermal model LIVE, and at heat 0 every cooling term is proportional to
// `H / 100` and therefore zero (specs/heat.md, The four flows) — so an emitter
// that fires nothing holds exactly 0 and one that fires at nothing cannot.
//
// The floor is posed EMPTY rather than with a bystander parked out of range: the
// requirement is what a tower does with no target, and a unit standing somewhere
// would make this a range check that `range-outside` already decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength, assertNull, assertTruthy } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  ticksFor,
  towerById,
  type Harness,
  type TowerSnapshot,
} from "../harness";

/**
 * A quiet footprint anchor: clear of the left corridor (rows 16..19) and of the
 * top one (columns 22..29) (specs/floor.md).
 */
const SITE = { col: 4, row: 4 };

/** Where a tower `addTower` built opens: heat 0 (specs/instrumentation.md). */
const COLD = 0;

/** The idle span the reading is taken over. */
const IDLE_SECONDS = 1;

/**
 * How far the heat may sit from 0 after that span: half a thousandth of the
 * scale.
 *
 * The rule leaves NO term running here — no shot to add heat, and every cooling
 * term zero at heat 0 — so the honest expectation is exactly 0 and this is room
 * for a build that integrates the flows in floating point rather than
 * short-circuiting them. One shot of an Arc's `heatPerShot` is 10.3
 * (specs/towers.md), twenty thousand times this.
 */
const HEAT_TOLERANCE = 0.0005;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

/** The tower as the snapshot reports it; a tower that has gone fails here. */
function towerNow(id: number): TowerSnapshot {
  const tower = towerById(harness.snapshot(), id);
  assertTruthy(tower, `the tower ${id} still on the floor`);
  return tower as TowerSnapshot;
}

it("takes no target, reports no firing and gains no heat with the floor empty", async () => {
  startRun(harness);
  const arc = poseTower(harness, "arc", SITE.col, SITE.row);
  assertLength(harness.snapshot().surge, 0, "an empty floor to stand on");

  await harness.advance(ticksFor(IDLE_SECONDS));
  captureStill(harness, "idle");

  const tower = towerNow(arc);
  assertNull(tower.targeting, "targeting with nothing on the floor");
  assertEqual(tower.firing, false, "firing with nothing on the floor");
  assertCloseTo(
    tower.heat,
    COLD,
    3,
    `heat after ${IDLE_SECONDS}s idle, within ${HEAT_TOLERANCE}`,
  );
});
