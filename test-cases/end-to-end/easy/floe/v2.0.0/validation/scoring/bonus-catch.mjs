// Automated validation for the Scoring item `bonus-catch`.
//
// A fish appears in an open bay from time to time; completing a crossing into the
// bay holding the fish scores an extra 200 points. A seeded run is stepped until
// the fish appears (read its bay), the critter climbs that bay's column, and the
// score delta of the real bay-filling hop includes the +200 bonus:
// 10 (row) + 50 (bay) + 2*floor(T) (time) + 200 (catch). See validation/_helpers.mjs.

import { startCrossing, stepUntil, poseClimb, climbByPress, BAY_LEFT } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.bonus-catch");

  await startCrossing(api, 7); // seeded, so the fish's bay is reproducible
  const r = await stepUntil(api, (s) => s.fishBay !== null, 12, 0.1);
  check.expectOk("a bonus-catch fish appears in an open bay", r.hit);
  const fishBay = r.snap.fishBay;

  await poseClimb(api, BAY_LEFT[fishBay]); // climb the fish's bay column
  await climbByPress(api, "ArrowUp", 2);
  await api.call("setTimer", 10);
  const before = (await api.snapshot()).score;
  check.expectEq("the fish is still in its bay before the hop", (await api.snapshot()).fishBay, fishBay);
  await api.call("press", "ArrowUp"); // fill the fish's bay
  await api.step(0.2);
  const s = await api.snapshot();
  check.expectEq("the crossing filled the fish's bay", s.bays[fishBay], true);
  // 10 (row) + 50 (bay) + 2*floor(T) (time, T~=10) + 200 (catch). The per-second
  // time term may land one second either way depending on the exact sub-second the
  // fill resolves, so the delta is checked within one time-bonus unit; the +200
  // catch it confirms swamps that slack.
  check.expectClose("landing in the fish's bay adds a +200 bonus", s.score - before, 10 + 50 + 2 * 10 + 200, 3);

  // Clip: the fish, then the crossing into its bay, in real time.
  await startCrossing(api, 7);
  await stepUntil(api, (s) => s.fishBay !== null, 12, 0.1);
  const fb = (await api.snapshot()).fishBay;
  await poseClimb(api, BAY_LEFT[fb]);
  await api.call("keyDown", "ArrowUp");
  await api.wait(2600);
  await api.call("keyUp", "ArrowUp");
  await api.wait(500);

  return check.verdict();
}
