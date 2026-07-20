// Automated validation for the overload variant's Mode sub-item `mode.shard-overload`.
//
// A Shard driven to overload launches a fast headlong dive toward the player's x,
// faster than a normal dive. A Shard is posed off to one side with the ship far
// away, brought to the brink (setDroneCharge), and tipped over by a real mismatched
// shot; its plunge is stepped forward and its speed and heading read back.

import {
  startClean,
  spawnDrone,
  findDrone,
  shootDrone,
  stepUntil,
  DIVE_SPEED,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("mode.shard-overload");

  await startClean(api);
  await api.call("setShipX", 300); // far to the left of the drone
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 900,
    y: 200,
    phase: "formation",
  });
  await api.call("setDroneCharge", id, 2);
  await shootDrone(api, id, "magenta"); // tips it into overload
  const dived = await stepUntil(api, (s) => {
    const d = findDrone(s, id);
    return d !== null && d.phase === "diving";
  }, 0.5);
  check.expectOk("the overloaded Shard launches a dive", dived.hit);

  // Measure its plunge speed over a short window...
  const a = findDrone(await api.snapshot(), id);
  await api.step(0.1);
  const b = findDrone(await api.snapshot(), id);
  const speed = Math.hypot(b.x - a.x, b.y - a.y) / 0.1;
  check.expectGt("the headlong plunge is faster than a normal dive", speed, DIVE_SPEED * 1.2);

  // ...and confirm, over a longer window, that it bends toward the player's x.
  let minX = Math.min(a.x, b.x);
  for (let i = 0; i < 20; i += 1) {
    await api.step(0.02);
    const d = findDrone(await api.snapshot(), id);
    if (!d || d.phase !== "diving") break;
    minX = Math.min(minX, d.x);
  }
  check.expectLt("the plunge heads toward the player's x", minX, 800);

  await clip(api, 1200);
  return check.verdict();
}
