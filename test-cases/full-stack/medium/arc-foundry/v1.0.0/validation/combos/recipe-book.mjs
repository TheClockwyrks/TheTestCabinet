// Automated validation for combos.recipe-book: the COMBOS overlay opens an in-game reference
// of every combination tower, read against the live board. This confirms the overlay is
// reachable and captures it with a board that puts all three ingredient states on screen (one
// piece selected, others owned, the rest missing); how the book reads and lays out is judged
// by eye from the capture.

import { startBuild, placeCandidate, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combos.recipe-book");

  await startBuild(api);
  // A few base pieces at known (type, quality) so recipes read as partially covered, with one of
  // them selected so its ingredient reads differently from the ones the player merely owns.
  const coil = await placeCandidate(api, "coil", 1, 6, 6);
  await placeCandidate(api, "capacitor", 1, 9, 6);
  await placeCandidate(api, "emitter", 1, 12, 6);
  await api.call("select", coil.id);
  await api.call("press", "KeyV"); // toggle the combinations recipe book
  const s = await snap(api);
  check.expectEq("the combinations recipe book overlay is open", s.overlays.combos, true);
  check.expectEq("a base piece is selected while the book is open", s.selected, coil.id);

  await api.screenshot("book");
  return check.verdict();
}
