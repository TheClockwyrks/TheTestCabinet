// Automated validation for combos.recipe-book: the COMBOS overlay opens an in-game reference
// of every combination tower. This confirms the overlay is reachable and captures it; how the
// book reads and lays out is judged by eye from the capture.

import { startBuild, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combos.recipe-book");

  await startBuild(api);
  await api.call("press", "KeyV"); // toggle the combinations recipe book
  const s = await snap(api);
  check.expectEq("the combinations recipe book overlay is open", s.overlays.combos, true);

  await api.screenshot("book");
  return check.verdict();
}
