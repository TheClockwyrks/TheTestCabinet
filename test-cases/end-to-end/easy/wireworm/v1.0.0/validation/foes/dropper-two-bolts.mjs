// Automated validation for foes.dropper-two-bolts: the dropper survives its first
// bolt (which only speeds it up) and dies to the second, paying its bounty (200).
//
// A dropper falling down the cursor's column is the precondition; both outcomes are
// produced by the real hitFoe dropper branch (first hit sets hitOnce and speeds it,
// second removes it) and read back.
//
// It enters at the top of the board and is allowed to FALL into range before the
// first shot, rather than being posed just above the cursor and shot on the spot. The
// old arrangement fired on the first tick of `act`, so both hits and the bounty were
// over before the clip — which cannot begin filming the instant the pass does — had
// its first frame: it opened on an empty column with 200 points already scored, which
// is the one thing this item is not about. The fall is also what the reviewer needs to
// see the speed-up in: a dropper that only ever appears at the bottom of the board has
// nowhere left to visibly drop faster.
//
// A falling dropper reseeds inert nodes down its own column, but it lays them in the
// tiles it has ALREADY passed, so the trail stands above it and never between it and
// the cursor: a bolt fired from below still meets the dropper first. The wait is a
// DISTANCE (poll until it has fallen past the target row), not a tick count, because
// specs/foes.md fixes no fall speed.

import {
  actFireAndResolve,
  TICK,
  foesOf,
  freshBoard,
  tileCY,
} from "../_helpers.mjs";

// Where the dropper enters, and how far down the column it is let fall before the
// first bolt. Row 9 is halfway down: far enough that the fall reads (about two
// seconds at the reference's 150 px/s) and that the sped-up second half is visible,
// while leaving ten rows of board for the second bolt to land in.
const ENTRY_Y = 64; // just above row 0, the way a real dropper enters
const FIRE_BELOW_ROW = 9;

export default function item() {
  let before;
  let first;
  let second;

  return {
    id: "foes.dropper-two-bolts",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "dropper", { x: 640, y: ENTRY_Y });
      await api.call("setCursor", 640, 688);
    },

    // The fall, both shots, and their resolutions are one scenario, and this is the
    // clip: the reviewer watches the dropper come down the column, shrug off the
    // first bolt, drop faster for it, and die to the second.
    async act(api) {
      before = (await api.snapshot()).score;

      // Let it fall into range first. Capped at 4 s, comfortably past the ~2 s the
      // reference takes; a dropper that never arrives leaves the shots to fail the
      // check rather than this wait.
      await api.until(
        (s) => (foesOf(s, "dropper")[0]?.y ?? 0) >= tileCY(FIRE_BELOW_ROW),
        {
          max: 480,
          poll: 6,
        },
      );

      // First bolt: the dropper survives, marked as having taken its speed-up hit.
      // Polled a tick at a time because the instant the mark lands is what is read.
      await api.call("fire");
      const r = await api.until(
        (s) =>
          foesOf(s, "dropper")[0]?.firstHit ||
          foesOf(s, "dropper").length === 0,
        { max: 180, poll: TICK }, // 180 ticks = the old stepUntil's 1.5s cap
      );
      first = r.snap;

      // Second bolt: the dropper dies. The cap is doubled (240 ticks = the old
      // `fireAndResolve(api, 2)`'s 2s) because the sped-up dropper may have fallen
      // further down the column by now.
      second = await actFireAndResolve(api, { max: 240 });
      // Every operand is captured; the sim runs on only so the kill is legible at
      // the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      const d = foesOf(first, "dropper")[0];
      check.expectOk("the dropper survives its first bolt", !!d);
      check.expectOk(
        "the first hit only speeds it up (marks it hit once)",
        d?.firstHit === true,
      );

      check.expectEq(
        "the second bolt kills the dropper",
        foesOf(second, "dropper").length,
        0,
      );
      check.expectEq(
        "killing the dropper pays its bounty (200)",
        second.score - before,
        200,
      );
    },
  };
}
