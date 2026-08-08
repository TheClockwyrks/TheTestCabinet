// Automated validation for the Upgrades sub-item `branch-a-vs-b`.
//
// A tower's two tier-III branches behave distinctly. The check compares the Emitter's
// two branches by how many shots a single volley launches at three in-range targets: the
// Spread branch (B) fires at up to three at once, while the Charged branch (A) fires a
// single bolt.
//
// TWO runs: the Spread branch is arranged, the Charged branch posed inside `act` with
// `poseScenario` (control ops only — `api.reset` throws there).

import {
  startScenario,
  poseScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  clipBudget,
  TICK,
  MAP,
} from "../_helpers.mjs";

const MAX_VOLLEY_TICKS = 120; // 2 s — the sweep's own cap
// How long each branch is left firing after its first volley is counted. The COUNT is read
// on the tick the volley launches and cannot be relaxed — a tick later the shots have begun
// to land and the reading is wrong — but the clip has no such constraint, and cutting on
// that tick gave the reviewer a frame of three projectiles they could not compare against
// anything. Held for three seconds each, the fan of a Spread volley and the single bolt of
// a Charged one are plainly different things.
const VOLLEY_ON_TICKS = 180;

/** Pose a tier-III Emitter of `branch` over three in-range atoms; `begin` opens the run. */
async function poseVolley(api, begin, branch) {
  const snap = await begin(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.2;
  const t = await placeCovering(api, "emitter", g, s0);
  await api.call("upgradeTower", t.id); // -> tier II
  await api.call("upgradeTower", t.id, branch); // -> tier III
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 - 45 });
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 });
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 + 45 });
}

/** Run on to the first volley and count the shots it put in the air. */
async function actVolleyCount(api) {
  // NO LEAD-IN BEFORE THE COUNT. A tier-III Emitter reloads about twice a second and deals
  // 2 damage, so two seconds of establishing shot is four volleys — enough to neutralize all
  // three 6-electron atoms before the volley under test is ever fired. Framed that way the
  // Spread branch counted ZERO shots, because by then it had nothing left to shoot at. The
  // tower's own reload supplies a short lead-in for free; the run-on below is where the
  // window the review asked for actually comes from.
  //
  // The old poll of 0.02 s is 1.2 ticks, which the contract refuses; it meant "sample as
  // finely as possible", and the count must be read on the tick the volley launches — a
  // tick later and the shots have begun to land.
  const r = await api.until((s) => s.projectiles.length > 0, {
    max: MAX_VOLLEY_TICKS,
    poll: TICK,
  });
  const count = r.snap.projectiles.length;
  // ...and the tower going on firing that same shape of volley.
  await api.advance(VOLLEY_ON_TICKS);
  return count;
}

export default function item() {
  let spread;
  let charged;

  return {
    id: "upgrades.branch-a-vs-b",

    clipMs: clipBudget(2 * (MAX_VOLLEY_TICKS + VOLLEY_ON_TICKS)),

    async arrange(api) {
      await poseVolley(api, startScenario, "B"); // SPREAD: up to 3 targets
    },

    // Both volleys, back to back — the Spread branch fanning out, then the Charged branch
    // firing its single bolt at the same three atoms.
    async act(api) {
      spread = await actVolleyCount(api);

      await poseVolley(api, poseScenario, "A"); // CHARGED: a single bolt
      charged = await actVolleyCount(api);
    },

    async assert(api, check) {
      check.expectGt(
        "the Spread branch fires at more targets per volley than Charged",
        spread,
        charged,
      );
      check.expectGe("Spread launches multiple shots at once", spread, 2);
      check.expectEq("Charged launches a single shot", charged, 1);
    },
  };
}
