// Automated validation for the Progression item `timer-life`.
//
// Letting the crossing timer run out costs a life. The timer is set near zero and
// the real simulation runs it out into a death, which the snapshot reads back. See
// validation/_helpers.mjs.

import { startCrossing, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("progression.timer-life");

  await startCrossing(api);
  await api.call("setLives", 3);
  await api.call("setTimer", 0.05);
  const r = await stepUntil(api, (s) => s.phase === "dying", 1);
  check.expectOk("the timer running out costs a life", r.hit);
  check.expectEq("a life is lost when the timer expires", r.snap.lives, 2);

  // Clip: the timer draining to a death in real time.
  await startCrossing(api);
  await api.call("setTimer", 0.7);
  await api.call("setAutoStep", true);
  await api.wait(1300);

  return check.verdict();
}
