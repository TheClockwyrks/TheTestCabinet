// Movement: sprinting drains the sprint bar; when not sprinting it refills over about
// four seconds from empty to full. Driven unladen on the manual clock so drain and
// refill are exact.

import { setTile, startFresh, liveClip, SPRINT_MAX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.sprint-recharge");

  await startFresh(api, 1);
  await setTile(api, 4, 12);
  check.expectClose("sprint starts full", (await api.snapshot()).worker.sprintCharge, SPRINT_MAX, 1e-6);

  // Sprint for one second: the bar drains one second's worth.
  await api.call("keyDown", "KeyD");
  await api.call("keyDown", "ShiftLeft");
  await api.step(1.0);
  const drained = (await api.snapshot()).worker.sprintCharge;
  check.expectClose("one second of sprint drains one second of charge", drained, SPRINT_MAX - 1.0, 0.03);

  // Stop sprinting and let it refill; ~4 s empty→full, so from ~0.6 a few seconds refills to the cap.
  await api.call("keyUp", "ShiftLeft");
  await api.call("keyUp", "KeyD");
  await api.step(4.5);
  const refilled = (await api.snapshot()).worker.sprintCharge;
  check.expectClose("the bar recharges back to full", refilled, SPRINT_MAX, 1e-3);
  check.expectGt("the refilled bar is fuller than after the drain", refilled, drained);

  await setTile(api, 4, 12);
  await api.call("keyDown", "KeyD");
  await api.call("keyDown", "ShiftLeft");
  await liveClip(api, 900);
  await api.call("keyUp", "KeyD");
  await api.call("keyUp", "ShiftLeft");
  return check.verdict();
}
