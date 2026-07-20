// Automated validation for the Polarity sub-item `discharge-clears`.
//
// At full resonance a discharge wipes every entering and diving drone and clears
// all enemy bullets (band-blind), but spares the formation. Divers, a formation
// drone, and enemy bullets are posed, the meter filled, and a REAL discharge fired;
// the expanding wave, stepped forward, resolves what it clears and what it spares.

import {
  startClean,
  spawnDrone,
  findDrone,
  enemyBullets,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.discharge-clears");

  await startClean(api);
  // A formation drone that must SURVIVE the discharge.
  const formId = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 200,
    phase: "formation",
  });
  // Two divers that must be WIPED.
  await spawnDrone(api, { kind: "shard", band: "cyan", x: 300, y: 300, phase: "diving" });
  await spawnDrone(api, { kind: "shard", band: "magenta", x: 980, y: 300, phase: "diving" });
  // Enemy bullets that must be CLEARED.
  await api.call("spawnEnemyBullet", { x: 640, y: 400, band: "cyan" });
  await api.call("spawnEnemyBullet", { x: 520, y: 320, band: "magenta" });

  await api.call("setResonance", 100);
  await api.call("discharge");
  await api.step(0.5); // let the wave expand across the whole field

  const snap = await api.snapshot();
  const survivor = findDrone(snap, formId);
  check.expectOk("the formation drone survives the discharge", survivor !== null);
  if (survivor) check.expectEq("the survivor is still in formation", survivor.phase, "formation");
  check.expectEq(
    "every diving drone is wiped",
    snap.drones.filter((d) => d.phase === "diving").length,
    0,
  );
  check.expectEq("all enemy bullets are cleared", enemyBullets(snap).length, 0);

  // A live clip of the wave sweeping out.
  await startClean(api);
  await spawnDrone(api, { kind: "shard", band: "cyan", x: 400, y: 320, phase: "diving" });
  await spawnDrone(api, { kind: "shard", band: "magenta", x: 900, y: 320, phase: "diving" });
  await api.call("setResonance", 100);
  await api.call("discharge");
  await clip(api, 900);

  return check.verdict();
}
