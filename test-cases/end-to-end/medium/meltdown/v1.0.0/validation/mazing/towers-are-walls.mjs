// Automated validation for the Mazing sub-item `towers-are-walls`.
//
// Every tower is also a wall: placing towers across the direct route forces the
// surge to path the long way around (specs/playfield.md). We read the left vent's
// shortest route to its exhaust before and after building a structure across the
// floor — it lengthens.
//
// The wall has to be a real detour, not merely an obstacle. Movement is on the tile
// grid but "a unit may step to an orthogonally or DIAGONALLY adjacent open tile"
// (specs/playfield.md), and `paths.left.length` counts TILES. A single straight wall
// mid-field therefore costs the surge nothing measurable: it steps around the wall
// diagonally, spending its vertical detour on steps that also carry it toward the
// exhaust, so the route stays exactly the open floor's 50 and a `> before` assertion
// fails a perfectly conformant build. What lengthens a diagonal route is being forced
// to travel vertically with no horizontal progress available — a narrow corridor. So
// the wall here is a pair of offset walls whose openings sit at opposite ends: the
// surge must drop to the bottom to pass the first, climb to the top to pass the
// second, and come back down for the exhaust, through columns only four tiles wide.

import { newGame, build, spawn } from "../_helpers.mjs";

// The two walls, as the top-left rows of the 2x2 Arcs making up each column pair.
// Wall A (cols 20-21) is closed from the top down through row 25 and open below it;
// wall B (cols 24-25) is closed from row 10 down through the bottom, open above it.
const WALL_A_ROWS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const WALL_B_ROWS = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34];

export default function item() {
  let before;
  let after;
  let built = 0;

  return {
    id: "mazing.towers-are-walls",

    // Long enough to film a Mote actually walking the detour: it leaves the straight
    // lane around 240 ticks in and is well down the corridor by 450 (7.5 s), which
    // does not fit the 8 s default once the round trips are counted.
    clipMs: 12000,

    // The baseline route, the wall, and the route it forces — all of it posed here.
    //
    // The wall used to go up in `act`, which meant the clip opened on a bare floor and
    // spent its first moments watching twelve Arcs appear one after another. That is
    // the scenario being ASSEMBLED, not the finding: what this item claims is that a
    // route around towers is longer than the route without them, and the evidence for
    // it is the two path lengths and the detour a Mote then walks. Both readings are
    // instant snapshot reads and every placement is a control op, so the whole
    // comparison belongs in `arrange` — and the clip now opens on a floor that already
    // has its wall, exactly as the reference does.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      before = (await api.snapshot()).paths.left.length;

      for (const row of WALL_A_ROWS) {
        if ((await build(api, "arc", 20, row)) !== null) built += 1;
      }
      for (const row of WALL_B_ROWS) {
        if ((await build(api, "arc", 24, row)) !== null) built += 1;
      }
      after = (await api.snapshot()).paths.left.length;
    },

    // Release two Motes so the clip shows what the lengthened route means in practice:
    // units routing the long way around a wall that was already standing when the
    // recording began.
    async act(api) {
      await spawn(api, "mote", "left");
      await spawn(api, "mote", "left");
      await api.advance(450);
    },

    async assert(api, check) {
      // The whole wall has to exist for the route reading to mean anything: `build`
      // returns null on a refused placement, so a partly-built wall would otherwise
      // read as "towers do not lengthen routes".
      check.expectEq(
        "the whole wall was built",
        built,
        WALL_A_ROWS.length + WALL_B_ROWS.length,
      );
      check.expectGt(
        "a wall across the lane lengthens the left vent's route",
        after,
        before,
      );
    },
  };
}
