// lanternjaw/light-range — it senses the forager's light within R.
//
// specs/predators/lanternjaw.md gives the sense three conditions that must hold
// together: "in range" — the distance between the two centers is at most `R`, the
// Lanternjaw's detection range — "in line of sight", and "clear of ink". While it
// senses the forager it "reports `state` as `"chase"`", and the snapshot "reports
// its current value as `detectRange`".
//
// So this point is the RANGE condition, asked on both sides of the boundary with
// the other two conditions held constant: one straight corridor, so the line of
// sight is clear at either distance, and no ink anywhere on the board.
//
// THE BOUNDARY IS THE BUILD'S OWN `detectRange`, NOT THE FORMULA. What `R` works
// out to at a given brightness — `LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G` —
// is `brightness/widens-lanternjaw`'s verdict, and a build that reports the wrong
// figure should fail there once rather than twice. Here the reported figure is
// taken as given and the two standoffs are measured from it: half of it, and half
// again beyond it. A build whose `R` is right and whose sense ignores it fails
// here; a build whose `R` is wrong fails there.
//
// THE CORRIDOR IS POSED. specs/maze.md fixes rules rather than a layout, so a
// straight run long enough to stand a hunter well beyond `R` on is something a
// check lays out rather than goes looking for (specs/instrumentation.md exempts a
// posed fixture from those rules).
//
// WHAT THIS DOES NOT DECIDE. Whether rock breaks the sense is
// `lanternjaw/los-break`'s; what happens to a fix once taken is
// `lanternjaw/dim-shakes`'s and `lanternjaw/ink-shakes`'s; how fast it then
// travels is `lanternjaw/wander-disguise`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BRIGHT_HOLD, TILE } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
  fail,
} from "../assert";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  poseBrightness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import {
  parkForager,
  requireSceneHeld,
  sceneGuard,
  separation,
} from "../scene";
import { Tile } from "../maze";

/**
 * The corridor the pair stands on, in tiles.
 *
 * Long enough to hold the far standoff at any conforming brightness: `R` reaches
 * `LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN` (320) at `G = 1`, and the far standoff
 * sits at `OUTSIDE_FACTOR` times that, which is 15 tiles from the forager. Two
 * tiles of slack past it so a wandering hunter is not stopped by rock the instant
 * it starts.
 */
const RUN_TILES = 18;

/** The brightness the pair is posed at, which `setBrightness` holds steady. */
const POSED_G = 1;

/**
 * Where the near standoff sits, as a fraction of the reported `detectRange`.
 *
 * Half of it: unambiguously inside, and far enough out that the reading is not
 * taken on top of the forager.
 */
const INSIDE_FRACTION = 0.5;

/**
 * Where the far standoff sits, as a multiple of the reported `detectRange`.
 *
 * Half again beyond it, so no rounding of a tile center can put it inside.
 */
const OUTSIDE_FACTOR = 1.5;

/**
 * How long the sense is given to take hold, in ticks.
 *
 * A tenth of a second. specs/predators/lanternjaw.md has the sense hold "on any
 * step where all three of these hold at once", so a conforming build acquires on
 * the first step; the window is a hard bound rather than a wait, so a build that
 * takes longer than a tenth of a second FAILS here rather than being waited for.
 */
const ACQUIRE_TICKS = ticks(0.1);

/**
 * How long the far standoff is watched for a fix that must not come, in ticks.
 *
 * Half a second, sampled throughout. Long enough that a build acquiring a step or
 * two late is caught, and short enough that a hunter wandering at
 * `DRIFTER_SPEED` (64) cannot close the half-a-range of ground between the two
 * standoffs while it runs.
 */
const DENY_TICKS = ticks(0.5);

/** How often the far watch reads the state, in ticks. */
const DENY_POLL = 6;

