// Automated validation for foes.dropper-two-bolts: the dropper survives its first
// bolt (which only speeds it up) and dies to the second, paying its bounty (200).
//
// A dropper just above the cursor is the precondition; both outcomes are produced by
// the real hitFoe dropper branch (first hit sets hitOnce and speeds it, second
// removes it) and read back. The dropper is posed close to the cursor (rather than
// high up the column) because a falling dropper reseeds inert nodes down its own
// column, and firing up that column from far below would clear that trail instead —
// so we hit the dropper itself before it lays a shielding node in the firing lane.

import {
  actFireAndResolve,
  TICK,
  foesOf,
  freshBoard,
  tileCY,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let first;
  let second;

  return {
    id: "foes.dropper-two-bolts",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "dropper", { x: 640, y: tileCY(17) });
      await api.call("setCursor", 640, 688);
    },

    // Both shots and their resolutions are one scenario, and this is the clip: the
    // reviewer watches the dropper shrug off the first bolt and die to the second.
    async act(api) {
      before = (await api.snapshot()).score;

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
