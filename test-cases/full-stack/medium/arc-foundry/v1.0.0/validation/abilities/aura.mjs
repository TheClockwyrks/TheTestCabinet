// Automated validation for abilities.aura: a Regulator's aura multiplies the damage of a
// firing tower whose center lies within its radius by (1 + auraBonus); the aura source never
// buffs itself.
//
// A standing Capacitor is kept (its wave cleared), then a Regulator is kept beside it so its
// aura covers the Capacitor. The Capacitor's effective damage must exceed its base (6) — a
// T1 Regulator's +10% takes it to 7 — while the Regulator itself deals no damage.
//
// The clip used to show neither piece. Both towers only exist once Wave 1 has been cleared and
// the Regulator kept on the build phase that reopens, and the old script spent that clear in
// `act` with `actClearWave` — which is REAL time in the record pass. A Wave 1 walks itself out
// over roughly a minute, so the 8 s recording budget was exhausted long before the Regulator
// was ever placed, and the clip was a minute of the Capacitor alone. The clear is the journey
// to the evidence, not the evidence, so it is skipped (instant in both passes, `skipClearWave`)
// and `act` opens on the board this item is actually about: the Regulator standing beside the
// Capacitor with a Load walking into their reach.

import {
  startBuild,
  placeCandidate,
  spawnControlled,
  skipClearWave,
  skipToApproach,
  towerById,
  snap,
  SECOND,
} from "../_helpers.mjs";

// A beat on the buffed pair with a unit walking into them, so the aura reads as a live board
// rather than a still.
const WATCH_TICKS = 3 * SECOND;

export default function item() {
  // The two towers as they stood once the Regulator was up, read by `assert`.
  let capT;
  let regT;

  return {
    id: "abilities.aura",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);

      const cap = await placeCandidate(api, "capacitor", 1, 12, 7);
      await api.call("keep", cap.id); // Wave 1
      await skipClearWave(api); // reopen the build phase, instantly, filming nothing

      const reg = await placeCandidate(api, "regulator", 1, 14, 9); // its aura covers the Capacitor
      await api.call("keep", reg.id); // Wave 2 — beginWave recomputes auras

      const s = await snap(api);
      capT = towerById(s, cap.id);
      regT = towerById(s, reg.id);

      // Something for the buffed Capacitor to shoot at, walked up to the edge of its reach.
      const [u] = await spawnControlled(api, "slug");
      await skipToApproach(api, cap.id, u.id);
    },

    async act(api) {
      // The assertions are already fixed on the snapshot above; this is the clip: the Regulator
      // standing beside the Capacitor it buffs, with the Load coming into range.
      await api.advance(WATCH_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a Regulator stands beside the firing tower", !!regT);
      check.expectGt("the aura buffs the covered tower's damage above its base (6)", capT.damage, 6);
      check.expectEq("...to +10% at T1 (6 -> 7)", capT.damage, 7);
      check.expectOk("the Regulator projects an aura", regT.abilities.includes("aura") && regT.auraRadius > 0);
      check.expectEq("the aura source deals no damage itself (no self-buff to speak of)", regT.damage, 0);
    },
  };
}
