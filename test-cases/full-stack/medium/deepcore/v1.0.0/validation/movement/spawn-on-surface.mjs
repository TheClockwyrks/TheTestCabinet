// Automated validation for movement.spawn-on-surface.
//
// A new expedition begins ON THE SURFACE. `Row 0` is the surface camp, "where the miner spawns and
// returns to between digs" (specs/world.md), and `specs/gameplay.md` opens the loop with "the miner
// starts on the surface": the first thing a player does is walk the camp and choose where to dig,
// not climb out of a hole. So a fresh start must leave the miner standing on the camp floor at
// depth 0, with the unmined mine below it — never already inside a shaft, a cavern, or any other
// opening under the surface.
//
// The defect this catches is a start that begins the player somewhere in the mine: a spawn placed
// down a pre-carved shaft, a camp cut into the terrain, or a generated tunnel opening right under
// the spawn column so the miner falls in the moment the game starts. Each of those still shows a
// miner on screen, and every other movement item — which teleports the miner where it needs it —
// happily passes anyway, because none of them ever looks at where a run actually begins.
//
// Nothing is posed: the mine, the camp, and the spawn are the build's own, and the check reads
// where the miner is and what is under it. Three SEEDS are started rather than one because the
// mine is generated per game (specs/world.md); a starting hole that only opens under some seeds is
// still a run that begins by falling down it.

import { newRun } from "../_helpers.mjs";

/** Fresh expeditions to start, each generating its own mine. */
const SEEDS = [1, 7, 23];

/** Rows under the spawn column that must be unmined ground: the shallow topsoil right under the
 *  cave mouth (specs/world.md), which a start inside a shaft would have opened. */
const UNDER_ROWS = [1, 2, 3];

/** Ticks to hold with NOTHING pressed. 60 ticks = 1 s — long enough that a miner spawned over an
 *  opening is several tiles down it (gravity is 1500 px/s^2, specs/character.md) rather than only
 *  a few pixels into a fall the snapshot might round away. */
const SETTLE = 60;

export default function item() {
  const starts = [];
  let first;

  return {
    id: "movement.spawn-on-surface",

    // Start the first expedition here, so the clip opens on a fresh camp rather than mid-reset.
    async arrange(api) {
      first = await newRun(api, { seed: SEEDS[0] });
    },

    // Each fresh start, left alone for a second: the behavior is where the game puts the miner and
    // that it stays put, and the clip shows the camp it starts in.
    async act(api) {
      for (const seed of SEEDS) {
        const spawn = seed === SEEDS[0] ? first : await newRun(api, { seed });
        await api.advance(SETTLE); // no keys held: whatever happens is the build's own doing
        const after = await api.snapshot();
        const under = [];
        for (const r of UNDER_ROWS) {
          under.push(await api.call("tileAt", spawn.miner.col, r));
        }
        starts.push({ seed, spawn, after, under });
      }
    },

    async assert(api, check) {
      for (const { seed, spawn, after, under } of starts) {
        const at = (what) => `seed ${seed}: ${what}`;

        check.expectEq(at("the expedition started"), spawn.screen, "in-mine");

        // At the surface, not down in the mine. Depth is `5 m` per row below the surface
        // (specs/world.md), so a start on the camp floor reads 0 — the allowance is one row, which
        // covers a build reporting depth from the miner's feet rather than the cell it occupies,
        // and still fails any start that begins even two rows down a shaft.
        check.expectLt(
          at("the miner starts at the surface"),
          spawn.depthMeters,
          10,
        );

        // The mine directly below the start is untouched ground. An opening here is exactly the
        // shaft-you-begin-inside defect: the miner cannot be standing on the camp floor if the
        // floor under it is open space.
        under.forEach((t, i) => {
          check.expectNe(
            at(`the ground under the start is unmined at row ${UNDER_ROWS[i]}`),
            t ? t.kind : null,
            "tunnel",
          );
        });

        // And it stays there. A second of gravity with nothing held sends a miner spawned over an
        // opening down into it, so holding position IS the evidence that the start is on solid
        // camp ground.
        check.expectOk(
          at("the miner is standing on the surface"),
          after.miner.grounded,
        );
        check.expectLt(
          at("the miner is at rest, not falling"),
          after.miner.vy,
          50,
        );
        check.expectLe(
          at("the miner did not sink out of the camp"),
          after.miner.row,
          spawn.miner.row,
        );
        check.expectLt(
          at("the run never descended into the mine"),
          after.deepestDepthMeters,
          10,
        );
      }
    },
  };
}
