// Automated validation for refinement.biases-rolls: buying Refinement biases the stamp's
// quality roll upward — at a high Refinement level rolls land above Scrap, whereas at R0 they
// never do.
//
// At R0 a real roll is Scrap. Deeply refined (R8, whose odds carry zero Scrap weight), five
// real rolls all land above Scrap.
//
// The R0 baseline is taken in the arrange, because reading it and then re-opening the run for
// the refined half both require `reset`. The FIVE REFINED ROLLS are the behavior under test, and
// a placement is a control op, so they are the act — which is a far better clip than the old
// tail, which walked a Spark past a board that had already finished rolling.

// WHY THE ROLLS ARE NOW SPACED. The five drops used to be fired off back to back with a tenth of
// a second on the end, and a placement consumes no game time — so all five landed inside a few
// tens of milliseconds and the clip opened on a board that already held them. Against every run
// implementation the recording showed five refined candidates simply present from the first
// frame, where the reference's happened to land during it: the same script produced two different
// kinds of evidence depending on how fast the host got through its round trips, and the kind it
// produced most of the time showed no rolling at all.
//
// A beat between the drops makes the sequence what the item claims: the press pulled five times,
// each pull landing a piece above Scrap. Nothing about the verdict moves — the qualities are read
// as each one lands, exactly as before.

import { startBuild, SPOTS, towerAt, snap, SECOND } from "../_helpers.mjs";

// A beat between drops, so each refined roll lands and reads as its own before the next one does.
const BEAT_TICKS = 0.9 * SECOND;
// A beat on the finished board, with the whole refined spread standing together.
const TAIL_TICKS = 1.5 * SECOND;

export default function item() {
  // The R0 baseline roll, and the five refined qualities.
  let baseline;
  const tiers = [];

  return {
    id: "refinement.biases-rolls",

    async arrange(api) {
      // R0 baseline: a real roll is Scrap.
      await startBuild(api, { seed: 1 });
      await api.call("setNextRoll", null);
      await api.call("placeRock", 6, 7);
      baseline = towerAt(await snap(api), 6, 7).quality;

      // A fresh, deeply refined press for the act to roll against.
      await startBuild(api, { seed: 1, charge: 9999 });
      await api.call("setRefinement", 8);
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
      check.expectEq("an unrefined (R0) roll is Scrap (T1)", baseline, 1);
      check.expectEq("five refined rolls landed", tiers.length, 5);
      check.expectOk("a deeply refined press rolls no Scrap", tiers.every((q) => q > 1));
      check.expectGt("...and hands out higher tiers on average", Math.max(...tiers), 1);
    },
  };
}
