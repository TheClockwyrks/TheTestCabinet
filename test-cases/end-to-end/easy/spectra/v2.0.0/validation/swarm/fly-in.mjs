// Automated validation for the Swarm sub-item `fly-in`.
//
// Drones are absent at the start of a wave: they fly in along entrance paths (phase
// entering) and settle into the formation (phase formation). A real stage is
// started and the real entrance systems are stepped forward; the phases are read
// from snapshot().

import { startStageClean, clip } from "../_helpers.mjs";

const entering = (s) => s.drones.filter((d) => d.phase === "entering").length;
const formation = (s) => s.drones.filter((d) => d.phase === "formation").length;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("swarm.fly-in");

  // Keep the REAL wave (do not clear it).
  await startStageClean(api, 1, { clear: false });

  // Just after launch: drones are flying in, none has assembled yet.
  await api.step(0.2);
  const early = await api.snapshot();
  check.expectGt("drones are flying in near wave start", entering(early), 0);
  check.expectEq("no drone has assembled yet", formation(early), 0);

  // After the entrances complete: the formation has assembled.
  await api.step(8);
  const late = await api.snapshot();
  check.expectGt("the formation assembles", formation(late), 0);
  check.expectEq("no drone is still entering", entering(late), 0);

  // A live clip of a fresh wave flying in.
  await startStageClean(api, 1, { clear: false });
  await clip(api, 2600);
  return check.verdict();
}
