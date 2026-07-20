// Automated validation for the Drones sub-item `flux-shimmer-immune`.
//
// During its shimmer a Flux has no settled band, so no shot destroys it; a matching
// shot during a held window does. A Flux is posed mid-shimmer (fluxClock in the
// telegraph) and a matching-band shot fired — the real collision leaves it alive;
// then a Flux posed in a held window takes a matching shot and dies.

import { startClean, spawnDrone, findDrone, shootDrone, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("drones.flux-shimmer-immune");

  // Mid-shimmer: a matching shot must NOT destroy it.
  await startClean(api);
  const shimmerId = await spawnDrone(api, {
    kind: "flux",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
    fluxClock: 1.7, // inside the 1.6–2.0s shimmer window
  });
  await api.step(0.02); // let updateFlux register the shimmer
  check.expectOk("the Flux is shimmering", findDrone(await api.snapshot(), shimmerId).shimmer === true);
  await shootDrone(api, shimmerId, "cyan"); // its held band, but it is mid-shimmer
  await api.step(0.2);
  check.expectOk(
    "a matching shot does not kill a shimmering Flux",
    findDrone(await api.snapshot(), shimmerId) !== null,
  );

  // Held window: a matching shot DOES destroy it.
  await api.call("clearField");
  const heldId = await spawnDrone(api, {
    kind: "flux",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
    fluxClock: 0.5, // inside the held window
  });
  await api.step(0.02);
  check.expectOk("the Flux is settled (held)", findDrone(await api.snapshot(), heldId).shimmer === false);
  await shootDrone(api, heldId, "cyan");
  await api.step(0.2);
  check.expectEq(
    "a matching shot kills a held Flux",
    findDrone(await api.snapshot(), heldId),
    null,
  );

  await clip(api, 1200);
  return check.verdict();
}
