// Automated validation for the Saucer item `spawns-one`: a saucer appears on demand and
// at most one exists at a time. A saucer is spawned and confirmed present; a second spawn
// request must not replace or add another (the same saucer stays), and removing it clears
// the field.

import { newGame, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("saucer.spawns-one");

  await newGame(api);
  await api.call("spawnSaucer");
  const first = (await api.snapshot()).saucer;
  check.expectOk("a saucer appears on demand", Boolean(first));

  await api.call("spawnSaucer"); // a second request while one is already present
  const second = (await api.snapshot()).saucer;
  check.expectOk("there is still a saucer", Boolean(second));
  check.expectClose("no second saucer is spawned — the first is unchanged", second.x, first.x, 0.001);

  await api.call("removeSaucer");
  check.expectEq("the saucer can leave the field", (await api.snapshot()).saucer, null);

  await api.call("spawnSaucer");
  await liveClip(api, 800);
  return check.verdict();
}
