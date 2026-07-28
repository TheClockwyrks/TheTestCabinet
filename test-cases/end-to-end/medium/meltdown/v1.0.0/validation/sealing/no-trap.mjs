// Automated validation for the Sealing sub-item `no-trap`.
//
// A placement that would leave a unit already walking with no route to its exhaust is
// refused (specs/playfield.md). This is a SEPARATE rule from the never-seal rule that
// `sealing.no-seal` covers, and the scenario has to keep them apart: closing the last
// gap in a wall across the floor is refused by the seal rule whether or not anyone is
// walking, so a check built on that geometry passes on a build with no trap rule at
// all — it is really `no-seal` a second time.
//
// So the trap here strands a unit without sealing anything. A frame of 2x2 Arcs around
// an inner pocket, built with one side left open, is a small block out in the open
// floor: both vents still reach their exhausts around it, so the never-seal rule has
// no objection. With a unit inside the pocket, closing the open side is refused only
// because it would strand that unit.
//
// The same placement is then tried on the same frame with nothing inside it, and must
// be ALLOWED. Without that control the check could pass on a build that refuses the
// placement for some unrelated reason (bad geometry, a mis-sized footprint), which is
// the failure mode the old wall-and-gap scenario actually had.
//
// WHY THE POCKET IS 4x4 AND NOT 2x2. It used to be 2x2 — the smallest thing that can
// hold a unit — and that made the whole item vacuous. The pocket was framed on the
// Mote's own tile, so with a 2x2 inner area the Mote sat one tile from the footprint
// under test, and a build that simply refuses to place a tower on top of a unit
// refused it for THAT reason. The check then read a refusal and passed, on a build
// that need not have had a trap rule at all — the same failure the wall-and-gap
// scenario had, in a new shape. A 4x4 pocket puts four tiles between the Mote and the
// tile being placed, so occupancy cannot explain the refusal and the only rule left
// that can is the one this item is about.

import {
  newGame,
  restartGame,
  build,
  spawn,
  unit,
  actTail,
  COLS,
  ROWS,
} from "../_helpers.mjs";

// The 2x2 footprints that frame a 4x4 pocket whose top-left tile is (c, r), and the
// one footprint left out of them — the open side, and the placement under test.
//
// The ring is laid out in footprint steps of 2 around the inner tiles c..c+3 by
// r..r+3: four across the top, four across the bottom, and two down each side. The
// gap is the UPPER RIGHT side footprint, which is four tiles clear of (c, r) where the
// Mote stands — far enough that nothing about the Mote's own tile can be what refuses
// the placement.
function frameOf(c, r) {
  const walls = [];
  for (const col of [c - 2, c, c + 2, c + 4]) {
    walls.push([col, r - 2]); // the top edge, corners included
    walls.push([col, r + 4]); // the bottom edge, corners included
  }
  for (const row of [r, r + 2]) {
    walls.push([c - 2, row]); // the left edge
    if (row !== r) walls.push([c + 4, row]); // the right edge, minus the gap
  }
  return { walls, gap: [c + 4, r] };
}

async function buildFrame(api, c, r) {
  const { walls, gap } = frameOf(c, r);
  let built = 0;
  for (const [col, row] of walls) {
    if ((await build(api, "arc", col, row)) !== null) built += 1;
  }
  return { built, walls: walls.length, gap };
}

/**
 * Whether an 8x8 frame centred on the pocket at (c, r) fits inside the floor.
 *
 * The frame reaches two tiles out from the pocket on the top and left and six on the
 * bottom and right, so a pocket too near an edge has footprints off the grid, every
 * one of them refused, and the scenario never gets built. That is not a build
 * misbehaving — it is this item failing to find anywhere to put its scenario — so the
 * caller reports it as an unmet precondition rather than a verdict. It comes up on a
 * build whose left-vent units do not travel down the lane: park one against the top
 * edge and there is no room above it for a frame.
 */
function frameFits(c, r) {
  return c - 2 >= 0 && r - 2 >= 0 && c + 6 <= COLS && r + 6 <= ROWS;
}

