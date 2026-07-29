// Automated validation for abilities.crit: a crit-carrying combination tower can land a shot
// dealing x critMult damage; base components never crit.
//
// A Slag Driver (crit(0.25, 2.0), `specs/towers.md`) is assembled and fires at a Dynamo held on
// `strongest` targeting so every shot lands on it. Across shots, one must take more HP off the
// Dynamo than a normal shot does — that is the crit.
//
// WHAT A CRIT IS READ FROM. This used to sweep `projectiles[]` for a shot whose reported
// `damage` exceeded the tower's per-shot damage, which quietly required the crit to be rolled
// when the bolt LAUNCHES and carried on the projectile. `specs/towers.md` says only that "each
// shot has a crit chance to deal x critMult damage"; it does not say when the roll happens, and
// a build that rolls it on IMPACT — where the damage is actually applied — is exactly as
// conformant. Such a build reports the base damage on every projectile in flight and the sweep
// could never fire, so the check failed a build whose crits work.
//
// So the crit is read where the spec puts it: in the damage dealt. The Dynamo's HP is sampled
// every tick and the largest single-tick drop is kept. The Slag Driver carries no burn and no
// multishot, so each drop is one impact and nothing else can contribute to it — a drop of more
// than 1.5x the tower's per-shot damage cleanly separates a x2.0 crit from a normal hit.
//
// HOW THE SEARCH IS PACED. Crit is a 25% roll, so a search needs several shots. The old script
// spent all of them in `act` — twelve rounds of five seconds — which in the record pass is real
// time, so the clip was the first eight seconds of a sixty-second search and usually ended
// before any crit landed. Now the first round is filmed at its real pace (long enough to watch
// several heavy bolts cross and land, one of which usually crits) and any further rounds needed
// to settle the verdict are skipped: instant in both passes, changing no verdict, filming
// nothing. A fresh Dynamo per round is not padding — the Slag Driver's range is 175 px and a
// Dynamo walks at 30 px/s, so one target leaves the firing envelope after a few seconds and the
// search would otherwise stall with nothing to shoot at.

import {
  assembleCombo,
  spawnControlled,
  skipToApproach,
  towerById,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// The filmed round, then how many more may be searched instantly, and how long each watches.
const WATCHED_TICKS = 6 * SECOND;
const SKIPPED_ROUNDS = 14;
const ROUND_TICKS = 5 * SECOND;

export default function item() {
  // The assembled combo, its base per-shot damage, and the biggest single hit seen.
  let comboId;
  let baseDmg = 0;
  let maxHit = 0;
  let dynamoId = null;
  let prevHp = null;

  // Sample the tracked Dynamo's HP and keep the largest single-tick drop. Used as a `skipUntil`
  // / `until` predicate, which evaluates exactly once per sample — so the running state below
  // is advanced exactly once per tick, as it must be.
  const watch = (thresh) => (s) => {
    const u = s.units.find((x) => x.id === dynamoId);
    if (u) {
      if (prevHp != null && prevHp > u.hp) maxHit = Math.max(maxHit, prevHp - u.hp);
      prevHp = u.hp;
    } else {
      prevHp = null;
    }
    return maxHit > thresh;
  };

  // Release a fresh, undamaged Dynamo and start tracking it.
  const nextDynamo = async (api) => {
    const [d] = await spawnControlled(api, "dynamo", { wave: 20 });
    dynamoId = d.id;
    prevHp = null;
    return d;
  };

  return {
    id: "abilities.crit",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "slagdriver", { seed: 1, charge: 400 }));
      if (comboId == null) return;
      await api.call("setTargeting", comboId, "strongest");
      // The level-0 Slag Driver's base per-shot damage, read before a shot is ever fired.
      baseDmg = towerById(await snap(api), comboId).damage;

      const d = await nextDynamo(api);
      await skipToApproach(api, comboId, d.id);
      prevHp = null; // the approach is not part of the measurement
    },

    async act(api) {
      if (comboId == null) return;
      const thresh = baseDmg * 1.5; // a crit is x2, so > 1.5x base cleanly separates it

      // The filmed round: heavy bolts crossing the gap and landing, at the pace they run.
      await api.until(watch(thresh), { max: WATCHED_TICKS, poll: TICK });

      // Any further search the verdict needs costs the recording nothing.
      for (let round = 0; round < SKIPPED_ROUNDS && maxHit <= thresh; round += 1) {
        await nextDynamo(api);
        await api.skipUntil(watch(thresh), { max: ROUND_TICKS, poll: TICK });
      }
    },

    async assert(api, check) {
      check.expectOk("a Slag Driver was assembled", comboId != null);
      check.expectGt("the combination tower has a per-shot damage to compare against", baseDmg, 0);
      check.expectOk(
        "a combination tower landed a critical hit (a shot dealt more than a normal shot)",
        maxHit > baseDmg * 1.5,
      );
      check.expectGt("the crit shot's damage exceeds the base per-shot damage", maxHit, baseDmg);
    },
  };
}
