// Automated validation for the overload variant's Mode sub-item `mode.overload-resets`.
//
// When a drone reaches three charge it overloads (performing its per-type reaction)
// and its charge resets to zero. A Shard is posed at two charge (a precondition via
// setDroneCharge); one more real mismatched shot tips it to three, which overloads
// it — its charge is read back at zero and its reaction (a Shard leaving formation
// to dive) confirmed.

import { startClean, spawnDrone, findDrone, shootDrone, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("mode.overload-resets");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
  });
  await api.call("setDroneCharge", id, 2); // one short of overloading

  await shootDrone(api, id, "magenta"); // the tipping wrong-band hit
  await stepUntil(api, (s) => {
    const d = findDrone(s, id);
    return d !== null && d.phase === "diving";
  }, 0.5);

  const d = findDrone(await api.snapshot(), id);
  check.expectOk("the overloaded drone is still on the field", d !== null);
  if (d) {
    check.expectEq("the charge resets to zero after overloading", d.charge, 0);
    check.expectEq("the Shard's overload reaction sends it diving", d.phase, "diving");
  }

  await clip(api, 1200);
  return check.verdict();
}
