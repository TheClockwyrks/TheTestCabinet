// Automated validation for abilities.aura: a Regulator's aura multiplies the damage of a
// firing tower whose center lies within its radius by (1 + auraBonus); the aura source never
// buffs itself.
//
// A standing Capacitor is kept (its wave cleared), then a Regulator is kept beside it so its
// aura covers the Capacitor. The Capacitor's effective damage must exceed its base (6) — a
// T1 Regulator's +10% takes it to 6.6 — while the Regulator itself deals no damage.
//
// THE BUFFED FIGURE IS NOT AN INTEGER. This used to assert `damage === 7`, which is 6.6 rounded
// — what the reference implementation happens to report. The spec does not ask for that: the
// aura rule is "damage multiplied by `(1 + auraBonus)`" (`specs/towers.md`), and the only figure
// the specs call "rounded" is the base damage TABLE the 6 comes from. A build reporting 6.6 is
// reporting the spec's number and was failing over a presentation choice, so the buffed damage
// is compared with one nearest-integer of slack (`ROUNDING_SLACK` in `_helpers.mjs`, the same
// slack scaled HP is read with). What separates a buffed tower from an unbuffed one is still
// the strict `> 6` ahead of it: a build that reports the buff rounded DOWN, to the 6 it started
// at, has not reported the effective damage the aura produced and fails there.
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
  BASE,
  ROUNDING_SLACK,
  SECOND,
} from "../_helpers.mjs";

// A T1 Regulator's aura (specs/towers.md "Regulator — aura": `bonus = 0.10 + 0.03*(tier - 1)`).
const T1_AURA_BONUS = 0.1;

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
      const base = BASE.capacitor.dmg;
      // Trimmed of binary-float noise (6 * 1.1 lands on 6.6000000000000005), so the figure the
      // reviewer is shown is the one the spec computes. Far below the slack it is read with.
      const buffed = Number((base * (1 + T1_AURA_BONUS)).toFixed(6));

      check.expectOk("a Regulator stands beside the firing tower", !!regT);
      check.expectGt(`the aura buffs the covered tower's damage above its base (${base})`, capT.damage, base);
      check.expectClose(
        `...to +10% at T1 (${base} -> ${buffed})`,
        capT.damage,
        buffed,
        ROUNDING_SLACK,
      );
      check.expectOk("the Regulator projects an aura", regT.abilities.includes("aura") && regT.auraRadius > 0);
      check.expectEq("the aura source deals no damage itself (no self-buff to speak of)", regT.damage, 0);
    },
  };
}
