// scoring.descend-on-clear: clearing every plankton descends to a deeper maze.
//
// Posing the last plankton is instant (`arrange`); eating it and then letting the cleared
// interstitial run out into the next maze is the real sim, so it is `act` — and that
// descent is what the clip shows. The interstitial's length is the build's own (see the
// sweep in `act`), so the descent is waited FOR, never assumed to land by a fixed tick.
//
// Which neighbor `poseLastPlankton` chose is the build's own call and is not reported by
// `snapshot`, so `actEatLastPlankton` tries each open neighbor rather than assuming one
// (see its note in ../_helpers.mjs).
import { startPlaying, actEatLastPlankton } from "../_helpers.mjs";

export default function item() {
  let depthBefore;
  let clearedScreen;
  let after;
  let onlyOnTheWallClock = false;

  return {
    id: "scoring.descend-on-clear",

    async arrange(api) {
      const snap = await startPlaying(api);
      depthBefore = snap.depth;
      await api.call("poseLastPlankton");
    },

    async act(api) {
      const r = await actEatLastPlankton(api);
      clearedScreen = r.snap.screen;
      // HOW LONG the cleared interstitial holds before the next maze begins is the
      // build's own call: `specs/ui.md` only calls it "brief" and fixes no duration,
      // and `specs/progression.md` fixes only that clearing descends. So sweep to the
      // descent itself rather than advancing a guessed number of ticks — a fixed
      // budget passes only the builds whose interstitial is no longer than the one it
      // was tuned against, and fails a conforming build that holds the screen a
      // little longer. 600 ticks = 5 s is the ceiling a "brief" interstitial cannot
      // credibly outlast; a build that never descends spends it and fails below,
      // exactly as a short advance would have.
      const descended = await api.until((s) => s.depth > depthBefore, {
        max: 600,
        poll: 6, // 6 ticks = 50 ms: a screen transition needs no finer grain
      });
      after = descended.snap;
      if (!descended.hit) {
        // Five seconds of simulation and still on the cleared screen. Before reporting
        // that clearing does not descend, ask WHY — because there are two very different
        // reasons and only one of them is about progression.
        //
        // Hand the clock back and let the build run itself for a moment. A build whose
        // interstitial is driven by the wall clock rather than by the fixed step descends
        // now, having refused to for five simulated seconds: its dive advances only when a
        // real person is watching. That is the deterministic core `specs/instrumentation.md`
        // requires — "must not depend on a canvas, on `requestAnimationFrame`, or on
        // wall-clock time to make progress" — and it is worth saying in those words, rather
        // than as a build that cannot descend, which is what a reviewer would otherwise go
        // looking for. A build that is simply stuck descends under neither clock.
        await api.call("setAutoStep", true);
        await api.settle(3000);
        await api.call("setAutoStep", false);
        after = await api.snapshot();
        onlyOnTheWallClock = after.depth > depthBefore;
      }
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq("the maze is cleared", clearedScreen, "cleared");
      check.expectOk(
        "the cleared screen gives way on the simulation's own clock, not only on the wall clock",
        !onlyOnTheWallClock,
      );
      check.expectEq(
        "clearing descends to a deeper maze",
        after.depth,
        depthBefore + 1,
      );
    },
  };
}
