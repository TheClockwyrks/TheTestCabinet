// Automated validation for the Rime sub-item `degrades-with-heat`.
//
// The Rime's slow fraction falls as it heats, degrading to nothing at the trip — it
// runs the heat rule backward (specs/heat.md). Heat is posed across the range as a
// precondition and the real slow-fraction the game reports is read back at each
// step; it must fall monotonically to ~0 at 100.

import { newGame, build, tower } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rime.degrades-with-heat");

  await newGame(api, "containment", "medium", 100000);
  const rime = await build(api, "rime", 12, 12);

  const heats = [0, 25, 50, 75, 100];
  const slows = [];
  for (const h of heats) {
    await api.call("setHeat", rime, h);
    slows.push((await tower(api, rime)).slowFactor);
  }

  check.expectClose("a cold Rime slows at its full ceiling", slows[0], 0.55, 0.02);
  check.expectClose("a fully-hot Rime no longer slows", slows[4], 0, 0.01);
  for (let i = 1; i < slows.length; i += 1) {
    check.expectLt(`the slow at heat ${heats[i]} is weaker than at ${heats[i - 1]}`, slows[i], slows[i - 1]);
  }

  await api.call("setHeat", rime, 0);
  await api.wait(80);
  await api.screenshot("degrade");
  return check.verdict();
}
