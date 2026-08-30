// combos/multishot — a multishot tower fires at N distinct targets at once.
//
// specs/components.md: "Each cadence the structure fires at up to `N` distinct
// in-range units instead of one, choosing the top `N` by its targeting priority,
// each as its own projectile." specs/combinations.md gives the Fork Array
// `multishot(3)` and a reach of `118` at level `0`. Every shot is a travelling
// projectile carrying its target's id (specs/instrumentation.md), so a cadence's
// choice is read off `projectiles` on the frame it fires.
//
// FIVE TARGETS, ORDERED BY THE PRIORITY. Every firing structure defaults to
// `first`, which selects the unit furthest along the chain by the progress
// ordering of specs/pathing.md — compared first by the checkpoint the unit is
// heading for. So the five units are posed at five DIFFERENT checkpoints,
// `WP1` through `WP5`, and the three the tower must choose are the three highest
// of them. Ordering them by checkpoint rather than by remaining route length
// keeps the expected answer a fact about the pose rather than about the build's
// own route arithmetic.
//
// The units are Dynamos, whose health at the posed wave is far past what three
// cadences of a level-`0` Fork Array removes, so none of them is killed while
// the cadence is being read and the set of in-range units cannot change under
// the reading. Every unit's travel is held, so what each is a target of is
// decided by where this check put it. The yard holds one tower, so every
// projectile in flight came from it.
//
// The second half is the "up to" in the rule: one unit in range draws one
// projectile, not three at the same target and not three at one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { comboDef, structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standCombo,
  type Harness,
} from "../harness";

const TOWER = comboDef("forkarray");
/** The `multishot(N)` its row names. */
const N = 3;
const ANCHOR = { col: 10, row: 10 };
const CENTER = structureCenter(ANCHOR.col, ANCHOR.row);

/**
 * Five points inside the Fork Array's `118` reach, each with the checkpoint the
 * unit posed there is heading for. The three highest checkpoints are the three
 * the `first` priority must choose.
 */
const TARGETS = [
  { x: CENTER.x - 60, y: CENTER.y, waypoint: 5 },
  { x: CENTER.x + 60, y: CENTER.y, waypoint: 4 },
  { x: CENTER.x, y: CENTER.y - 60, waypoint: 3 },
  { x: CENTER.x, y: CENTER.y + 60, waypoint: 2 },
  { x: CENTER.x - 60, y: CENTER.y - 60, waypoint: 1 },
];

/** A wave deep enough that a Dynamo outlives every cadence this check reads. */
const WAVE = 10;

/** One cadence of a `1.8` /s tower is `0.56` s; this is comfortably past two. */
const MAX_FRAMES = 240;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("launches one projectile at each of its top N targets on one cadence", async () => {
  await openYard(h, { wave: WAVE });
  await standCombo(h, TOWER.id, ANCHOR.col, ANCHOR.row);

  const posed = new Map<number, number>();
  for (const target of TARGETS) {
    const id = await parkUnit(
      h,
      "dynamo",
      { x: target.x, y: target.y },
      { waypoint: target.waypoint },
    );
    posed.set(id, target.waypoint);
  }

  const volley = await captureReplay(h, "fork", async () => {
    const fired = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: MAX_FRAMES,
      poll: 1,
    });
    // A little of the flight after the cadence, so the clip shows the three
    // shots travelling rather than one frame of them appearing.
    await h.advance(30);
    return fired;
  });

  assertEqual(volley.hit, true, `the ${TOWER.name} fired inside two cadences`);
  const shots = volley.snapshot.projectiles;
  assertLength(shots, N, `one projectile for each of ${N} targets`);

  const struck = shots.map((shot) => shot.targetId);
  assertEqual(
    new Set(struck).size,
    N,
    "each projectile carries a target of its own",
  );
  const chosen = struck
    .map((id) => posed.get(id as number))
    .sort((a, b) => (b ?? 0) - (a ?? 0));
  assertEqual(
    chosen.join(", "),
    [5, 4, 3].join(", "),
    "the three units furthest along the chain, by the `first` priority",
  );

  // "Up to `N`": one unit in range draws one projectile.
  await h.debug.clearUnits();
  await h.debug.clearProjectiles();
  const alone = await parkUnit(
    h,
    "dynamo",
    { x: TARGETS[0]!.x, y: TARGETS[0]!.y },
    { waypoint: TARGETS[0]!.waypoint },
  );
  const single = await h.until((s) => s.projectiles.length > 0, {
    maxFrames: MAX_FRAMES,
    poll: 1,
  });
  assertEqual(single.hit, true, "the tower fired at the one unit in range");
  assertLength(
    single.snapshot.projectiles,
    1,
    "one in-range unit draws one projectile",
  );
  assertEqual(
    single.snapshot.projectiles[0]!.targetId,
    alone,
    "the one projectile carries the one unit in range",
  );
});
