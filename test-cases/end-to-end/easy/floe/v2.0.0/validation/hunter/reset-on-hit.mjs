// Automated validation for the Hunter item `reset-on-hit`.
//
// A vehicle sliding into the bear resets it (removed from the strait), and it
// re-emerges from the near shore after a delay — not permanently gone, not merely
// staggered. The pursuit is suspended so the bear holds one tile, a car is parked a few
// tiles up the lane, and then the lane is set moving: the real collision removes the
// bear, and once the critter advances it comes back. See validation/_helpers.mjs.
//
// THE SCENARIO IS ASKED FOR, NOT COERCED. The rule under test is one sentence of
// specs/hunter.md — a plow, dogsled, or car that slides into a tile the bear occupies
// knocks it out. Which way the bear chooses to go, how well it avoids traffic, and how
// deeply it paths around an obstacle belong to `pursues`, `routes-around` and
// `continuous`, and every attempt to stage this collision by ARRANGING THE WORLD so the
// bear would happen to stay put — a target in its lane, a wall above it, a corridor
// around it — smuggled one of those into the verdict. They failed in both directions: a
// build whose bear drifted a few pixels off the row it was posed on escaped a collision
// it should have taken, and a build whose bear never moved at all was scored on staging
// that had quietly stepped around a defect elsewhere.
//
// `setBearAI(false)` removes the whole class of problem (specs/instrumentation.md): the
// bear holds the tile it is put on however far the simulation is stepped, so it is in
// exactly one tile, that tile is known, and no pursuit decision can move it out of the
// car's way. Suspending the pursuit deliberately does NOT make the bear inert — the spec
// is explicit that the world still acts on it, hazards included — so the rule under test
// is exercised in full.
//
// `setLaneMotion` supplies the other half: the car is laid out exactly where it is wanted
// with the lane parked, and then released. Placement and launch are separate acts, so the
// scene can be posed and read before anything is in motion, and the collision has a known
// start.
//
// WHAT STOPS IT PASSING FOR THE WRONG REASON. A removal must be the car's:
//
//   * while the car is still parked several tiles off, the bear must be exactly where it
//     was put and still on the strait. This is the load-bearing guard — a build that
//     drops its bear for no reason does it here, before anything has moved;
//   * the bear was last seen alive IN THE CAR'S LANE, with a vehicle of that lane within
//     the tile it occupied or one either side (specs/hunter.md counts the tile the bear is
//     leaving and the one it is entering, and a build may strike it via either);
//   * the crossing is still running afterwards, so the removal is not a new crossing
//     taking the bear off the board, which specs/hunter.md also does.
//
// PROVEN AGAINST MUTANTS of the reference implementation, in both directions:
// the reset rule deleted fails on the rule's own assertion; the bear removed
// unconditionally fails on the parked-car guard; and the rule narrowed to only the tile
// the bear stands on — a conformant reading — still passes. Re-run all three if this
// staging is ever changed.

import {
  clearIce,
  startCrossing,
  ROW_MEDIAN,
  ROW_NEAR,
  TILE,
} from "../_helpers.mjs";

// The lane the collision is staged in — row 13 is a two-tile dogsled
// (specs/hazards.md) — and the tile the bear is held on.
const LANE_ROW = 13;
const BEAR_COL = 20;

// The critter, parked out of the way on the near shore. With the pursuit suspended it has
// no part in the staging; it is here only so the crossing is live.
const CRITTER_COL = 6;

// The car: six tiles up the lane, so its run at the bear is half a second of visible
// sweep. `setLaneMotion` takes tiles/second; row 13's own speed is 2.5, and this is faster
// so the collision is decided promptly once released.
const CAR_COL = BEAR_COL + 6;
const CAR_SPEED = 12;

// How long the scene is held with the car parked, before it is released. Long enough that
// a bear which is going to vanish on its own has plainly had the chance to.
const PARKED_TICKS = 60; // 0.5 s

// The lives the crossing holds throughout, so "the crossing did not end" is a decrement
// check rather than an absolute.
const LIVES = 3;

/**
 * Whether any vehicle in `items` had reached the bear, whose sprite's left edge was at
 * `bearX`.
 *
 * THE WINDOW IS THE BEAR'S TILE PLUS ONE EITHER SIDE, because that is the rule
 * specs/hunter.md states: a bear "occupies both the tile it is leaving and the tile it is
 * entering", and a vehicle sliding into EITHER knocks it out. Builds legitimately differ
 * over which triggers first, so a narrower window would call conformant ones
 * unattributable. EVERY item, not the first: a lane respawns its traffic at the far edge
 * (specs/hazards.md) so `items[0]` may be a newcomer rather than the car that did the work.
 * This stays a real guard — it reads the CAR's lane only, and the parked-scene assertions
 * above it rule out a removal that happened before the car ever moved.
 */
