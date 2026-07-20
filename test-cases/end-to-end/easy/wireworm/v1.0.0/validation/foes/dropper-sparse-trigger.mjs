// Automated validation for foes.dropper-sparse-trigger: when the lower field runs
// sparse (from level 3) a dropper draws in to reseed it; a dense field draws none.
//
// Both cases set level 3 and pose the lower-field density, then run real time so the
// game's own sparse-field check runs (game.updateFoes). A sparse lower field draws a
// dropper in; a dense one draws none. Nothing fabricates the spawn — the real check
// decides.

import { foesOf, freshBoard, straightWorm, setWorm } from "../_helpers.mjs";

// The dense scenario's dwell: 720 ticks = the old 6 SECONDS. (The old call was
// literally `api.step(6)`, which under the seconds-based contract meant six seconds.
// `advance(6)` would now mean six TICKS — a silent 120x cut that would let a dense
// field "draw no dropper" simply because it was barely given time to.)
const DENSE_DWELL_TICKS = 720;

// The sparse scenario's sweep: the old loop ran 30 iterations of 0.15s, so 18 ticks
// per poll over 540 ticks total. Both convert exactly.
const SPARSE_SWEEP_TICKS = 540;
const SPARSE_SWEEP_POLL = 18;

export default function item() {
  let dense;
  let sparse;

  return {
    id: "foes.dropper-sparse-trigger",

    // The two scenarios are ORDERED dense-first, the reverse of the old script. The
    // old one could run sparse-first only because each scenario got its own
    // `freshBoard` (an `api.reset`), which the runtime forbids inside `act`. Re-posing
    // with control ops instead, `clearField` empties the NODES but leaves the FOES
    // standing — so a dropper drawn in by a sparse field would survive into the dense
    // scenario and fail its "draws no dropper" assertion. Running the scenario that
    // expects NOTHING to happen first makes the pair sound: if it passes, there is no
    // dropper left to leak. Both assertions keep their exact labels and matchers.
    async arrange(api) {
      // Dense lower field: no dropper should draw in.
      await freshBoard(api);
      await api.call("setLevel", 3);
      await api.call("clearField");
      for (let r = 10; r <= 15; r++)
        for (const c of [8, 20]) await api.call("setNode", c, r, 0); // 12 nodes
      await api.call("setCursor", 16, 704); // out of the way
    },

    async act(api) {
      await api.advance(DENSE_DWELL_TICKS);
      dense = await api.snapshot();

      // Sparse lower field: a dropper should draw in. `clearField` empties the 12
      // nodes, which is the whole difference between the two scenarios. The worm is
      // re-posed high on the board as well: `setLevel(3)` spawned one, it has been
      // winding for six seconds, and if it reached the cursor the real loseLife path
      // would clear the foes out from under this scenario's sweep. Posing a live worm
      // (rather than none) keeps the level's worm-active flag satisfied, so nothing
      // trips level-clear mid-sweep.
      await api.call("clearField");
      await setWorm(api, straightWorm(20, 5, 6, 1), 1, 1);
      await api.call("setCursor", 16, 704);
      const r = await api.until((s) => foesOf(s, "dropper").length > 0, {
        max: SPARSE_SWEEP_TICKS,
        poll: SPARSE_SWEEP_POLL,
      });
      sparse = r.snap;
    },

    async assert(api, check) {
      check.expectGt(
        "a sparse lower field draws a dropper in",
        foesOf(sparse, "dropper").length,
        0,
      );
      check.expectEq(
        "a dense lower field draws no dropper",
        foesOf(dense, "dropper").length,
        0,
      );
    },
  };
}
