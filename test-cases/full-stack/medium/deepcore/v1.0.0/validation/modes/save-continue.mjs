// Automated validation for modes.save-continue.
//
// Saving at the surface Save Pad writes the single slot, and the main menu's Continue resumes the
// saved expedition exactly. We bank an identifiable Credits balance, save, return to the title, and
// take Continue.

import { newRun, press, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.save-continue");

  await newRun(api);
  await api.call("grantCredits", 777);
  await api.call("save");
  check.expectEq("the expedition is saved", (await api.snapshot()).hasSave, true);

  await api.reset(); // back to the title; the save persists
  const title = await api.snapshot();
  check.expectEq("the title is up", title.screen, "title");
  check.expectEq("the save is still present", title.hasSave, true);

  await press(api, "Enter"); // CONTINUE is the first menu entry when a save exists
  const resumed = await api.snapshot();
  check.expectEq("Continue resumes the expedition", resumed.screen, "in-mine");
  check.expectEq("the saved Credits are restored", resumed.credits, 777);

  await liveClip(api, 500);
  return check.verdict();
}
