// Automated validation for the Hunter item `stays-ahead`.
//
// Steady forward hopping down a clear column reaches the far shore without being
// caught — the bear is a touch slower than a cleanly-played critter. A safe
// corridor is built at a bay column and the critter climbs it with a held key while
// a bear trails; the real pursuit never catches it before it completes the
// crossing. See validation/_helpers.mjs.

import { startCrossing, buildSafeColumn, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.stays-ahead");

  await startCrossing(api);
  await buildSafeColumn(api, 19); // col 19 is bay 2's left tile
  await api.call("placeCritter", 19, 19);

  let dead = false;
  await api.call("keyDown", "ArrowUp");
  const r = await stepUntil(
    api,
    (s) => {
      if (s.phase === "dying") {
        dead = true;
        return true;
      }
      return s.bays[2] === true || s.phase === "clearing";
    },
    6,
    0.05,
  );
  await api.call("keyUp", "ArrowUp");

  check.expectOk("a cleanly-hopped crossing is completed", r.hit && !dead);
  check.expectOk("the bear never caught the fast critter", !dead);
  check.expectEq("the crossing kept all lives", (await api.snapshot()).lives, 3);

  // Clip: the climb outrunning the bear in real time.
  await startCrossing(api);
  await buildSafeColumn(api, 19);
  await api.call("placeCritter", 19, 19);
  await api.call("setAutoStep", true);
  await api.call("keyDown", "ArrowUp");
  await api.wait(3000);
  await api.call("keyUp", "ArrowUp");
  await api.wait(400);

  return check.verdict();
}