function laneReaches(items, bearX) {
  return (items || []).some(
    (v) => v.x < bearX + 2 * TILE && bearX - TILE < v.x + v.len * TILE,
  );
}

export default function item() {
  // Where the bear was put, what it looked like after the parked hold, the two sweeps, and
  // the lane at the instant it went.
  let posed;
  let parked;
  let lastSeen;
  let laneAtRemoval;
  let r;
  let r2;

  return {
    id: "hunter.reset-on-hit",

    // Pose the collision with nothing yet in motion: an empty road, the pursuit suspended,
    // the bear on its tile, the critter out of the way, and the car parked up the lane.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setBearAI", false); // the bear holds the tile it is put on
      await clearIce(api); // nothing on the road but the car parked below
      await api.call("placeCritter", CRITTER_COL, ROW_NEAR);
      await api.call("setBear", 0, { col: BEAR_COL, row: LANE_ROW });
      await api.call("setLane", LANE_ROW, {
        cols: [CAR_COL],
        speed: 0,
        dir: -1,
      }); // laid out, not yet moving
      posed = (await api.snapshot()).bears[0];
    },

    // Hold on the parked scene, release the car into the bear, and watch the reset and the
    // return — the whole item, and exactly what the clip should show.
    async act(api) {
      await api.advance(PARKED_TICKS);
      parked = (await api.snapshot()).bears[0];

      await api.call("setLaneMotion", LANE_ROW, { speed: CAR_SPEED });

      // Sweep for the removal, keeping the last living sight of the bear and the state of
      // the lane on the tick it went. The predicate is evaluated once per sample (see
      // `until` in packages/browser-driver/validation.mjs), so hanging this on it reads
      // each sample exactly once.
      r = await api.until(
        (s) => {
          const bear = s.bears[0];
          if (bear.present) {
            lastSeen = bear;
            return false;
          }
          const lane = (s.lanes.ice || []).find((l) => l.row === LANE_ROW);
          laneAtRemoval = lane ? lane.items : [];
          return true;
        },
        { max: 180 }, // 1.5 s
      );

      // Advance the critter before waiting for the return. specs/hunter.md re-emerges the
      // bear "only after the new critter has again advanced a few tiles forward" and pins
      // no distance, so a critter left on the near shore might legitimately never bring it
      // back — which would read as "the hunt is gone for good" against a build following
      // the rule. A control op, as in `fair-reset-death`, never a reset, which would freeze
      // the recording.
      await api.call("placeCritter", BEAR_COL, ROW_MEDIAN);

      // Generous, for the reason in `hunter/emerges.mjs`: specs/hunter.md fixes only that
      // the bear re-emerges "after a short delay" and pins no number, so the window must
      // not encode one build's choice of constant.
      r2 = await api.until((s) => s.bears[0].present, { max: 600, poll: 6 }); // 5 s
    },

    async assert(api, check) {
      check.expectEq(
        "the bear is on the strait once posed",
        posed.present,
        true,
      );

      // The parked scene: half a second with nothing in motion. A bear that is not still
      // here, and exactly here, means the collision below cannot be credited to the car.
      check.expectEq(
        "the bear is still there while the car is parked",
        parked.present,
        true,
      );
      check.expectEq(
        "the suspended pursuit holds the bear on its tile (column)",
        parked.col,
        posed.col,
      );
      check.expectEq(
        "the suspended pursuit holds the bear on its tile (row)",
        parked.row,
        posed.row,
      );

      // The rule.
      check.expectOk(
        "the released car sweeping into the bear resets it (removed)",
        r.hit,
      );
      check.expectEq(
        "the bear is gone after the hit",
        r.snap.bears[0].present,
        false,
      );

      // The attribution, once there is a removal to attribute.
      if (r.hit) {
        check.expectEq(
          "the bear was last seen in the car's lane",
          lastSeen ? lastSeen.row : null,
          LANE_ROW,
        );
        check.expectOk(
          "the car had reached the bear when the bear went",
          laneReaches(laneAtRemoval, lastSeen ? lastSeen.x : Number.NaN),
        );
      }
      check.expectEq(
        "the crossing is still running, so the removal is not a new crossing's",
        r.snap.lives,
        LIVES,
      );

      // The return. Read together with the removal: a bear that was never taken off the
      // board cannot demonstrate coming back, and `r2` would otherwise pass on its first
      // sample simply because the bear had never left.
      check.expectOk(
        "the bear re-emerges (the hunt returns, not permanently gone)",
        r.hit && r2.hit,
      );
    },
  };
}
