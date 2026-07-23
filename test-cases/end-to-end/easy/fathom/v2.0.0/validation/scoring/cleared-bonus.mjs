// scoring.cleared-bonus: eating the last plankton clears the maze for a 500 bonus.
//
// Posing the single remaining plankton next to the forager is instant (`arrange`);
// swimming onto it is the real sim, so it is `act` — the clip is the last pellet being
// taken and the maze clearing.
import {
  startPlaying,
  stepTile,
  isOpen,
  wrapRow,
  DIR_KEY,
  SCORE_CLEAR,
} from "../_helpers.mjs";

// The neighbor debugPoseLastPlankton places the single remaining plankton on: the
// first open, non-wrap neighbor in the order up, down, left, right.
function planktonDir(snap, f) {
  const wr = wrapRow(snap);
  for (const d of ["up", "down", "left", "right"]) {
    const [nc, nr] = stepTile(snap, f.tx, f.ty, d);
    const isWrap = nr === wr && (nc === 0 || nc === snap.grid.cols - 1);
    if (isOpen(snap.tiles, nc, nr) && !isWrap) return d;
  }
  return null;
}

export default function item() {
  let dir;
  let before;
  let r;

  return {
    id: "scoring.cleared-bonus",

    async arrange(api) {
      const snap = await startPlaying(api);
      await api.call("poseLastPlankton");
      const f = (await api.snapshot()).forager;
      dir = planktonDir(snap, f);
    },

    async act(api) {
      if (!dir) return;
      before = (await api.snapshot()).score;
      await api.call("keyDown", DIR_KEY[dir]);
      // The old loop ran up to 60 passes of step(0.02) until the screen left "playing".
      // 0.02 s is 2.4 ticks, which the contract refuses to round; 2 ticks keeps the fine
      // sampling cadence that pins down the exact moment the maze clears, and 120 ticks
      // (1 s) is far more than the ~0.25 s the forager needs to reach an adjacent tile.
      r = await api.until((s) => s.screen !== "playing", { max: 120, poll: 2 });
      await api.call("keyUp", DIR_KEY[dir]);
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectOk("a reachable last plankton was posed", dir !== null);
      if (!dir) return;
      check.expectEq(
        "eating the last plankton clears the maze",
        r.snap.screen,
        "cleared",
      );
      check.expectGe(
        "clearing awards the 500 bonus",
        r.snap.score - before,
        SCORE_CLEAR,
      );
    },
  };
}
