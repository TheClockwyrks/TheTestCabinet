// Automated validation for the `serve-direction` review item (base/gyre variant
// item — base serves toward the receiver).
//
// After a point the next serve travels toward the player who was just scored on
// (the receiver), and the very first serve of a match always goes to the same side
// (player one / left). The serve is launched through the real serve() (via the
// debug serve op) and its direction is read from the ball's vx: negative travels
// left (toward player one), positive travels right (toward player two).

import { driveGoal, startPlaying } from "./_helpers.mjs";

async function firstServeVx(api) {
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
  return (await api.snapshot()).balls[0].vx;
}

export default async function drive(api) {
  // The very first serve of a match always goes toward player one (vx < 0),
  // confirmed across two fresh matches.
  const first1 = await firstServeVx(api);
  const first2 = await firstServeVx(api);
  const firstAlwaysLeft = first1 < 0 && first2 < 0;

  // After player one scores (ball out the RIGHT goal), the right player was scored
  // on: the next serve must travel toward the right (vx > 0).
  await startPlaying(api);
  await driveGoal(api, "right");
  await api.call("serve");
  const afterLeftPoint = (await api.snapshot()).balls[0].vx;

  // After player two scores (ball out the LEFT goal), the next serve must travel
  // toward the left (vx < 0).
  await driveGoal(api, "left");
  await api.call("serve");
  const afterRightPoint = (await api.snapshot()).balls[0].vx;

  const receiverRule = afterLeftPoint > 0 && afterRightPoint < 0;
  const pass = firstAlwaysLeft && receiverRule;

  // A clip: a fresh first serve traveling toward player one (leftward).
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
  await api.wait(1000);

  return {
    verdicts: { "serve-direction": pass },
    notes: {
      "serve-direction": `first serves vx=${first1.toFixed(0)},${first2.toFixed(0)} (both <0=toward P1); after P1 point vx=${afterLeftPoint.toFixed(0)} (>0 toward receiver R); after P2 point vx=${afterRightPoint.toFixed(0)} (<0 toward receiver L)`,
    },
  };
}
