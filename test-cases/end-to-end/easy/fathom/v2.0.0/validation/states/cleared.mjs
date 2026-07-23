// states.cleared: clearing a maze shows the cleared interstitial.
//
// Posing the last plankton is instant (`arrange`); swimming onto it is the real sim, so
// it is `act`, and the capture at the end is the interstitial itself.
import {
  startPlaying,
  stepTile,
  isOpen,
  wrapRow,
  DIR_KEY,
} from "../_helpers.mjs";

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
  let screen;

  return {
    id: "states.cleared",

    async arrange(api) {
      const snap = await startPlaying(api);
      await api.call("poseLastPlankton");
      const f = (await api.snapshot()).forager;
      dir = planktonDir(snap, f);
    },

    async act(api) {
      if (!dir) return;
      await api.call("keyDown", DIR_KEY[dir]);
      // The old loop ran up to 60 passes of step(0.02) until the screen left "playing".
      // 0.02 s is 2.4 ticks, which the contract refuses to round; 2 ticks keeps the fine
      // cadence, and 120 ticks (1 s) is ample for the adjacent tile.
      const r = await api.until((s) => s.screen !== "playing", {
        max: 120,
        poll: 2,
      });
      await api.call("keyUp", DIR_KEY[dir]);
      screen = r.snap.screen;
      await api.settle(150); // a REAL pause (the old wait(150)) so the interstitial is painted
      await api.screenshot("cleared");
    },

    async assert(api, check) {
      check.expectOk("a reachable last plankton was posed", dir !== null);
      if (!dir) return;
      check.expectEq(
        "clearing a maze shows the cleared screen",
        screen,
        "cleared",
      );
    },
  };
}
