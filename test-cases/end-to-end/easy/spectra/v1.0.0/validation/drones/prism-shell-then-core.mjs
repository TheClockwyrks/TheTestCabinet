// Automated validation for the Drones sub-item `prism-shell-then-core`.
//
// A Prism is broken in two bands in order: the shell falls only to the shell's
// band (exposing the core), then the core falls only to the opposite band. A Prism
// is posed and hit in sequence — a mismatch leaves the shell; the shell's band
// breaks it and the stored band becomes the core's; the core's band destroys the
// drone. Every hit is a real collision.

import { startClean, spawnDrone, findDrone, shootDrone, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("drones.prism-shell-then-core");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "prism",
    band: "cyan",
    shellBand: "cyan", // core is the opposite (magenta)
    x: 640,
    y: 300,
    phase: "formation",
  });

  // A mismatch on the shell (magenta vs a cyan shell) does not break it.
  await shootDrone(api, id, "magenta");
  await api.step(0.2);
  let d = findDrone(await api.snapshot(), id);
  check.expectOk("a mismatched shot leaves the shell intact", d !== null && d.shellAlive === true);

  // The shell's band breaks the shell and exposes the core.
  await shootDrone(api, id, "cyan");
  await stepUntil(api, (s) => {
    const x = findDrone(s, id);
    return x !== null && x.shellAlive === false;
  }, 0.5);
  d = findDrone(await api.snapshot(), id);
  check.expectOk("the shell's band breaks the shell", d !== null && d.shellAlive === false);
  check.expectEq("the exposed core's band becomes current", d.band, "magenta");

  // The core's band (opposite) destroys the drone.
  await shootDrone(api, id, "magenta");
  const r = await stepUntil(api, (s) => findDrone(s, id) === null, 0.5);
  check.expectOk("the core's band destroys the Prism", r.hit);

  await clip(api, 1200);
  return check.verdict();
}
