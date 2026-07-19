// Automated validation for the Polarity sub-item `flip-lockout`.
//
// A flip imposes a roughly 0.30s fire lockout: firing is blocked immediately after
// a flip and works again once the lockout elapses. A real flip is performed, then
// the fire key is held while the real simulation steps — no bullet appears while
// the lockout stands, and one appears once it clears.

import {
  startClean,
  friendlyBullets,
  FLIP_LOCKOUT,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.flip-lockout");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("flip");
  const afterFlip = (await api.snapshot()).ship;
  check.expectOk("firing is locked out right after a flip", afterFlip.canFire === false);
  check.expectClose("the lockout is about 0.30s", afterFlip.lockout, FLIP_LOCKOUT, 0.02);

  // Hold fire while the lockout still stands (~0.15s): no bullet may spawn.
  await api.call("keyDown", "Space");
  await api.step(0.15);
  check.expectEq(
    "no bullet fires while the lockout stands",
    friendlyBullets(await api.snapshot()).length,
    0,
  );

  // Past the lockout: firing works.
  await api.step(0.2);
  const live = friendlyBullets(await api.snapshot()).length;
  check.expectGt("a bullet fires once the lockout clears", live, 0);
  await api.call("keyUp", "Space");

  await clip(api, 1000);
  return check.verdict();
}
