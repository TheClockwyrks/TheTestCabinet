// Automated validation for states.mapselect: the map-select state is reachable from the title.

import { snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.mapselect");

  await api.reset();
  await api.wait(80);
  await api.call("press", "Enter"); // confirm SALVAGE at the title
  check.expectEq("the map-select screen is reachable", (await snap(api)).screen, "mapselect");

  await api.screenshot("mapselect");
  return check.verdict();
}
