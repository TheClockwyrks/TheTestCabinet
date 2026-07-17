// Automated validation for the `scoring-point` review item.
//
// A ball fully crossing a goal edge (x < 0 or x > 1280) scores a point for the
// player on the opposite side and increments the correct score. The ball is aimed
// at a goal (a precondition); the real simulation carries it across the edge and
// the real scoring code increments the score, which we read back. Both goals are
// exercised so the score increments on the correct side.

import { driveGoal, clearPaddles, startPlaying } from "./_helpers.mjs";

export default async function drive(api) {
  await startPlaying(api);
  await api.call("setScore", 0, 0);

  // Right goal (x > 1280): player one (left) scores.
  const r1 = await driveGoal(api, "right");
  const rightGoal = r1.score.p1 === 1 && r1.score.p2 === 0;

  // Left goal (x < 0): player two (right) scores; p1 stays at 1.
  await api.call("serve");
  const r2 = await driveGoal(api, "left");
  const leftGoal = r2.score.p2 === 1 && r2.score.p1 === 1;

  const pass = rightGoal && leftGoal;

  // A clip: a ball crossing the right goal and scoring.
  await api.call("serve");
  await clearPaddles(api);
  await api.call("setBall", 0, { x: 900, y: 360, vx: 620, vy: 0, spin: 0 });
  await api.wait(1500);

  return {
    verdicts: { "scoring-point": pass },
    notes: {
      "scoring-point": `right-goal -> p1=${r1.score.p1},p2=${r1.score.p2}; left-goal -> p1=${r2.score.p1},p2=${r2.score.p2}`,
    },
  };
}
