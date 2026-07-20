// Cargo: taking a dispenser's package marks it not-ready, and it replenishes after its
// short refill delay — so the level can never soft-lock. Level 1's red dispenser (3,13)
// is one tile from the spawn (3,14); a real E press takes its package.

import { pressStep, setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cargo.dispenser-refill");

  await startFresh(api, 1);
  await setTile(api, 3, 14);
  check.expectEq("the dispenser starts ready", (await api.snapshot()).dispensers[0].ready, true);

  await pressStep(api, "KeyE");
  const taken = await api.snapshot();
  check.expectEq("taking its package carries one", taken.worker.carried.length, 1);
  check.expectEq("the dispenser is not ready right after", taken.dispensers[0].ready, false);

  await api.step(1.6); // past the ~1.5 s refill delay
  check.expectEq("the dispenser replenishes after the delay", (await api.snapshot()).dispensers[0].ready, true);

  await liveClip(api, 500);
  return check.verdict();
}
