// Automated validation for the Scoring sub-item `high-score-persists`.
//
// The BEST score persists across sessions via localStorage. This check confirms the
// automatable half — a BEST established by real play survives returning to the title
// (reset) within the session and still reads back — and captures the title so the
// reviewer can spot-check that it also survives a real page reload (the full
// cross-session persistence a script cannot force in one page).

import { eatSequence, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.high-score-persists");

  await beginRound(api);
  await eatSequence(api, { count: 3 });
  const best0 = (await api.snapshot()).best;
  check.expectGt("a BEST was established by real play", best0, 0);

  await api.reset(); // return to the title
  const s = await api.snapshot();
  check.expectEq("BEST survives returning to the title", s.best, best0);
  check.expectEq("the title is showing", s.screen, "title");

  await api.wait(120);
  await api.screenshot("persist");
  return check.verdict();
}
