// Automated validation for the Stages sub-item `scaling`.
//
// Deeper stages scale up: a diving drone moves faster at a late stage than at
// stage 1, and the Flux's held window is shorter. Both are measured off the REAL
// systems — a real dive's per-second displacement, and the real time a Flux holds
// before it shimmers — at stage 1 and stage 10.

import { spawnDrone, findDrone, SEC_PER_TICK } from "../_helpers.mjs";

// The dive speed is measured across exactly 0.1 s of simulation — 12 ticks — so the
// divisor stays 0.1 and the result stays px/s.
const MEASURE_TICKS = 12;
const MEASURE_SECONDS = 0.1;
const ARM_TICKS = 6; // 6 ticks = the old 0.05 s to arm the dive systems

// The old flux sweep capped at 3 s with a 0.02 s chunk. 0.02 s is 2.4 ticks, which
// the tick contract refuses rather than rounds, so the poll rounds DOWN to 2: this is
// a SAMPLING poll hunting for the instant the shimmer turns on, and reading more
// often can only pin that instant more tightly, never step over it. The cap is the
// same 3 s.
const FLUX_POLL_TICKS = 2;
const FLUX_MAX_TICKS = 360;

/**
 * Re-pose a stage WITHOUT resetting. `startStage` + `clearField` are control ops, so
 * they set the stage and empty the field without touching the step clock — which is
 * what lets all four measurements below live inside `act`, where `reset` is forbidden
 * (it would take the clock back and freeze the recording).
 */
async function poseStage(api, stage) {
  await api.call("startStage", stage);
  await api.call("clearField");
}

// The per-second speed of a real dive early in its run, on the currently posed stage.
async function measureDiveSpeed(api) {
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 200,
    phase: "formation",
  });
  await api.advance(ARM_TICKS);
  await api.call("forceDive", id);
  const a = findDrone(await api.snapshot(), id);
  await api.advance(MEASURE_TICKS);
  const b = findDrone(await api.snapshot(), id);
  return Math.hypot(b.x - a.x, b.y - a.y) / MEASURE_SECONDS;
}

// The seconds a Flux holds its band before it first shimmers, on the posed stage.
//
// The old helper read `snapshot().simTime`, which worked only because it reset first
// and so started from zero. `startStage` deliberately does NOT clear `simTime` (only
// `reset` does), so the elapsed ticks `until` reports are used instead and converted
// back to seconds. That measures the same quantity — time from spawn to shimmer —
// and is what makes the four measurements composable in one uninterrupted phase.
async function measureFluxHold(api) {
  const id = await spawnDrone(api, {
    kind: "flux",
    band: "cyan",
    x: 640,
    y: 200,
    phase: "formation",
    fluxClock: 0,
  });
  const r = await api.until(
    (s) => {
      const d = findDrone(s, id);
      return d !== null && d.shimmer === true;
    },
    { max: FLUX_MAX_TICKS, poll: FLUX_POLL_TICKS },
  );
  return r.spent * SEC_PER_TICK;
}

export default function item() {
  // The four measurements.
  let dive1;
  let dive10;
  let hold1;
  let hold10;

  return {
    id: "stages.scaling",

    // Seeded, on stage 1, field emptied — the first of the four scenarios. The rest
    // are re-posed inside `act` with `startStage`, which needs no reset.
    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startStage", 1);
      await api.call("clearField");
    },

    // All four measurements, back to back. The clip shows a stage-1 dive and then a
    // visibly faster stage-10 dive, which is the comparison the item is about.
    async act(api) {
      dive1 = await measureDiveSpeed(api);

      await poseStage(api, 10);
      dive10 = await measureDiveSpeed(api);

      await poseStage(api, 1);
      hold1 = await measureFluxHold(api);

      await poseStage(api, 10);
      hold10 = await measureFluxHold(api);
    },

    async assert(api, check) {
      check.expectGt(
        "a late-stage dive is faster than a stage-1 dive",
        dive10,
        dive1,
      );
      check.expectGt(
        "the late-stage dive is markedly faster (~1.5x)",
        dive10,
        dive1 * 1.3,
      );
      check.expectLt("the Flux hold is shorter at a late stage", hold10, hold1);
    },
  };
}
