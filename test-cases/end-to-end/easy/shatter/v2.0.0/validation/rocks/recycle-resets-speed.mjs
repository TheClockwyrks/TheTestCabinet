// Automated validation for the Rocks item `recycle-resets-speed`: a rock recycled by the
// star re-enters at a fresh base drift speed, so a rock slung through the well repeatedly
// never keeps accelerating. A rock is fired hard into the core (where gravity whips it to
// a high speed); once the star recycles it, the replacement's speed must be back in the
// base drift band, far below the peak it reached on the way in.

import { newGame, stepUntilRecycled, speedOf, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rocks.recycle-resets-speed");

  await newGame(api);
  await api.call("addRock", "small", { x: 640, y: 180, vx: 0, vy: 260 });

  const { recycled, snap, peakSpeed } = await stepUntilRecycled(api, { maxSeconds: 2 });
  const recycledSpeed = recycled ? speedOf(snap.rocks[0]) : 0;

  check.expectOk("the rock was recycled by the star", recycled);
  check.expectGt("gravity whipped the rock to a high speed before recycling", peakSpeed, 350);
  check.expectLt("the recycled rock re-enters at a modest base drift speed", recycledSpeed, 300);
  check.expectLt("the recycle does not keep the slingshot speed", recycledSpeed, peakSpeed * 0.6);

  await newGame(api);
  await api.call("addRock", "small", { x: 640, y: 180, vx: 0, vy: 260 });
  await liveClip(api, 900);
  return check.verdict();
}
