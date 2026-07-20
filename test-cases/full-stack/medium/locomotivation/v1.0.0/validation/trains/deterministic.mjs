// Trains: the same seed and the same steps reproduce identical train positions. Level 3 is
// run twice from the same seed for the same time; every scheduled train's position must match.
//
// This item needed a redesign rather than a mechanical port. The old script ran a local
// `runToPositions` helper twice, and that helper opened with `api.reset({ seed: 7 })` —
// which the runtime now forbids inside `act`, because a mid-act reset takes the build's
// clock back and silently freezes the recording. Two seeded resets therefore cannot both
// happen in the timed phase.
//
// The seeding moves to `arrange`, where it is legal and where it runs once for BOTH
// replays; `startLevel` then re-poses the yard for each run. That is a control op — it
// enters a level without touching the clock — so it is legal mid-act, and it is exactly
// the "same sequence of API calls" the determinism contract in specs/instrumentation.md
// is about. Both replays now start from one seed and run identical steps, which is the
// property the assertions were always testing.

import { TICK_HZ } from "../_helpers.mjs";

// 360 ticks = the old 6.0s replay length, exactly, at 60 Hz.
const REPLAY_TICKS = 6 * TICK_HZ;

/** The scheduled trains' lane/position, ordered so two replays compare element-wise. */
const positionsOf = (snap) =>
  snap.trains
    .map((t) => ({ key: `${t.trackId}:${t.line}`, headPos: t.headPos }))
    .sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : a.headPos - b.headPos,
    );

export default function item() {
  // The two replays' train positions.
  let a;
  let b;

  return {
    id: "trains.deterministic",

    // Seed the game's randomness once. Everything both replays share starts here.
    async arrange(api) {
      await api.reset({ seed: 7 });
    },

    // Two identical replays back to back: enter level 3, run the same number of ticks,
    // read the trains. The clip shows the first replay and part of the second, which is
    // the honest depiction — a reviewer sees the yard the assertions compared.
    async act(api) {
      await api.call("startLevel", 3);
      await api.advance(REPLAY_TICKS);
      a = positionsOf(await api.snapshot());

      await api.call("startLevel", 3); // re-pose the same level, same seed, no reset
      await api.advance(REPLAY_TICKS);
      b = positionsOf(await api.snapshot());
    },

    async assert(api, check) {
      check.expectEq(
        "both replays hold the same number of trains",
        a.length,
        b.length,
      );
      check.expectGt("there is at least one train to compare", a.length, 0);
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        check.expectEq(`train ${i} is the same lane/track`, a[i].key, b[i].key);
        check.expectClose(
          `train ${i} is at the same position`,
          a[i].headPos,
          b[i].headPos,
          1e-6,
        );
      }
    },
  };
}
