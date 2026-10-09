// Automated validation for the Gyre sub-item `obstacles-sway`: the obstacles move —
// each sways vertically about its base center as the obstacle clock advances.
//
// setObstacleClock poses the obstacles at a chosen clock time and holds them there
// (see specs/instrumentation.md), so the check reads each obstacle's center back at
// two clock times: upright at 0, and a quarter of the sway period later where the
// sway is at its peak. Each obstacle's center y must move well off its base, and the
// two must move in opposite directions (they sway in anti-phase, keeping the field
// balanced).
//
// NOTE: setObstacleClock takes SECONDS. It poses the obstacle clock rather than
// advancing time, so its argument is NOT a tick count — only the holds between the
// poses (which do consume time) are in ticks.

// How long each posed clock time is held on screen. The two holds together make the
// old 1800ms clip, and in the record pass the obstacle clock is running, so what the
// video shows across them is the obstacles swaying — the checked behavior.
const HOLD = 108; // 108 ticks = 0.9 s

export default function item() {
  // The obstacle poses `act` read back, for `assert` to compare.
  let at0;
  let atPeak;

  return {
    id: "gyre.obstacles-sway",

    // A fresh match starts the obstacle clock at 0, held while driven.
    async arrange(api) {
      await api.reset();
      await api.call("startMatch", "versus");
    },

    // Read each obstacle's center back at the two clock times, holding on each so the
    // recorded clip shows the obstacles travelling between them.
    async act(api) {
      await api.call("setObstacleClock", 0); // seconds, not ticks
      at0 = (await api.snapshot()).obstacles;
      await api.advance(HOLD);
      await api.call("setObstacleClock", 0.9); // ~quarter of the sway period: peak sway
      atPeak = (await api.snapshot()).obstacles;
      await api.advance(HOLD);
    },

    async assert(api, check) {
      check.expectClose(
        "obstacle A starts at its base center y",
        at0[0].cy,
        220,
        2,
      );
      check.expectClose(
        "obstacle B starts at its base center y",
        at0[1].cy,
        500,
        2,
      );
      const dA = atPeak[0].cy - at0[0].cy;
      const dB = atPeak[1].cy - at0[1].cy;
      check.expectGt(
        "obstacle A sways vertically as the clock advances (|Δcy|)",
        Math.abs(dA),
        40,
      );
      check.expectGt(
        "obstacle B sways vertically as the clock advances (|Δcy|)",
        Math.abs(dB),
        40,
      );
      check.expectLt(
        "the two obstacles sway in opposite directions (product of their Δcy)",
        dA * dB,
        0,
      );
    },
  };
}
