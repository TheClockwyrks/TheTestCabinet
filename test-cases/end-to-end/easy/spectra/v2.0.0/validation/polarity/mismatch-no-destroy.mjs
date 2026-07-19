// Automated validation for the Polarity sub-item `mismatch-no-destroy`.
//
// A player shot whose band is OPPOSITE the drone's current band never destroys it
// (what else it does is the mode's business, specs/mode.md). The drone is posed
// and an opposite-band shot fired into it; the real collision consumes the bullet
// but the drone survives, still in formation. This holds in both modes (Sortie
// wastes the shot; Overload charges the drone) — neither destroys it.

import {
  startClean,
  spawnDrone,
  shootDrone,
  findDrone,
  stepUntil,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.mismatch-no-destroy");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
  });
  await shootDrone(api, id, "magenta"); // opposite band
  // Step well past the moment the shot reaches the drone; it must survive.
  await stepUntil(api, () => false, 0.4);
  const after = findDrone(await api.snapshot(), id);
  check.expectOk("the drone survives an opposite-band shot", after !== null);
  if (after) {
    check.expectEq("the drone keeps its band", after.band, "cyan");
    check.expectEq("the drone stays in formation", after.phase, "formation");
  }

  await clip(api, 1000);
  return check.verdict();
}