export default function item() {
  let moteId;
  let pocket;
  let builtAround;
  let canTrap;
  let trapBuilt;
  let builtEmpty;
  let canEmpty;

  return {
    id: "sealing.no-trap",

    // The frame, the refusal and the empty-floor control are all control ops, so the
    // whole comparison resolves inside a couple of frames unless the drive is paced.
    // Filmed at that speed it reads as a box flickering into existence around a Mote
    // and nothing else — which is what makes the clip unreviewable rather than merely
    // brisk. The beats in `act` hold on each RESOLVED state long enough to be read
    // (never between a pose and the read that depends on it — see the note by the
    // trap placement), and this budget covers them.
    clipMs: 12000,

    // A real Mote released onto the open floor, with nothing built yet, walked clear
    // of the vent so a frame will fit around it. The walk is run through unfilmed —
    // it is how the scenario gets built, not any part of what it shows. 720 ticks =
    // the old 12s cap, kept as the skip's ceiling.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      moteId = await spawn(api, "mote", "left");
      await api.skipUntil(
        (s) => s.surge.some((u) => u.id === moteId && u.x > 200),
        {
          max: 720,
          poll: 12,
        },
      );
    },

    // Frame the Mote in with one side open and try to close that side.
    async act(api) {
      const u = await unit(api, moteId);
      if (u && !frameFits(u.col, u.row)) {
        const err = new Error(
          `no room for a trap frame around the Mote at (${u.col}, ${u.row})`,
        );
        err.ttcPreconditionUnmet = true;
        throw err;
      }
      // Frame the pocket on the Mote's own tile; control ops consume no time, so it
      // is exactly where this read left it while the frame goes up.
      pocket = u ? { c: u.col, r: u.row } : null;
      if (pocket) {
        const around = await buildFrame(api, pocket.c, pocket.r);
        builtAround = around.built === around.walls;
        // NOTHING may consume time between framing the pocket and testing the
        // placement. The frame is deliberately left open on one side, so the Mote
        // inside it is not contained — give it so much as a beat and it walks out
        // through the gap, and then closing that gap strands nobody and is correctly
        // ALLOWED. A 1.5 s hold here did exactly that and turned a passing reference
        // build into a failure. The pose and the reads that depend on it stay
        // instantaneous; the clip gets its beat below, once the verdict is in.
        canTrap = await api.call(
          "canPlace",
          "arc",
          around.gap[0],
          around.gap[1],
          0,
        );
        // Then actually TRY it. `canPlace` is a query and paints nothing, so on its
        // own the refusal is invisible — the clip would cut from an open frame to a
        // fresh floor with no sign that anything was attempted. Driving the real
        // placement shows the refusal happening (the side stays open), and it also
        // widens the check: a build whose `canPlace` answers correctly while its
        // placement path traps the Mote anyway is caught here rather than passing.
        trapBuilt = await build(api, "arc", around.gap[0], around.gap[1]);
        // Now the beat. It shows the gap still open after the refusal — and then the
        // Mote walking out through it, which is the premise the rule rests on made
        // visible: that side really was this unit's only way out.
        await actTail(api, 150);
      }

      // The same frame, on the same tiles, with nothing inside it.
      await restartGame(api, "containment", "medium", 100000);
      if (pocket) {
        const empty = await buildFrame(api, pocket.c, pocket.r);
        builtEmpty = empty.built === empty.walls;
        await actTail(api); // hold on the identical frame, this time empty

        canEmpty = await api.call(
          "canPlace",
          "arc",
          empty.gap[0],
          empty.gap[1],
          0,
        );
        await build(api, "arc", empty.gap[0], empty.gap[1]);
        await actTail(api); // hold on the same side closing, with nobody inside
      }
    },

    async assert(api, check) {
      // Hard: with no pocket there is no scenario, and the reads below are undefined.
      check.assertOk(
        "the Mote walked out onto the open floor",
        pocket !== null,
      );
      check.expectOk("the frame went up around the walking Mote", builtAround);
      check.expectOk("the same frame went up on an empty floor", builtEmpty);
      check.expectEq(
        "closing the pocket on the walking unit is refused",
        canTrap,
        false,
      );
      check.expectEq(
        "and the real placement builds nothing there either",
        trapBuilt,
        null,
      );
      check.expectEq(
        "the identical placement is allowed with nobody inside",
        canEmpty,
        true,
      );
    },
  };
}
