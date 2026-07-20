// Automated validation for the Economy sub-item `damage-pays`.
//
// Energy is earned by damage dealt, not by kills: stripping a shell pays 1, so a shot that
// strips two shells pays 2. Damage past a unit's last shell pays nothing, so a hard shot on
// a nearly-spent unit pays only what it actually removed. The check covers a posed unit
// with a tower of a known per-shot damage, steps the real sim onto the first hit, and reads
// the energy delta that hit produced.

import { coverAndSpawn, stepUntil, liveClip } from "../_helpers.mjs";

// Step until the covering tower lands its first hit, and return the energy it paid.
// A hit is visible either as energy arriving or as the unit losing shells / dying.
async function firstHitPayout(api, unitId, energy0) {
  const r = await stepUntil(
    api,
    (s) => s.energy !== energy0 || !s.matter.some((u) => u.id === unitId),
    8,
    1 / 60,
  );
  return { paid: r.snap.energy - energy0, resolved: r.hit };
}

async function payoutFor(api, { kind, electrons }) {
  // Energy starts at 0 so the delta is unambiguous, and the tower is bought before the
  // baseline is taken.
  const { unitId } = await coverAndSpawn(api, { kind, type: "atom", electrons });
  await api.call("setEnergy", 0);
  const energy0 = (await api.snapshot()).energy;
  return firstHitPayout(api, unitId, energy0);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.damage-pays");

  // An Emitter strips one shell a shot; a Cleaver strips two.
  const oneOnOne = await payoutFor(api, { kind: "emitter", electrons: 1 });
  check.expectEq("a 1-damage shot pays 1", oneOnOne.paid, 1);

  const oneOnTwo = await payoutFor(api, { kind: "emitter", electrons: 2 });
  check.expectEq("a 1-damage shot on a 2-shell unit pays 1", oneOnTwo.paid, 1);

  const twoOnTwo = await payoutFor(api, { kind: "cleaver", electrons: 2 });
  check.expectEq("a 2-damage shot on a 2-shell unit pays 2", twoOnTwo.paid, 2);

  const twoOnOne = await payoutFor(api, { kind: "cleaver", electrons: 1 });
  check.expectEq("a 2-damage shot on a 1-shell unit pays only 1", twoOnOne.paid, 1);

  await liveClip(api, 800);
  return check.verdict();
}
