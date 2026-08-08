// Automated validation for build.r0-only-scrap: at Refinement R0 every placed rock rolls
// Scrap (T1) quality — the unrefined press hands out only the lowest tier.
//
// Five rocks are placed at R0 with the real seeded press; every rolled candidate's quality
// must be Scrap.
//
// Only the opening of the run is arranged; the five real rolls landing are the behavior under
// test, and placements are control ops, so they are the act and are what the clip shows.
//
// WHY THIS IS A CLIP RATHER THAN A STILL. The five drops used to be fired off back to back and a
// single frame captured afterwards, which is a picture of five Scrap candidates already standing.
// The claim is about what the press KEEPS HANDING OUT — that every roll off an unrefined press
// comes back Scrap — and a board of finished rolls does not show rolling. A beat between the
// drops makes the sequence legible as five separate pulls of the press, each one landing on the
// bottom rung.

import { startBuild, SPOTS, towerAt, snap, SECOND } from "../_helpers.mjs";

// A beat between drops, so each roll lands and reads as its own before the next one does.
const BEAT_TICKS = 0.9 * SECOND;
// A beat on the finished board, with all five tiers of nothing but Scrap standing together.
const TAIL_TICKS = 1.5 * SECOND;

export default function item() {
  // The opening snapshot and the five rolled qualities, read by `assert`.
  let s0;
  const tiers = [];

  return {
    id: "build.r0-only-scrap",

    async arrange(api) {
      s0 = await startBuild(api); // Refinement starts at R0
    },

    async act(api) {
      for (const spot of SPOTS) {
        await api.call("setNextRoll", null);
        await api.call("placeRock", spot.col, spot.row);
        const t = towerAt(await snap(api), spot.col, spot.row);
        if (t && t.kind === "candidate") tiers.push(t.quality);
        await api.advance(BEAT_TICKS);
      }

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the press starts at Refinement R0", s0.refinement, 0);
      check.expectEq("five R0 rolls landed", tiers.length, 5);
      check.expectOk("every R0 roll is Scrap (T1)", tiers.every((q) => q === 1));
    },
  };
}
