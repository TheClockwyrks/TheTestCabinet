// Automated validation for the Hunter item `moves-into-vehicle`.
//
// A vehicle's tile is closed to the bear. The pursuit is suspended and the bear is
// commanded UP into the flank of a parked car in the lane above: the move is refused,
// the bear stays on its own tile, and nothing is taken from it for trying. Then — from
// the same scene, on the same car — the bear is put in the lane and the car released
// into it, and that does reset it (specs/hunter.md). See validation/_helpers.mjs.
//
// THE BEAR MEETS THE CAR THE WAY THE CRITTER DOES, side-on from the lane below, and is
// answered the same way: the tile is occupied, so the move does not happen. That is the
// whole rule — the two actors share the board, traffic never punishes either of them for
// moving toward it, only for arriving on them. `movement.refuse-vehicle` is the same
// situation one item over with the critter in the bear's place.
//
// BOTH HALVES, IN ONE SCENARIO, DELIBERATELY. "The bear was not reset" is a negative
// claim, and a negative claim is satisfied for free by a build in which nothing ever
// resets a bear at all — which is the very defect `reset-on-hit` exists to catch,
// passing an item about the boundary of that same rule. So the item does not stop at
// the refusal: it puts the bear in the lane clear of the car, releases the car, and
// requires the reset to happen. Only a build that draws the line where specs/hunter.md
// draws it can satisfy both halves, and both are measured on the same car in the same
// lane, so there is no room for them to be answered by different code paths.
//
// THE CAR IS PARKED FOR THE FIRST HALF, and it has to be. The claim is that the BEAR's
// own move is refused; with the car also moving, the car could arrive on the bear inside
// the same window and no reading of the outcome could say which rule answered. Parking
// it isolates the bear's move — and the second half puts that same car back in motion,
// so the parked staging never becomes a way to pass.
//
// NONE OF IT DEPENDS ON THE PURSUIT. `setBearAI(false)` holds the bear, `moveBear` drives
// it a tile at a time, and `setLaneMotion` decides when the car moves
// (specs/instrumentation.md) — so which way the bear's brain would have chosen to go, and
// whether it would have routed around the car, never enter into it. That matters here
// more than anywhere: the pursuit is specified to avoid the tile this item commands the
// bear into, so only a command that ignores the route can pose the scenario at all.

import {
  clearIce,
  iceLaneAt,
  laneCovers,
  startCrossing,
  ROW_NEAR,
} from "../_helpers.mjs";

// The lane the car is parked in — row 13 is a two-tile dogsled (specs/hazards.md) — and
// the row below it, where the bear stands.
const LANE_ROW = 13;
const BEAR_ROW = LANE_ROW + 1;

// The bear stands directly below the car's leading tile, so the commanded step up aims
// squarely at a tile the car covers. For the second half it is placed IN the lane, clear
// of the car, on the tile the released car has to travel through to reach it.
const CAR_COL = 20;
const BEAR_COL = CAR_COL;
const RESET_COL = CAR_COL - 2;

// The critter, parked out of the way on the near shore: with the pursuit suspended it has
// no part in the staging and is here only so the crossing is live.
const CRITTER_COL = 6;

// How long the commanded step is given. A step is one tile at the bear's ~3
// tiles/second (specs/hunter.md), so 40 ticks; this is comfortably past that, which is
// what makes "it did not move" a reading rather than a race.
const STEP_TICKS = 72; // 0.6 s

// How long the bear is then watched, with nothing in motion, before the verdict. A build
// that resets on contact resolves it within a step or two, so this is many times over
// what it would take to show up.
const DWELL_TICKS = 120; // 1 s

// The car is released leftward, into the tile the bear was placed on, at a speed well
// over row 13's own 2.5 so the second half is decided promptly.
const CAR_SPEED = 12;
const CAR_DIR = -1;

const LIVES = 3;

export default function item() {
  // The bear and the lane after the refused command, the lives it cost, and the sweep
  // that watched the released car arrive.
  let refused;
  let refusedLane;
  let refusedLives;
  let placedInLane;
  let r;

  return {
    id: "hunter.moves-into-vehicle",

    // Pose the scene: an empty road, the pursuit suspended, a parked car in the lane and
    // the bear on the tile directly below its leading tile, with the critter out of the
    // way.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setBearAI", false);
      await clearIce(api);
      await api.call("placeCritter", CRITTER_COL, ROW_NEAR);
      await api.call("setBear", 0, { col: BEAR_COL, row: BEAR_ROW });
      await api.call("setLane", LANE_ROW, {
        cols: [CAR_COL],
        speed: 0,
        dir: CAR_DIR,
      }); // parked, and staying that way until the second half
    },

    // Command the bear up into the car's flank and hold on what happens — which should be
    // nothing at all. Then put it in the lane and release the car into it.
    async act(api) {
      await api.call("moveBear", 0, "up"); // into the flank of the parked car
      await api.advance(STEP_TICKS);
      await api.advance(DWELL_TICKS); // held there, with nothing in motion
      const s = await api.snapshot();
      refused = s.bears[0];
      refusedLane = iceLaneAt(s, LANE_ROW);
      refusedLives = s.lives;

      // The same car, now the one that closes the distance: the bear is stood in its
      // lane, clear of it, and the lane released so the car arrives on the bear.
      await api.call("setBear", 0, { col: RESET_COL, row: LANE_ROW });
      placedInLane = (await api.snapshot()).bears[0];
      await api.call("setLaneMotion", LANE_ROW, { speed: CAR_SPEED });
      r = await api.until((s2) => !s2.bears[0].present, { max: 180 }); // 1.5 s
    },

    async assert(api, check) {
      // The refusal. The bear is still on the board, still on its own tile, and the
      // crossing is untouched — a move into a vehicle costs nothing, it simply does not
      // happen.
      check.expectEq(
        "the bear is not reset for moving into a vehicle",
        refused.present,
        true,
      );
      if (refused.present) {
        check.expectEq(
          "the move into the car's tile is refused (the bear stays in its own row)",
          refused.row,
          BEAR_ROW,
        );
        check.expectEq("and it does not move at all", refused.col, BEAR_COL);
      }
      check.expectEq(
        "and the crossing is untouched by it",
        refusedLives,
        LIVES,
      );
      // The staging behind the refusal: the tile it was aimed at really was the parked
      // car's. Read after the fact so a build that lost the bear fails on the rule above
      // rather than on the staging.
      check.expectOk(
        "the tile it was commanded into really is the parked car's",
        laneCovers(refusedLane, CAR_COL),
      );

      // The second half, on the same car: once the car is the one closing the distance,
      // it does reset the bear. Without this the refusal above would be satisfied by a
      // build in which traffic never resets a bear at all.
      check.expectEq(
        "the bear is standing in the car's lane, clear of it",
        placedInLane.present ? placedInLane.row : null,
        LANE_ROW,
      );
      check.expectOk("the same car, once moving, does reset it", r.hit);
    },
  };
}
