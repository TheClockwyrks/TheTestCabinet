// Automated validation for the Controls sub-item `flip-key`.
//
// The flip key (F, or either Shift) flips the ship's band. Each binding is pressed
// through injected input and the resulting band read back — the same flip the game
// uses, through the real key handling.

import { startClean, liveWaveClip } from "../_helpers.mjs";

const band = async (api) => (await api.snapshot()).ship.band;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.flip-key");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("press", "KeyF");
  check.expectEq("F flips the band", await band(api), "magenta");
  await api.call("press", "ShiftLeft");
  check.expectEq("Left Shift flips the band", await band(api), "cyan");
  await api.call("press", "ShiftRight");
  check.expectEq("Right Shift flips the band", await band(api), "magenta");

  await liveWaveClip(api);
  return check.verdict();
}
