// Automated validation for the Stages sub-item `scaling`.
//
// Deeper stages scale up: a diving drone moves faster at a late stage than at
// stage 1, and the Flux's held window is shorter. Both are measured off the REAL
// systems — a real dive's per-second displacement, and the real time a Flux holds
// before it shimmers — at stage 1 and stage 10.

import { spawnDrone, findDrone, stepUntil, liveWaveClip } from "../_helpers.mjs";

// The per-second speed of a real dive early in its run, at `stage`.
async function diveSpeed(api, stage) {
  await api.reset({ seed: 1 });
  await api.call("startStage", stage);
  await api.call("clearField");
  const id = await spawnDrone(api, { kind: "shard", band: "cyan", x: 640, y: 200, phase: "formation" });
  await api.step(0.05); // arm the dive systems
  await api.call("forceDive", id);
  const a = findDrone(await api.snapshot(), id);
  await api.step(0.1);
  const b = findDrone(await api.snapshot(), id);
  return Math.hypot(b.x - a.x, b.y - a.y) / 0.1;
}

// The seconds a Flux holds its band before it first shimmers, at `stage`.
async function fluxHold(api, stage) {
  await api.reset({ seed: 1 });
  await api.call("startStage", stage);
  await api.call("clearField");
  const id = await spawnDrone(api, {
    kind: "flux",
    band: "cyan",
    x: 640,
    y: 200,
    phase: "formation",
    fluxClock: 0,
  });
  const r = await stepUntil(api, (s) => {
    const d = findDrone(s, id);
    return d !== null && d.shimmer === true;
  }, 3, 0.02);
  return r.snap.simTime;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stages.scaling");

  const dive1 = await diveSpeed(api, 1);
  const dive10 = await diveSpeed(api, 10);
  check.expectGt("a late-stage dive is faster than a stage-1 dive", dive10, dive1);
  check.expectGt("the late-stage dive is markedly faster (~1.5x)", dive10, dive1 * 1.3);

  const hold1 = await fluxHold(api, 1);
  const hold10 = await fluxHold(api, 10);
  check.expectLt("the Flux hold is shorter at a late stage", hold10, hold1);

  // A live clip of a fast, late-stage assault.
  await liveWaveClip(api, { stage: 10, ms: 1600 });
  return check.verdict();
}
