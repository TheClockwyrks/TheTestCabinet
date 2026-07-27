// Automated validation for the Sealing sub-item `no-trap`.
//
// A placement that would leave a unit already walking with no route to its exhaust is
// refused (specs/playfield.md). This is a SEPARATE rule from the never-seal rule that
// `sealing.no-seal` covers, and the scenario has to keep them apart: closing the last
// gap in a wall across the floor is refused by the seal rule whether or not anyone is
// walking, so a check built on that geometry passes on a build with no trap rule at
// all — it is really `no-seal` a second time.
//
// So the trap here strands a unit without sealing anything. A frame of eight 2x2 Arcs
// around a 2x2 pocket, built with one side left open, is a small block out in the open
// floor: both vents still reach their exhausts around it, so the never-seal rule has
// no objection. With a unit inside the pocket, closing the open side is refused only
// because it would strand that unit.
//
// The same placement is then tried on the same frame with nothing inside it, and must
// be ALLOWED. Without that control the check could pass on a build that refuses the
// placement for some unrelated reason (bad geometry, a mis-sized footprint), which is
// the failure mode the old wall-and-gap scenario actually had.

import { newGame, restartGame, build, spawn, unit } from "../_helpers.mjs";

// The eight 2x2 footprints that frame the 2x2 pocket whose top-left tile is (c, r).
// The last entry is the open side — the placement under test.
function frameOf(c, r) {
  return {
    walls: [
      [c - 2, r - 2],
      [c, r - 2],
      [c + 2, r - 2],
      [c - 2, r],
      [c - 2, r + 2],
      [c, r + 2],
      [c + 2, r + 2],
    ],
    gap: [c + 2, r],
  };
}

async function buildFrame(api, c, r) {
  const { walls, gap } = frameOf(c, r);
  let built = 0;
  for (const [col, row] of walls) {
    if ((await build(api, "arc", col, row)) !== null) built += 1;
  }
  return { built, walls: walls.length, gap };
}

export default function item() {
  let moteId;
  let pocket;
  let builtAround;
  let canTrap;
  let builtEmpty;
  let canEmpty;

  return {
    id: "sealing.no-trap",

    // A real Mote released onto the open floor, with nothing built yet.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      moteId = await spawn(api, "mote", "left");
    },

    // Let the Mote walk clear of the vent so a frame fits around it, then frame it in
    // with one side open and try to close that side. 720 ticks = the old 12s cap,
    // polled every 6 ticks (the old 0.1s chunk).
    async act(api) {
      await api.until(
        (s) => s.surge.some((u) => u.id === moteId && u.x > 200),
        {
          max: 720,
          poll: 6,
        },
      );
      const u = await unit(api, moteId);
      // Frame the pocket on the Mote's own tile; control ops consume no time, so it
      // is exactly where this read left it while the frame goes up.
      pocket = u ? { c: u.col, r: u.row } : null;
      if (pocket) {
        const around = await buildFrame(api, pocket.c, pocket.r);
        builtAround = around.built === around.walls;
        canTrap = await api.call(
          "canPlace",
          "arc",
          around.gap[0],
          around.gap[1],
          0,
        );
      }

      // The same frame, on the same tiles, with nothing inside it.
      await restartGame(api, "containment", "medium", 100000);
      if (pocket) {
        const empty = await buildFrame(api, pocket.c, pocket.r);
        builtEmpty = empty.built === empty.walls;
        canEmpty = await api.call(
          "canPlace",
          "arc",
          empty.gap[0],
          empty.gap[1],
          0,
        );
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
        "the identical placement is allowed with nobody inside",
        canEmpty,
        true,
      );
    },
  };
}
