// Automated validation for the Drones sub-item `flux-oscillates`.
//
// A Flux alternates its band on a telegraphed rhythm: a held window on one band, a
// brief shimmer settled on neither, then the other band. A Flux is posed at the
// start of its cycle (fluxClock 0) and the real oscillation is stepped through one
// cycle; the held/shimmer/held states are read back from snapshot() at the right
// moments (stage-1 hold 1.6s, shimmer 0.4s).

import { startClean, spawnDrone, findDrone, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("drones.flux-oscillates");

  await startClean(api);
  await api.call("setLives", 9);
  const id = await spawnDrone(api, {
    kind: "flux",
    band: "cyan",
    x: 640,
    y: 200,
    phase: "formation",
    fluxClock: 0,
  });

  // Held on the first band (fluxClock ~0.4, inside the 1.6s hold).
  await api.step(0.4);
  let d = findDrone(await api.snapshot(), id);
  check.expectEq("the Flux holds its first band", d.band, "cyan");
  check.expectOk("it is not shimmering during the held window", d.shimmer === false);

  // Shimmer (fluxClock ~1.75, inside the 1.6–2.0s telegraph).
  await api.step(1.35);
  d = findDrone(await api.snapshot(), id);
  check.expectOk("the Flux shimmers between bands", d.shimmer === true);

  // Held on the OTHER band (fluxClock ~2.5, inside the 2.0–3.6s window).
  await api.step(0.75);
  d = findDrone(await api.snapshot(), id);
  check.expectEq("the Flux emerges holding the other band", d.band, "magenta");
  check.expectOk("it is settled again (not shimmering)", d.shimmer === false);

  await clip(api, 1600);
  return check.verdict();
}
