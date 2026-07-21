// scoring.descend-on-clear: clearing every plankton descends to a deeper trench.
//
// Posing the last plankton is instant (`arrange`); eating it and then letting the cleared
// interstitial run out into the next trench is the real sim, so it is `act` — and that
// descent is what the clip shows.
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
  let depthBefore;
  let dir;
  let clearedScreen;
  let after;

  return {
    id: "scoring.descend-on-clear",

    async arrange(api) {
      const snap = await startPlaying(api);
      depthBefore = snap.depth;
      await api.call("poseLastPlankton");
      const f = (await api.snapshot()).forager;
      dir = planktonDir(snap, f);
    },

    async act(api) {
      if (!dir) return;
      await api.call("keyDown", DIR_KEY[dir]);
      // Eat it (into the cleared interstitial). The old loop ran up to 60 passes of
      // step(0.02); 0.02 s is 2.4 ticks, which the contract refuses to round, so the fine
      // sampling cadence becomes 2 ticks and the 1 s cap is ample for an adjacent tile.
      const r = await api.until((s) => s.screen !== "playing", {
        max: 120,
        poll: 2,
      });
      await api.call("keyUp", DIR_KEY[dir]);
      clearedScreen = r.snap.screen;
      await api.advance(240); // 240 ticks = the old 2.0 s: past the cleared interstitial → descend
      after = await api.snapshot();
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectOk("a reachable last plankton was posed", dir !== null);
      if (!dir) return;
      check.expectEq("the trench is cleared", clearedScreen, "cleared");
      check.expectEq(
        "clearing descends to a deeper trench",
        after.depth,
        depthBefore + 1,
      );
    },
  };
}
