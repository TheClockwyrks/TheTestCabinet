// Automated validation for the Polarity sub-item `flip-instant`.
//
// Flipping bands is instant: the ship's band changes the moment the flip is
// triggered, with no delay. The ship's band is posed, a REAL flip performed, and
// the band read back immediately (no step) — the change is instantaneous.

import { startClean, liveWaveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.flip-instant");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  check.expectEq("the ship starts on the posed band", (await api.snapshot()).ship.band, "cyan");
  await api.call("flip");
  // No step: read the band the instant the flip happened.
  check.expectEq("the flip changes the band instantly", (await api.snapshot()).ship.band, "magenta");
  // And back the other way.
  await api.call("flip");
  check.expectEq("a second flip returns the band instantly", (await api.snapshot()).ship.band, "cyan");

  await liveWaveClip(api);
  return check.verdict();
}
