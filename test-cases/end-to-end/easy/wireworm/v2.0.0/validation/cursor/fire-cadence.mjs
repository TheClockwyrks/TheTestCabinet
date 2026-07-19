// Automated validation for cursor.fire-cadence: held fire respects a minimum
// interval between bolts (~0.15 s) and never puts more than three bolts in flight.
//
// Fire is held with injected input (so it flows through the real updateFiring
// cadence, not the debug fire() that bypasses it). Within the first 0.15 s only one
// bolt appears (cadence); over a longer hold the bolts-in-flight count never exceeds
// three (the cap).

import { freshBoard, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cursor.fire-cadence");

  await freshBoard(api);
  await api.call("setCursor", tileCX(20), 688); // an empty column, so bolts stay in flight

  await api.call("keyDown", "Space");
  // Within the first cadence window only one bolt should have been fired.
  await api.step(0.14);
  check.expectLe("at most one bolt within the ~0.15 s cadence window", (await api.snapshot()).bolts.length, 1);

  // Hold and sample: the bolts-in-flight count is capped at three.
  let maxBolts = 0;
  for (let i = 0; i < 120; i++) {
    await api.step(0.0125);
    maxBolts = Math.max(maxBolts, (await api.snapshot()).bolts.length);
  }
  await api.call("keyUp", "Space");
  check.expectGt("holding fire does put bolts in flight", maxBolts, 0);
  check.expectLe("never more than three bolts in flight at once", maxBolts, 3);

  // A live clip of held fire with the bolts capped.
  await freshBoard(api);
  await api.call("setCursor", tileCX(20), 688);
  await api.call("setAutoStep", true);
  await api.call("keyDown", "Space");
  await api.wait(1200);
  await api.call("keyUp", "Space");

  return check.verdict();
}
