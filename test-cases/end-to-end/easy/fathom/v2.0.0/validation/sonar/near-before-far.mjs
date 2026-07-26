// sonar.near-before-far: the wavefront reveals nearer tiles before farther ones, so
// the revealed set grows as the front advances rather than appearing all at once.
//
// Entering play and clearing the cooldown is instant (`arrange`); the pulse and the two
// readings as its front travels are the real sim, so they are `act` — the clip is the
// front sweeping outward.
import { startPlaying } from "../_helpers.mjs";

function revealedCount(s) {
  let n = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      const v = s.visibility[r][c];
      if (v === "l" || v === "r") n++;
    }
  }
  return n;
}

export default function item() {
  let early;
  let late;

  return {
    id: "sonar.near-before-far",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns");
    },

    async act(api) {
      await api.call("press", "Space");
      // The old step(0.12) is 14.4 ticks, which the contract refuses to round. This is an
      // EARLY reading of a still-travelling front, so the shorter 14 ticks is right: it
      // keeps the sample early, where a longer one would let the front cover more ground
      // and narrow the very gap the check is looking for.
      await api.advance(14);
      early = revealedCount(await api.snapshot());
      await api.advance(72); // 72 ticks = the old 0.6 s
      late = revealedCount(await api.snapshot());
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectGt(
        "more tiles are revealed as the front advances (near revealed before far)",
        late,
        early,
      );
    },
  };
}
