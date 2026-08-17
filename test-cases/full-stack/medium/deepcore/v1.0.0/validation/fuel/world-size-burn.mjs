// Automated validation for fuel.world-size-burn.
//
// The jetpack thrust burn is scaled by the world size so the fuel clock stays proportional to the
// descent: a shallow Quick mine burns thrust ~2x as fast as a Standard mine and a deep Marathon
// ~0.67x. We hold thrust for the same time from the same standing start in a Quick, a Standard, and
// a Marathon mine and compare the fuel burned. Only the thrust burn scales, so the ordering is
// Quick > Standard > Marathon, and Quick is well over twice the Marathon burn.

import {
  teleportInto,
  K,
  actHoldFor,
  openColumn,
  solid,
  SPAWN_COL,
} from "../_helpers.mjs";

/**
 * ACT: measure the fuel burned by half a second of thrust in a mine of the given size.
 *
 * Each size is re-posed with `startExpedition` rather than the old `newRun`, because `newRun`
 * resets — and a reset inside `act` would hand the build back its manual clock and freeze the
 * recording. The seed is fixed once in `arrange`, and the measurement does not depend on the
 * generated terrain anyway: the shaft, the floor, and the gear are all posed explicitly below.
 */
async function actThrustBurn(api, size) {
  const col = SPAWN_COL;
  const row = 60; // a shallow row that exists at every size (topsoil)
  await api.call("startExpedition", "standard", size);
  await openColumn(api, col, 24, row); // open shaft above so the miner rises
  await solid(api, col, row + 1); // a floor to stand on
  await teleportInto(api, col, row);
  await api.call("grantGear", { fuel: 5, jetpack: 3 }); // the tier-5 550 tank, tier-3 engine
  // Fill the tank explicitly rather than relying on the grant to have filled it. A build that
  // raises the ceiling without granting the capacity leaves the miner on `100/550`, and a hold
  // that runs the tank dry stops burning partway through the window — so the three sizes are no
  // longer measured over the same half second and the burn "does not scale". The grant contract is
  // checked on its own by `economy.grant-applies-tiers`; this item is about the size scaling.
  await api.call("setFuel", 100000);
  await teleportInto(api, col, row);
  const f0 = (await api.snapshot()).miner.fuel;
  const snap = await actHoldFor(api, K.thrust, 30); // 30 ticks = the old 0.5 s hold
  return f0 - snap.miner.fuel;
}

export default function item() {
  let quick;
  let standard;
  let marathon;

  return {
    id: "fuel.world-size-burn",

    // Fix the seed once; each size's expedition is started inside `act`.
    async arrange(api) {
      await api.reset({ seed: 1 });
    },

    // All three burns are timed, so all three run here — and the clip shows the same half-second
    // hold in each mine, which is exactly the comparison being asserted.
    async act(api) {
      quick = await actThrustBurn(api, "quick");
      standard = await actThrustBurn(api, "standard");
      marathon = await actThrustBurn(api, "marathon");
    },

    async assert(api, check) {
      check.expectGt("thrust burns fuel at every size", marathon, 0.5);
      check.expectGt(
        "a Quick mine burns thrust faster than Standard",
        quick,
        standard,
      );
      check.expectGt(
        "a Standard mine burns thrust faster than Marathon",
        standard,
        marathon,
      );
      check.expectGt(
        "a Quick mine burns well over twice a Marathon's thrust",
        quick,
        marathon * 2,
      );
    },
  };
}
