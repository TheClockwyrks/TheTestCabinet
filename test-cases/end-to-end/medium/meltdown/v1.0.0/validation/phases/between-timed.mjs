// Automated validation for the Phases sub-item `between-timed`.
//
// The between-wave build phases carry a ~15-second countdown that auto-starts the
// next wave when it expires (specs/economy.md, states.md). We enter the build phase
// before wave 2, confirm the countdown is running and ticks down, then let it expire
// and confirm the next wave auto-starts.

import { newGame, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("phases.between-timed");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  await api.call("setWave", 2); // a timed between-wave build phase
  const start = await api.snapshot();
  check.expectEq("the between-wave phase is a timed building phase", start.phase, "building");
  check.expectClose("its countdown starts near 15s", start.buildTimer, 15, 0.5);

  await api.step(3);
  const mid = await api.snapshot();
  check.expectLt("the countdown ticks down", mid.buildTimer, start.buildTimer);

  const r = await stepUntil(api, (s) => s.phase === "wave", 20, 0.2);
  check.expectOk("the countdown expiring auto-starts the next wave", r.hit);
  check.expectEq("it auto-starts wave 2", (await api.snapshot()).wave, 2);

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  await api.call("setWave", 2);
  await liveClip(api, 1600);
  return check.verdict();
}
