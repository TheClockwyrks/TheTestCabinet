// Automated validation for the Hunter item `moves-into-vehicle`.
//
// The vehicle has to be the one that closed the distance. A bear that travels onto a
// vehicle is not reset by it; a vehicle whose own motion brings it onto the bear is
// (specs/hunter.md). The pursuit is suspended, the bear is driven onto a parked car and
// survives, and then — from the same scene — the car is released and takes it.
//
// BOTH HALVES, IN ONE SCENARIO, DELIBERATELY. "The bear survived" is a negative claim,
// and a negative claim is satisfied for free by a build in which nothing ever resets a
// bear at all — which is the very defect `reset-on-hit` exists to catch, passing an item
// about the boundary of that same rule. So the item does not stop at surviving: it steps
// the bear back off the car, releases the lane, and requires the reset to happen. Only a
// build that draws the line where specs/hunter.md draws it can satisfy both halves, and
// the second half is measured on the same bear, the same car and the same tile as the
// first, so there is no room for the two to be answered by different code paths.
//
// NONE OF IT DEPENDS ON THE PURSUIT. `setBearAI(false)` holds the bear, `moveBear` drives
// it a tile at a time, and `setLaneMotion` decides when the car moves
// (specs/instrumentation.md) — so which way the bear's brain would have chosen to go, and
// whether it would have avoided the car, never enter into it. That matters here more than
// anywhere: the pursuit is specified to refuse exactly the move this item needs to make.

import { clearIce, startCrossing, ROW_NEAR, TILE } from "../_helpers.mjs";

// The lane the scene is staged in — row 13 is a two-tile dogsled (specs/hazards.md).
const LANE_ROW = 13;

// The bear starts one tile to the left of the parked car, so a single commanded step puts
// it on the car's own leading tile.
const BEAR_COL = 20;
const CAR_COL = BEAR_COL + 1;

// The critter, parked out of the way on the near shore: with the pursuit suspended it has
// no part in the staging and is here only so the crossing is live.
const CRITTER_COL = 6;

// How long each commanded step is given to complete. A step is one tile at the bear's
// ~3 tiles/second (specs/hunter.md), so 40 ticks; this is comfortably past that.
const STEP_TICKS = 72; // 0.6 s

// How long the bear is watched sitting on the parked car before the verdict. A reset is
// resolved within a step or two by any build that resets at all, so this is many times
// over what it would take to show up.
const DWELL_TICKS = 120; // 1 s

// The speed the car is released at, faster than row 13's own 2.5 so the second half is
// decided promptly.
const CAR_SPEED = 12;

const LIVES = 3;

/** Whether any vehicle in `items` covers the tile at column `col`. */
function vehicleCovers(items, col) {
  const left = col * TILE;
  return (items || []).some(
    (v) => v.x < left + TILE && left < v.x + v.len * TILE,
  );
}

/** The ice lane at `row` from a snapshot. */
const laneAt = (s, row) => (s.lanes.ice || []).find((l) => l.row === row);

export default function item() {
  // The state on the car, the state after stepping back off it, and the sweep that
  // watched the released car arrive.
  let onCar;
  let onCarLane;
  let onCarLives;
  let steppedBack;
  let r;

  return {
    id: "hunter.moves-into-vehicle",

    // Pose the scene: an empty road, the pursuit suspended, the bear a tile to the left of
    // a parked car, and the critter out of the way.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setBearAI", false);
      await clearIce(api);
      await api.call("placeCritter", CRITTER_COL, ROW_NEAR);
      await api.call("setBear", 0, { col: BEAR_COL, row: LANE_ROW });
      await api.call("setLane", LANE_ROW, {
        cols: [CAR_COL],
        speed: 0,
        dir: -1,
      }); // parked, and staying that way until the second half
    },

    // Drive the bear onto the parked car and hold there; then step it back off and release
    // the car into it. Both halves of the rule, and the clip.
    async act(api) {
      await api.call("moveBear", 0, "right"); // onto the car's tile
      await api.advance(STEP_TICKS);
      await api.advance(DWELL_TICKS); // sitting on it, with nothing in motion
      const s = await api.snapshot();
      onCar = s.bears[0];
      onCarLane = laneAt(s, LANE_ROW);
      onCarLives = s.lives;

      // Step back off, so the released car has a tile to newly arrive on. (A car released
      // while the bear is inside it never NEWLY covers the bear's tile, so it could not
      // resolve the second half either way.)
      await api.call("moveBear", 0, "left");
      await api.advance(STEP_TICKS);
      steppedBack = (await api.snapshot()).bears[0];

      await api.call("setLaneMotion", LANE_ROW, { speed: CAR_SPEED });
      r = await api.until((s2) => !s2.bears[0].present, { max: 180 }); // 1.5 s
    },

    async assert(api, check) {
      // The first half: the car did not take it, and it really did go onto the car.
      //
      // The rule leads, and the drive is read behind it. A build that resets on contact
      // however it arose loses the bear the instant it arrives, so it has no column left
      // to report — and if the drive were asserted first it would fail as "the bear was
      // never driven onto the tile", which describes the staging rather than the defect.
      // Read this way the same build fails on the rule it broke. The drive assertions
      // still hold a build that quietly refused the commanded step to account: they run
      // whenever there is a bear to read.
      check.expectEq(
        "a bear that travels onto a vehicle is not reset by it",
        onCar.present,
        true,
      );
      if (onCar.present) {
        check.expectEq(
          "the bear really is driven onto the car's tile",
          onCar.col,
          CAR_COL,
        );
        check.expectOk(
          "...and that tile really is the parked car's",
          vehicleCovers(onCarLane && onCarLane.items, CAR_COL),
        );
      }
      check.expectEq("and the crossing is untouched by it", onCarLives, LIVES);

      // The second half, on the same bear and the same car: released, it does reset.
      // Without this the item above would be satisfied by a build that never resets a
      // bear at all.
      check.expectEq(
        "the bear steps back off the car",
        steppedBack.present ? steppedBack.col : null,
        BEAR_COL,
      );
      check.expectOk("the same car, once moving, does reset it", r.hit);
    },
  };
}
