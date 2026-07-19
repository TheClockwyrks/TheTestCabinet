// Automated validation for the Controls item `one-tile`.
//
// A single press moves exactly one tile — even if the simulation then runs for a
// while — because a tap is consumed once. A held direction key, by contrast,
// auto-repeats hops at the hop cooldown. Both are driven with real injected input
// down the game's own play code. See validation/_helpers.mjs.

import { hopPocket } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.one-tile");

  // A single press moves exactly one tile, even across a long step.
  await hopPocket(api);
  const b1 = (await api.snapshot()).critter;
  await api.call("press", "ArrowLeft");
  await api.step(0.6);
  const a1 = (await api.snapshot()).critter;
  check.expectEq("a single press moves exactly one tile", b1.col - a1.col, 1);

  // A held key auto-repeats several hops over the same span.
  await hopPocket(api);
  const b2 = (await api.snapshot()).critter;
  await api.call("keyDown", "ArrowLeft");
  await api.step(0.6);
  await api.call("keyUp", "ArrowLeft");
  const a2 = (await api.snapshot()).critter;
  check.expectGt("a held key auto-repeats more than one hop", b2.col - a2.col, 1);

  // Clip: a tap, a pause, then a held run in real time.
  await hopPocket(api);
  await api.wait(200);
  await api.call("press", "ArrowLeft");
  await api.wait(400);
  await api.call("keyDown", "ArrowLeft");
  await api.wait(500);
  await api.call("keyUp", "ArrowLeft");
  await api.wait(200);

  return check.verdict();
}
