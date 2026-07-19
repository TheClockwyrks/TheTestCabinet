// Campaign: the six levels of specs/levels.md load in order, each with its own name. Each
// is entered through the debug API and its number/name read back; the level-select screen
// is captured for the reviewer.

import { settle } from "../_helpers.mjs";

const NAMES = ["First Shift", "The Yard", "Trestle", "Interchange", "Rush Hour", "Last Train Out"];

export default async function drive(api, ttc) {
  const check = ttc.checkOne("campaign.six-levels");

  await api.reset();
  check.expectEq("the campaign has six levels", (await api.snapshot()).campaign.levelCount, 6);

  for (let n = 1; n <= 6; n++) {
    await api.call("startLevel", n);
    const lvl = (await api.snapshot()).level;
    check.expectEq(`level ${n} loads in order`, lvl.number, n);
    check.expectEq(`level ${n} is named "${NAMES[n - 1]}"`, lvl.name, NAMES[n - 1]);
  }

  await api.reset();
  await api.call("press", "Enter"); // PLAY → level-select
  await settle(api, 150);
  check.expectEq("the level-select screen is reached", (await api.snapshot()).screen, "level-select");
  await api.screenshot("levels");
  return check.verdict();
}
