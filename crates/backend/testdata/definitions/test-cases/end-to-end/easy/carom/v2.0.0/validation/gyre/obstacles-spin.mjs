// Automated validation for the Gyre sub-item `obstacles-spin`: the obstacles spin —
// each rotates about its own center as the obstacle clock advances.
//
// setObstacleClock poses the obstacles at a chosen clock time and holds them there
// (see specs/instrumentation.md), so the check reads each obstacle's rotation back at
// three clock times. Each obstacle is upright (theta ~ 0) at clock 0, is clearly
// rotated part-way through, and keeps rotating further as the clock advances.
//
// NOTE: setObstacleClock takes SECONDS. It poses the obstacle clock rather than
// advancing time, so its argument is NOT a tick count — only the holds between the
// poses (which do consume time) are in ticks.

// How long each posed orientation is held on screen. The three holds together make
// the old 1800ms clip, and in the record pass the obstacle clock is running, so what
// the video shows across them is the obstacles rotating — the checked behavior.
const HOLD = 72; // 72 ticks = 0.6 s

export default function item() {
  // The obstacle poses `act` read back, for `assert` to compare.
  let at0;
  let atHalf;
  let atOne;

  return {
    id: "gyre.obstacles-spin",

    // A fresh match starts the obstacle clock at 0, held while driven.
    async arrange(api) {
      await api.reset();
      await api.call("startMatch", "versus");
    },

    // Read each obstacle's rotation back at three clock times, holding on each so the
    // recorded clip shows the obstacles turning further at every step.
    async act(api) {
      await api.call("setObstacleClock", 0); // seconds, not ticks
      at0 = (await api.snapshot()).obstacles;
      await api.advance(HOLD);
      await api.call("setObstacleClock", 0.5);
      atHalf = (await api.snapshot()).obstacles;
      await api.advance(HOLD);
      await api.call("setObstacleClock", 1.0);
      atOne = (await api.snapshot()).obstacles;
      await api.advance(HOLD);
    },

    async assert(api, check) {
      check.expectClose(
        "obstacle A is upright at clock 0 (theta, rad)",
        Math.abs(at0[0].theta),
        0,
        0.02,
      );
      check.expectGt(
        "obstacle A has rotated part-way through (|theta|, rad)",
        Math.abs(atHalf[0].theta),
        0.3,
      );
      check.expectGt(
        "obstacle A keeps rotating as the clock advances (|theta| grows)",
        Math.abs(atOne[0].theta),
        Math.abs(atHalf[0].theta),
      );
      check.expectGt(
        "obstacle B also rotates as the clock advances (|theta|, rad)",
        Math.abs(atOne[1].theta),
        0.3,
      );
    },
  };
}
