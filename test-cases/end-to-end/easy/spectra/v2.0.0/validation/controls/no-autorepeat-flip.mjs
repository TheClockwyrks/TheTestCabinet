// Automated validation for the Controls sub-item `no-autorepeat-flip`.
//
// Holding the flip key flips the band exactly once, not repeatedly, so a held key
// does not flap the band back and forth. The flip key is pressed down and held
// (never released) while the real sim steps; the band flips once and then stays put.

import { startClean, clip } from "../_helpers.mjs";

const band = async (api) => (await api.snapshot()).ship.band;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.no-autorepeat-flip");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("keyDown", "KeyF"); // held down, never released
  check.expectEq("the held flip flips the band once", await band(api), "magenta");
  // Keep holding while the sim runs: the band must not flap back.
  await api.step(0.5);
  check.expectEq("holding the flip does not flip it again", await band(api), "magenta");
  await api.call("keyUp", "KeyF");

  await clip(api, 800);
  return check.verdict();
}
