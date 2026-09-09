// water/off-edge-left — a critter carried past the strait's LEFT edge loses a
// life, and loses it there rather than anywhere along the way.
//
// specs/water.md: "A critter carried to a side edge of the strait is lost. It
// loses a life on the tick its center `x` falls below `0` or rises above
// `STRAIT_W` (`1280`)." This point is the `0` half of that sentence;
// `water/off-edge-right` is the other, and each is its own item so a build that
// wrote one edge and forgot the other grades differently from one that wrote
// neither.
//
// THE DRIVE IS IN TWO PARTS, AND THE FIRST IS WHAT MAKES THE READING SPECIFIC.
// A check that only asked "was a life lost by the end" would pass a build that
// drowns a rider, or that takes a life the moment a critter is put on a water
// row, or that treats the whole leftmost column as fatal. So:
//
//   - THE APPROACH. The lane is driven, a tick at a time, until the centre is
//     within `APPROACH_X` of the edge or a life is lost, whichever comes first,
//     and the life must still be in hand at that point. A build that took it
//     anywhere over the `128` units of drift before that fails here, with the
//     centre it was at when the life went named.
//   - THE CROSSING. From there the lane is driven on until the life is lost or
//     the centre is `LATE_X` past the edge, and the life must be gone. A build
//     that carries its rider clean off the strait and keeps playing fails here.
//
// Together they say the life went with the CENTRE crossing `0`, to within half a
// tile before it and two tiles after it, and not with anything else on the route.
//
// NOTHING ELSE CAN COST THE LIFE. `startCrossing` empties both rosters and shuts
// the four world gates, so there is no bear, no vehicle and no crossing timer
// (specs/progression.md lists the five costs, and this scenario leaves exactly
// one of them reachable). The one that would otherwise be reachable is drowning,
// and the pose rules it out: the critter stands on the FIRST tile of a four-tile
// raft, so the raft extends three tiles to its right and still covers the centre
// when the centre reaches `0` — its left edge is only half a tile past the edge
// then, far from carried off. The footing is `floe` for the whole approach, so
// the life that goes is the sweep's.
//
// WHAT THIS POINT DOES NOT DECIDE. That a floe carries a rider at its lane's own
// rate is `water/floe-carries`; that a lost life takes exactly one and starts
// the dying hold is `progression/off-edge-costs-life`. Both readings below are
// of the life count, and the drive is bounded by a BUDGET rather than run for a
// fixed window, so a build that carries its rider slowly fails the carry's item
// and passes this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { START_LIVES, TILE, tileCX, type LaneDir } from "../constants";
import {
  captureReplay,
  covers,
  createHarness,
  lastFloe,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the crossing is posed at. The edge rule is the same at each. */
const LEVEL = 1;

/** The water lane the critter rides. */
const LANE_ROW = 6;

/** The kind it rides: a raft4, which the lane table gives row 6. */
const LANE_KIND = "raft4";

/**
 * The raft's leftmost column, and the column the critter is posed on.
 *
 * The SAME column, so the raft's other three tiles lie to the critter's right:
 * a floe must cover a centre for that centre to be carried at all, and putting
 * the rider at the raft's left end is what keeps the raft on the strait when the
 * centre reaches `0`. See the header.
 */
const FLOE_COL = 4;
const CRITTER_COL = FLOE_COL;

/**
 * The lane's posed motion.
 *
 * Leftward, which is also row 6's table direction, so a build that drifted the
 * row by the table rather than by the lane still carries the critter towards the
 * edge this point is about: which way a lane runs is `water/lane-directions`'s
 * requirement and a failure there must not fail here as well. The speed is this
 * check's own, and nothing below reads it.
 */
const LANE_DIR: LaneDir = -1;
const LANE_SPEED = 4;

/**
 * How close to the edge the approach runs, in stage units.
 *
 * Half a tile. At the posed speed a tick carries the centre `1.07` units, so the
 * approach cannot overshoot `0` inside one sample at any carry rate up to
 * fifteen times the one posed — the reading it ends on is of a critter still on
 * the strait. Everything further out than this is where a life must NOT have
 * been lost, and the pose starts the centre `128` units out, so that is four
 * tiles of drift the build is held to.
 */
const APPROACH_X = TILE / 2;

/**
 * How far past the edge the crossing may run before the life must be gone.
 *
 * Two tiles. The rule fixes the tick the centre falls below `0`, and at the
 * posed speed a tile is thirty ticks, so two of them is generous slack for a
 * build that resolves the edge after moving rather than before — while still
 * failing one that keeps a critter alive until its art has left the view.
 */
const LATE_X = -2 * TILE;

/**
 * The game time each part of the drive may take, in seconds.
 *
 * At the posed `4` tiles a second the approach's `128` units take `1` s and the
 * crossing's last half tile takes `0.13` s, so these are six and thirty times
 * what the rule needs. A budget rather than a window: see the header.
 */
const APPROACH_SECONDS = 6;
const CROSSING_SECONDS = 4;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("takes a life when the drift carries the critter's centre past x = 0", async () => {
  const { debug } = harness;
  await startCrossing(harness, LEVEL);
  await poseLane(harness, LANE_ROW, LANE_KIND, [FLOE_COL]);
  await debug.setCritterTile(CRITTER_COL, LANE_ROW);
  await debug.setLaneDirection(LANE_ROW, LANE_DIR);

  // The scenario this check needs: the critter riding a raft well inside the
  // strait, with every life in hand.
  const posed = await harness.snapshot();
  const floe = lastFloe(posed);
  assertTrue(
    floe !== undefined && covers(floe, posed.critter.x),
    `a ${LANE_KIND} on row ${LANE_ROW} covering the critter's centre at ` +
      `x ${tileCX(CRITTER_COL)} (specs/water.md), was ${JSON.stringify(floe)}`,
  );
  assertEqual(
    posed.critter.footing,
    "floe",
    "the footing a carried critter rides on (specs/water.md)",
  );
  assertEqual(
    posed.lives,
    START_LIVES,
    "the crossing begins with every life still in hand (specs/progression.md)",
  );

  const { approach, crossing } = await captureReplay(
    harness,
    "sweep",
    async () => {
      await debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
      // The approach: driven until the centre is within half a tile of the edge,
      // or a life goes first.
      const reached = await harness.until(
        (snapshot) =>
          snapshot.lives < START_LIVES || snapshot.critter.x <= APPROACH_X,
        { maxTicks: ticksFor(APPROACH_SECONDS), poll: 1 },
      );
      // The crossing: driven on until the life goes, or the centre is two tiles
      // past the edge.
      const swept = await harness.until(
        (snapshot) =>
          snapshot.lives < START_LIVES || snapshot.critter.x < LATE_X,
        { maxTicks: ticksFor(CROSSING_SECONDS), poll: 1 },
      );
      return { approach: reached, crossing: swept };
    },
  );

  // The approach: the critter was carried to the edge, and cost nothing on the
  // way.
  assertTrue(
    approach.hit,
    `the drift to carry the critter's centre from x ${posed.critter.x} to ` +
      `within ${APPROACH_X} units of the left edge inside ` +
      `${APPROACH_SECONDS} s (specs/water.md), was x ` +
      `${approach.snapshot.critter.x} after ${approach.ticks} ticks`,
  );
  assertEqual(
    approach.snapshot.lives,
    START_LIVES,
    `the lives left with the centre still ${approach.snapshot.critter.x} ` +
      `units inside the strait, which costs nothing (specs/water.md: the life ` +
      `goes on the tick the centre falls below 0)`,
  );

  // The crossing: the centre left the strait and the life went with it.
  assertTrue(
    crossing.hit,
    `a life lost as the centre was carried past x = 0 within ` +
      `${CROSSING_SECONDS} s of reaching the edge (specs/water.md), was ` +
      `${crossing.snapshot.lives} lives at x ${crossing.snapshot.critter.x}`,
  );
  assertEqual(
    crossing.snapshot.lives,
    START_LIVES - 1,
    `the lives left after being carried past the strait's left edge at x = 0 ` +
      `(specs/water.md), with the centre at x ${crossing.snapshot.critter.x}`,
  );

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
