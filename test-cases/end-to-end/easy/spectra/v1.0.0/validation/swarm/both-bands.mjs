// Automated validation for the Swarm sub-item `both-bands`.
//
// The assembled formation holds drones of both bands — at least one cyan and one
// magenta — so clearing it forces flipping. A real stage is assembled by stepping
// the real entrance systems, and the formation's bands are read from snapshot().

import { startStageClean } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("swarm.both-bands");

  await startStageClean(api, 1, { clear: false });
  await api.step(8); // let the whole formation assemble

  const snap = await api.snapshot();
  const formed = snap.drones.filter((d) => d.phase === "formation");
  const cyan = formed.filter((d) => d.band === "cyan").length;
  const magenta = formed.filter((d) => d.band === "magenta").length;
  check.expectGt("the formation holds at least one cyan drone", cyan, 0);
  check.expectGt("the formation holds at least one magenta drone", magenta, 0);

  await api.wait(120); // let a frame paint the assembled formation
  await api.screenshot("formation");
  return check.verdict();
}
