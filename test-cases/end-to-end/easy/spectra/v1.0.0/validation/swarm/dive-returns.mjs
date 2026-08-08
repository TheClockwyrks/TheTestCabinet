// Automated validation for the Swarm sub-item `dive-returns`.
//
// A drone that survives its dive returns to its formation slot (phase returning, then
// formation back at its slot) rather than vanishing — and it gets there by FLYING:
// down the field at the dive speed, and back by a continuous path rather than a jump.
// A formation drone is posed, a REAL dive launched, and the whole round trip sampled
// tick by tick, so the assertions read the path the drone actually travelled.
//
// The two things read off that path, beyond the round trip itself:
//
//   * Travel speed. `specs/drones.md` puts the dive at "about `300 px/s`" at stage 1.
//     Only the diving phase is timed: the spec fixes the speed of the attack run and
//     says nothing about how briskly a drone flies home, so timing the whole trip
//     would pin a number the spec leaves open.
//   * Continuity. The path "never teleports" and is "continuous through this wrap"
//     (`specs/drones.md`, `specs/playfield.md`), so a round trip may contain at most
//     ONE discontinuity, and that one has to be a real wrap: the drone below the play
//     field on one side of it and above the field on the other, in the same column.
//
// Note what is deliberately NOT asserted: that the drone stays above the player. The
// spec gives a dive two legal endings — loop back up before `y = 656`, or exit
// through the bottom and re-appear from the top — so a dive passing below the ship's
// lane is a conformant dive mid-wrap, not a fault. What separates that from a
// teleport is whether the crossing is a single wrap at the field's edges, which is
// what the continuity check asks.

import {
  startClean,
  protectShip,
  spawnDrone,
  findDrone,
  DIVE_SPEED,
  PLAY_TOP,
  PLAY_BOTTOM,
} from "../_helpers.mjs";

// The band the diver carries. The ship is tuned to the SAME band, so the shots the
// diver fires on its way down are absorbed by the shield rather than costing a life
// (`specs/polarity.md`) — this item is about the round trip, and a diver that kills
// the driver's ship part-way through it is measuring the wrong thing. Combined with
// `protectShip`, a hit cannot end the run either. See `protectShip`.
const DIVER_BAND = "cyan";

const ARM_TICKS = 6; // 6 ticks = the old 0.05 s to arm the dive systems

// Sample every 2 ticks for the whole round trip, and cap it at 12 s — the old script
// allowed 6 s for each leg separately, and this is the same budget for both.
const POLL_TICKS = 2;
const TRIP_MAX_TICKS = 1440;

// A step longer than this is a jump, not travel. Two ticks at the stage-1 dive speed
// is 5 px, and even a build running its dives at several times that stays far below
// 40 px — while the wrap this is meant to find is most of the field's height.
const TELEPORT_PX = 40;

// How far a wrap may shift the drone sideways. Re-appearing from the top continues
// the same descent, so the column is essentially kept; this allows a couple of drone
// widths of drift rather than demanding the pixel.
const WRAP_X_TOL = 80;

// How far either side of the play field's edges a wrap's endpoints may be read.
//
// The wrap is recognized from two SAMPLES taken `POLL_TICKS` apart, not from the
// instant the build performs it, so neither endpoint lands exactly on an edge: the
// last sample before the wrap catches the drone somewhere below the field, and the
// first one after it catches the drone wherever the build re-entered. Demanding
// `y > 656` before and `y < 64` after therefore failed conformant builds on a
// technicality — one re-appeared at `y = 65`, a single pixel inside the play
// field's top edge, and was read as a teleport.
//
// 40 px is loose enough to absorb both the sampling gap and a build's choice of
// re-entry line, and far too tight to admit what this is actually separating a wrap
// from: a drone that gives up mid-field and jumps home to its slot, which sits at
// `y` 120–320 (`specs/playfield.md`) — hundreds of px inside either bound.
const WRAP_Y_TOL = 40;

// The spec says "about 300 px/s" and fixes no tolerance, so this band is wide on
// purpose: half speed to half again, which still separates a swooping attack run
// from a drone that crawls or that drops through the field in a blink.
const SPEED_TOL = DIVE_SPEED * 0.5;

