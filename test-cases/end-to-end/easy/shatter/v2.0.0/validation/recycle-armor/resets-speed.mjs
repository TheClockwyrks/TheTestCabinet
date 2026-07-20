// Automated validation (Warhead) for the Recycle-armor item `resets-speed`: even though a
// recycle preserves a rock's health, it still resets the rock's move speed to a fresh base
// drift, so a rock slung through the star repeatedly does not keep getting faster. A damaged
// Large is fired hard into the core; the recycled rock's speed must be back in the base band,
// far below the peak it reached on the way in.

import { newGame, stepUntilRecycled, speedOf, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("recycle-armor.resets-speed");

  await newGame(api);
  await api.call("addRock", "large", { x: 640, y: 180, vx: 0, vy: 240, health: 2 });

  const { recycled, snap, peakSpeed } = await stepUntilRecycled(api, { maxSeconds: 2 });
  const recycledSpeed = recycled ? speedOf(snap.rocks[0]) : 0;

  check.expectOk("the rock was recycled by the star", recycled);
  check.expectGt("gravity whipped it to a high speed before recycling", peakSpeed, 300);
  check.expectLt("the recycled rock re-enters at a modest base drift speed", recycledSpeed, 260);
  check.expectLt("repeated slinging cannot keep accelerating it", recycledSpeed, peakSpeed * 0.6);

  await newGame(api);
  await api.call("addRock", "large", { x: 640, y: 180, vx: 0, vy: 240, health: 2 });
  await liveClip(api, 900);
  return check.verdict();
}