/** Ticks held after every reading, purely so the clip reads as a chase. */
const TAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("It senses the forager's light within R", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, [`F${".".repeat(RUN_TILES - 1)}`]);
  const home = board.mark("F");
  // Parked facing the rock across the corridor, so the standoffs below are the
  // distances the fixture states, on a board carrying no plankton to widen `G`.
  await parkForager(h, home);
  await poseBrightness(h, POSED_G, BRIGHT_HOLD);
  // The one Lanternjaw this point is about, put at the far end of the run until
  // each standoff moves it.
  const index = await spawnPredator(
    h,
    "lanternjaw",
    { tx: home.tx + RUN_TILES - 1, ty: home.ty },
    { state: "wander" },
  );
  const watch = await sceneGuard(h);

  // The build's own reported range, which is what both standoffs are measured
  // from. `specs/state.md` has a Lanternjaw report it as a number of logical
  // units, so a build that reports anything else leaves no boundary to stand
  // either side of.
  const reported = h.snapshot().predators[index].detectRange;
  if (
    typeof reported !== "number" ||
    !Number.isFinite(reported) ||
    reported <= 0
  ) {
    fail(
      "the Lanternjaw to report detectRange as a range in logical units, which " +
        "is the boundary this point stands the forager either side of",
      `it reported ${JSON.stringify(reported)}`,
    );
  }
  const insideTiles = Math.max(
    2,
    Math.round((reported * INSIDE_FRACTION) / TILE),
  );
  const outsideTiles = Math.ceil((reported * OUTSIDE_FACTOR) / TILE);
  assertLessThanOrEqual(
    outsideTiles,
    RUN_TILES - 1,
    `the tiles of corridor a standoff beyond the reported detectRange of ` +
      `${reported} units would need, against the ${RUN_TILES - 1} this fixture ` +
      "lays out — a range this wide cannot be stood outside of at all",
  );
  const inside: Tile = { tx: home.tx + insideTiles, ty: home.ty };
  const outside: Tile = { tx: home.tx + outsideTiles, ty: home.ty };

  const read = await captureReplay(h, "sense", async () => {
    // Inside the range, with a clear line and no ink: the sense must hold.
    await h.debug.setPredatorTile(index, inside.tx, inside.ty);
    await h.debug.setPredatorState(index, "wander");
    const near = await h.until((s) => s.predators[index].state === "chase", {
      maxFrames: ACQUIRE_TICKS,
      poll: 1,
    });
    const nearGap = separation(near.snapshot, index);
    const nearRange = near.snapshot.predators[index].detectRange;
    await h.advance(TAIL_TICKS);

    // The same pair, beyond the range. `wander` drops whatever fix the near
    // standoff earned (specs/instrumentation.md: "loose on the tile it stands
    // on, patrolling, with no fix on the forager"), and the brightness is posed
    // again so the hold covers this half too.
    await h.debug.setPredatorState(index, "wander");
    await h.debug.setPredatorTile(index, outside.tx, outside.ty);
    await poseBrightness(h, POSED_G, BRIGHT_HOLD);
    const seen: string[] = [];
    for (let spent = 0; spent < DENY_TICKS; spent += DENY_POLL) {
      await h.advance(DENY_POLL);
      seen.push(h.snapshot().predators[index].state);
    }
    const end = h.snapshot();
    await h.advance(TAIL_TICKS);
    return {
      near,
      nearGap,
      nearRange,
      seen,
      farGap: separation(end, index),
      farRange: end.predators[index].detectRange,
      end: h.snapshot(),
    };
  });

  requireSceneHeld(read.end, watch);

  // The fixture's own geometry, against the range the build itself reports.
  assertLessThanOrEqual(
    read.nearGap,
    read.nearRange ?? 0,
    `the units between the two centers at the near standoff (${insideTiles} ` +
      `tiles), which must be inside the detectRange the Lanternjaw reports`,
  );
  assertGreaterThan(
    read.farGap,
    read.farRange ?? 0,
    `the units between the two centers at the far standoff (${outsideTiles} ` +
      `tiles), which must be beyond the detectRange the Lanternjaw reports`,
  );

  assertEqual(
    read.near.hit,
    true,
    `the Lanternjaw takes a fix within ${ACQUIRE_TICKS} ticks of standing ` +
      `${read.nearGap.toFixed(0)} units from the forager, inside its own ` +
      `reported detectRange of ${read.nearRange}, on a clear line and clear of ` +
      "ink (specs/predators/lanternjaw.md)",
  );
  assertTrue(
    read.seen.every((state) => state !== "chase"),
    `the states the Lanternjaw reported across ${DENY_TICKS} ticks standing ` +
      `${read.farGap.toFixed(0)} units away, beyond its own reported ` +
      `detectRange of ${read.farRange}, hold no fix — it read ` +
      `[${read.seen.join(", ")}]`,
  );
});