/**
 * Sample the drone's whole round trip, every `POLL_TICKS`, until it re-settles into
 * formation (or the budget runs out). Returns the samples in order.
 *
 * The sweep stops at the FIRST return to formation after the drone has left it — it
 * does not wait to have seen the `returning` phase first. Those are two separate
 * claims, and the assertions below report them separately; tying the stop condition
 * to one of them made a build that fails it fail the other as collateral. A build
 * that flies the whole loop reporting `diving` throughout never satisfied
 * `seenReturning`, so the sweep ran on past the drone re-settling and into its NEXT
 * dive, and the "re-settles into formation" assertion read `diving` — reporting
 * that the drone never came home when in fact it had come home and gone out again.
 * Stopping on the first settle keeps that assertion about the round trip it was
 * meant to measure, and leaves the missing `returning` phase to be reported on its
 * own.
 */
async function sweepTrip(api, id) {
  const path = [];
  let leftFormation = false;
  for (let spent = 0; spent < TRIP_MAX_TICKS; spent += POLL_TICKS) {
    await api.advance(POLL_TICKS);
    const d = findDrone(await api.snapshot(), id);
    if (!d) break; // the drone is gone; the assertions below report it
    path.push({
      x: d.x,
      y: d.y,
      phase: d.phase,
      slotX: d.slotX,
      slotY: d.slotY,
    });
    if (d.phase !== "formation") leftFormation = true;
    if (leftFormation && d.phase === "formation") break;
  }
  return path;
}

export default function item() {
  // The drone and the path it flew.
  let droneId;
  let path = [];

  return {
    id: "swarm.dive-returns",

    // One drone on an empty field, so the drone that loops back can only be this one
    // and its slot is unambiguous.
    async arrange(api) {
      await startClean(api);
      await protectShip(api);
      // Shielded against this diver's own fire, so the round trip is never cut
      // short by the ship taking a hit (see `DIVER_BAND`).
      await api.call("setShipBand", DIVER_BAND);
      droneId = await spawnDrone(api, {
        kind: "shard",
        band: DIVER_BAND,
        x: 640,
        y: 200,
        phase: "formation",
      });
    },

    // The whole round trip — dive out, come back, re-settle — which is both what the
    // assertions read and precisely what the reviewer has to watch to judge it.
    async act(api) {
      await api.advance(ARM_TICKS);
      await api.call("forceDive", droneId);
      path = await sweepTrip(api, droneId);
    },

    async assert(api, check) {
      check.expectOk(
        "the diver enters the returning phase",
        path.some((p) => p.phase === "returning"),
      );

      const last = path[path.length - 1];
      check.expectEq(
        "the diver re-settles into formation",
        last?.phase ?? "gone",
        "formation",
      );
      if (last?.phase === "formation") {
        check.expectClose("it returns to its slot y", last.y, last.slotY, 1);
      }

      // Travel speed over the diving phase only: the arc length flown between
      // consecutive diving samples, over the time those samples span.
      let diveLen = 0;
      let diveTicks = 0;
      const jumps = [];
      for (let i = 1; i < path.length; i += 1) {
        const a = path[i - 1];
        const b = path[i];
        const step = Math.hypot(b.x - a.x, b.y - a.y);
        if (a.phase === "diving" && b.phase === "diving") {
          diveLen += step;
          diveTicks += POLL_TICKS;
        }
        if (step > TELEPORT_PX) jumps.push({ a, b });
      }

      check.expectGt("the dive is long enough to time", diveTicks, 0);
      if (diveTicks > 0) {
        check.expectClose(
          "the dive travels at about the dive speed",
          diveLen / (diveTicks / 120),
          DIVE_SPEED,
          SPEED_TOL,
        );
      }

      // At most one discontinuity in the whole round trip, and it must be a wrap:
      // below the play field before, above it after, same column. A drone that
      // jumps home from mid-field, or re-appears in a different column, fails here
      // — and a drone that flies its loop back in one piece has no jumps at all.
      check.expectLe(
        "the round trip has at most one wrap in it",
        jumps.length,
        1,
      );
      if (jumps.length === 1) {
        const { a, b } = jumps[0];
        check.expectOk(
          "the only discontinuity is a bottom-to-top wrap in the same column",
          a.y > PLAY_BOTTOM - WRAP_Y_TOL &&
            b.y < PLAY_TOP + WRAP_Y_TOL &&
            Math.abs(b.x - a.x) <= WRAP_X_TOL,
        );
      }
    },
  };
}
