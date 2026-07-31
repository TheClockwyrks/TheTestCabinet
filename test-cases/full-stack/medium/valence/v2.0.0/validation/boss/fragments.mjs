// Automated validation for the Boss sub-item `fragments`.
//
// A worn-down Macromass fountains matter as it decays rather than merely draining a hit
// point bar: each decay step it crosses puts the next entry of its 55-step chain onto the
// path. The check drives the boss down a line of Impactor Cleavers — enough to break its
// containment pool and then crack the nucleus behind it — and watches the real matter
// list for the alpha (6-electron) and beta (2-electron) atoms the chain emits.

import { unitById, decayKind } from "../_helpers.mjs";
import { bossUnderFire } from "./_boss.mjs";

const MAX_CRACK_TICKS = 7200; // 7200 ticks = the old 120 s cap — generous game time, not wall clock
// The sweep stops the moment BOTH an alpha and a beta have been sighted, which on a boss
// that fountains its chain is the first couple of decay steps — and a clip that cuts there
// shows two fragments piled on the nucleus they came off (fragments are born at their
// parent's own position, specs/board.md) rather than the fountain the item is named for.
// Running on lets the fragments separate and further steps land.
const TAIL_TICKS = 120;

export default function item() {
  let bossId;
  let hp0;
  let r;
  // Sightings accumulate across `act`; a fresh pair per pass.
  let sawAlpha;
  let sawBeta;

  return {
    id: "boss.fragments",

    async arrange(api) {
      ({ bossId } = await bossUnderFire(api));
      hp0 = unitById(await api.snapshot(), bossId).hp;
      sawAlpha = false;
      sawBeta = false;
    },

    // The boss walking the Impactor line and fountaining fragments — the behavior under
    // test, and the whole of the clip.
    async act(api) {
      // poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          // By what each fragment was BORN as (`decayKind`, off `maxHp`), not by its live
          // `electrons`: the Impactor line is chewing these fragments down as fast as the
          // boss emits them, and a 6-electron alpha being stripped reads 4 and then 2 on
          // the way — which a live read counts as a beta the boss never emitted.
          for (const u of s.matter) {
            const kind = decayKind(u);
            if (kind === "alpha") sawAlpha = true;
            if (kind === "beta") sawBeta = true;
          }
          return sawAlpha && sawBeta;
        },
        { max: MAX_CRACK_TICKS, poll: 3 },
      );
      // Run on so the fountain reads as a fountain rather than a pile.
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk(
        "the boss sheds an alpha (6-electron) fragment as it decays",
        sawAlpha,
      );
      check.expectOk(
        "the boss sheds a beta (2-electron) fragment as it decays",
        sawBeta,
      );
      const u = unitById(r.snap, bossId);
      check.expectOk(
        "the boss is worn down under fire",
        u == null || u.hp < hp0,
      );
    },
  };
}
