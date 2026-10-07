// water/off-edge-right — a critter carried past the strait's RIGHT edge loses a
// life, and loses it there rather than anywhere along the way.
//
// specs/water.md: "A critter carried to a side edge of the strait is lost. It
// loses a life on the tick its center `x` falls below `0` or rises above
// `STRAIT_W` (`1280`)." This point is the `STRAIT_W` half of that sentence;
// `water/off-edge-left` is the other, and each is its own item so a build that
// wrote one edge and forgot the other grades differently from one that wrote
// neither. A build that clamps a rider's centre to the strait, or that only ever
// tested `x < 0`, passes the left edge and fails here.
//
// THE DRIVE IS IN TWO PARTS, AND THE FIRST IS WHAT MAKES THE READING SPECIFIC.
// A check that only asked "was a life lost by the end" would pass a build that
// drowns a rider, or that takes a life the moment a critter is put on a water
// row, or that treats the whole rightmost column as fatal. So:
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
// Together they say the life went with the CENTRE crossing `STRAIT_W`, to within
// half a tile before it and two tiles after it, and not with anything else on
// the route.
//
// NOTHING ELSE CAN COST THE LIFE. `startCrossing` empties both rosters and shuts
// the four world gates, so there is no bear, no vehicle and no crossing timer
// (specs/progression.md lists the costs, and this scenario leaves exactly one of
// them reachable). The one that would otherwise be reachable is drowning, and
// the pose rules it out: the critter stands on the LAST tile of a four-tile
// raft, so the raft extends three tiles to its left and still covers the centre
// when the centre reaches `STRAIT_W` — its right edge is only half a tile past
// the edge then, far from carried off. The footing is `floe` for the whole
// approach, so the life that goes is the sweep's.
//
// WHAT THIS POINT DOES NOT DECIDE. That a floe carries a rider at its lane's own
// rate is `water/floe-carries`; that a lost life takes exactly one and starts
// the dying hold is `progression/off-edge-costs-life`. Both readings below are
// of the life count, and the drive is bounded by a BUDGET rather than run for a
// fixed window, so a build that carries its rider slowly fails the carry's item
// and passes this one.

import { afterEach, beforeEach, it } from "vitest";
import { ITEM_LEN, START_LIVES, STRAIT_W, TILE, tileCX } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  coversX,
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
const LANE_ROW = 3;

/** The kind it rides: a raft4, which the lane table gives row 3. */
const LANE_KIND = "raft4";

/**
 * The raft's leftmost column, and the column the critter is posed on.
 *
 * The raft's LAST tile, so its other three tiles lie to the critter's left: a
 * floe must cover a centre for that centre to be carried at all, and putting the
 * rider at the raft's right end is what keeps the raft on the strait when the
 * centre reaches `STRAIT_W`. See the header.
 */
const FLOE_COL = 32;
const CRITTER_COL = FLOE_COL + ITEM_LEN[LANE_KIND] - 1;

/**
 * The lane's posed motion.
 *
 * Rightward, which is also row 3's table direction, so a build that drifted the
 * row by the table rather than by the lane still carries the critter towards the
 * edge this point is about: which way a lane runs is `water/lane-directions`'s
 * requirement and a failure there must not fail here as well. The speed is this
 * check's own, and nothing below reads it.
 */
const LANE_DIR = 1;
const LANE_SPEED = 4;

/**
 * How close to the edge the approach runs, in stage units.
 *
 * Half a tile. At the posed speed a tick carries the centre `1.07` units, so the
 * approach cannot overshoot `STRAIT_W` inside one sample at any carry rate up to
 * fifteen times the one posed — the reading it ends on is of a critter still on
 * the strait. Everything further in than this is where a life must NOT have been
 * lost, and the pose starts the centre `128` units short of the edge, so that is
 * four tiles of drift the build is held to.
 */
const APPROACH_X = TILE / 2;

/**
 * How far past the edge the crossing may run before the life must be gone.
 *
 * Two tiles. The rule fixes the tick the centre rises above `STRAIT_W`, and at
 * the posed speed a tile is thirty ticks, so two of them is generous slack for a
 * build that resolves the edge after moving rather than before — while still
 * failing one that keeps a critter alive until its art has left the view.
 */
const LATE_X = STRAIT_W + 2 * TILE;

/**
 * The game time each part of the drive may take, in seconds.
 *
 * At the posed `4` tiles a second the approach's `128` units take `1` s and the
 * crossing's last half tile takes `0.13` s, so these are six and thirty times
 * what the rule needs. A budget rather than a window: see the header.
 */
const APPROACH_SECONDS = 6;
const CROSSING_SECONDS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a life when the drift carries the critter's centre past x = 1280", async () => {
  startCrossing(h, LEVEL);
  poseLane(h, LANE_ROW, LANE_KIND, [FLOE_COL]);
  h.debug.setCritterTile(CRITTER_COL, LANE_ROW);
  h.debug.setLaneDirection(LANE_ROW, LANE_DIR);

  // The scenario this check needs: the critter riding a raft well inside the
  // strait, with every life in hand.
  const posed = h.snapshot();
  const floe = lastFloe(posed);
  assertTrue(
    coversX(floe, posed.critter.x),
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

  const { approach, crossing } = await captureReplay(h, "sweep", async () => {
    h.debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
    // The approach: driven until the centre is within half a tile of the edge,
    // or a life goes first.
    const reached = await h.until(
      (snapshot) =>
        snapshot.lives < START_LIVES ||
        snapshot.critter.x >= STRAIT_W - APPROACH_X,
      { maxFrames: ticksFor(APPROACH_SECONDS), poll: 1 },
    );
    // The crossing: driven on until the life goes, or the centre is two tiles
    // past the edge.
    const swept = await h.until(
      (snapshot) => snapshot.lives < START_LIVES || snapshot.critter.x > LATE_X,
      { maxFrames: ticksFor(CROSSING_SECONDS), poll: 1 },
    );
    return { approach: reached, crossing: swept };
  });

  // The approach: the critter was carried to the edge, and cost nothing on the
  // way.
  assertTrue(
    approach.hit,
    `the drift to carry the critter's centre from x ${posed.critter.x} to ` +
      `within ${APPROACH_X} units of the right edge at ${STRAIT_W} inside ` +
      `${APPROACH_SECONDS} s (specs/water.md), was x ` +
      `${approach.snapshot.critter.x} after ${approach.frames} ticks`,
  );
  assertEqual(
    approach.snapshot.lives,
    START_LIVES,
    "the lives left with the centre still " +
      `${STRAIT_W - approach.snapshot.critter.x} units inside the strait, ` +
      "which costs nothing (specs/water.md: the life goes on the tick the " +
      `centre rises above ${STRAIT_W})`,
  );

  // The crossing: the centre left the strait and the life went with it.
  assertTrue(
    crossing.hit,
    `a life lost as the centre was carried past x = ${STRAIT_W} within ` +
      `${CROSSING_SECONDS} s of reaching the edge (specs/water.md), was ` +
      `${crossing.snapshot.lives} lives at x ${crossing.snapshot.critter.x}`,
  );
  assertEqual(
    crossing.snapshot.lives,
    START_LIVES - 1,
    "the lives left after being carried past the strait's right edge at x = " +
      `${STRAIT_W} (specs/water.md), with the centre at x ` +
      `${crossing.snapshot.critter.x}`,
  );
});
