// Automated validation for the Polarity sub-item `resonance-kill-fills`.
//
// A matching kill feeds the resonance meter (about 4 of 100). A Prism's CORE kill
// counts; breaking its SHELL does not. Each kill is a real collision (posed drone,
// matching shot, stepped forward); the resonance gain is read back. Zeroing the
// meter between kills isolates each contribution.

import {
  startClean,
  spawnDrone,
  shootDrone,
  findDrone,
  stepUntil,
  RES_KILL,
  liveWaveClip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.resonance-kill-fills");

  // A Shard kill feeds resonance.
  await startClean(api);
  await api.call("setResonance", 0);
  const shard = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
  });
  await shootDrone(api, shard, "cyan");
  const a = await stepUntil(api, (s) => findDrone(s, shard) === null, 0.5);
  check.expectClose("a Shard kill adds about 4 resonance", a.snap.resonance, RES_KILL, 0.01);

  // A Prism's shell break feeds NO resonance; its core kill does. Start a fresh
  // wave (killing the lone Shard above cleared the field and ended that wave).
  await startClean(api);
  await api.call("setResonance", 0);
  const prism = await spawnDrone(api, {
    kind: "prism",
    band: "cyan",
    shellBand: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
  });
  await shootDrone(api, prism, "cyan"); // matches the shell -> breaks it
  await stepUntil(api, (s) => {
    const d = findDrone(s, prism);
    return d !== null && d.shellAlive === false;
  }, 0.5);
  check.expectClose(
    "breaking the Prism shell adds no resonance",
    (await api.snapshot()).resonance,
    0,
    0.01,
  );

  await shootDrone(api, prism, "magenta"); // matches the exposed core -> kills it
  const c = await stepUntil(api, (s) => findDrone(s, prism) === null, 0.5);
  check.expectClose("the Prism core kill adds about 4 resonance", c.snap.resonance, RES_KILL, 0.01);

  await liveWaveClip(api);
  return check.verdict();
}
