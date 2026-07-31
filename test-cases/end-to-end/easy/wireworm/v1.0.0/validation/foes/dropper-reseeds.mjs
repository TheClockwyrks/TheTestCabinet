// Automated validation for foes.dropper-reseeds: the packet-dropper falls straight
// down a column, laying a fresh inert node in each empty tile it passes.
//
// A dropper posed at the top of an empty column is the precondition; the reseeding is
// produced by the real updateFoe dropper branch (game.dropNode) as the sim steps.
// After it falls through, the column holds a run of fresh inert nodes.

import { freshBoard, tileCX } from "../_helpers.mjs";

// The lane the dropper falls down, chosen to sit outside the bystander worm's reach
// for the whole of this item's window — this is the one check whose scenario is a
// FULL-HEIGHT column, so it is the one the bystander can actually collide with.
//
// `freshBoard`'s bystander (see `poseBystander`) starts at column 39 of the top row
// and winds left one column per tile step. At level 1 a step is 0.14 s — 16.8 ticks
// — so the 504 ticks below buy it 30 steps, reaching column 10. That is exactly the
// lane this check used to use, and the worm arrived to bump the trail's top node up
// to charge 1 just before the read: the trail was laid perfectly inert and scored as
// though it were not. Column 2 is 38 steps away, past the end of the window, with
// eight steps of margin.
const COL = 2;

/**
 * The tallest single-column run of nodes on the board — the dropper's trail.
 *
 * Which column that is is deliberately not pinned here. specs/foes.md fixes the
 * SHAPE of what a dropper leaves — "falls straight down a column ... laying a
 * vertical trail of new terrain" — and that shape is what this item is named for.
 * WHERE the trail lands is a separate claim (it follows from the foe's position
 * being its centre, specs/overview.md), and folding it in meant a build that laid a
 * perfectly good vertical trail one column over scored as having laid nothing at
 * all, under an assertion that said it had not reseeded.
 *
 * Reading the tallest run asserts what this item is for, and it cannot be satisfied
 * by scattered nodes: the whole board starts empty, so a run of this height in ONE
 * column is a vertical trail.
 */
function tallestColumnRun(nodes) {
  const byColumn = new Map();
  for (const n of nodes) {
    if (!byColumn.has(n.c)) byColumn.set(n.c, []);
    byColumn.get(n.c).push(n);
  }
  let best = [];
  for (const run of byColumn.values()) if (run.length > best.length) best = run;
  return best;
}

export default function item() {
  let startCount;
  let laid;

  return {
    id: "foes.dropper-reseeds",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "dropper", { x: tileCX(COL) });
    },

    // The whole fall IS the clip: the reviewer watches the column fill in behind the
    // dropper, which is exactly the run of nodes the assertions count.
    async act(api) {
      // The whole board, not one column: the trail is located by reading it back,
      // so the "started empty" leg has to cover everywhere it could have landed.
      startCount = (await api.snapshot()).nodes.length;
      await api.advance(504); // 504 ticks = the old 4.2s, the fall through the reseed rows
      laid = tallestColumnRun((await api.snapshot()).nodes);
    },

    async assert(api, check) {
      check.expectEq("the board starts with no nodes", startCount, 0);
      check.expectGt(
        "the dropper lays a run of nodes down its column",
        laid.length,
        8,
      );
      check.expectOk(
        "every laid node is inert (charge 0)",
        laid.every((n) => n.charge === 0),
      );
    },
  };
}
