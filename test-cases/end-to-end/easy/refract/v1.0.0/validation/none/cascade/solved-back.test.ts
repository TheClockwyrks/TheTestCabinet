// cascade/solved-back — back on the cascade solved screen returns to the title.
//
// specs/modes/cascade.md "The solved screen": "`confirm` takes the highlighted
// item, and `back` returns to `title` with `CASCADE` highlighted
// (`menuIndex = 1`)". The equivalent edge one screen earlier — `back` during
// `playing` — is cascade/cascade-back-to-title's point; this one is the exit
// from the solved screen itself.
//
// THE WORLD IS POSED, not generated. The scenario enters Cascade for real and
// poses its board through `loadBoard` — "a board posed this way is a board like
// any other" (specs/instrumentation.md) — so this point stops depending on the
// generator, which the cascade/generated-* and cascade/tier-* points decide on
// their own. That the forced solve reaches `solved` at all is
// cascade/cascade-solved-reached's point, asserted here as a named
// precondition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  fireAction,
  loadBoard,
  startCascade,
  traceRoute,
  type Harness,
} from "../harness";

/** The forced GEO_3X3 solve: T(0,0) — t(1,1) — T(2,2) (fixtures.ts). */
const GEO_3X3_ROUTE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [2, 2],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("back on the solved screen returns to title with CASCADE highlighted", async () => {
  await startCascade(h);
  await loadBoard(h, GEO_3X3);
  await traceRoute(h, GEO_3X3_ROUTE);

  const solved = await h.snapshot();
  assertEqual(
    solved.screen,
    "solved",
    "precondition: the forced solve reaches the solved screen (see cascade-solved-reached)",
  );

  await fireAction(h, "back");
  await captureStill(h, "title");
  const back = await h.snapshot();
  assertEqual(
    back.screen,
    "title",
    "back on the solved screen returns to title (specs/modes/cascade.md)",
  );
  assertEqual(
    back.menuIndex,
    1,
    "with CASCADE, the entry that led away, highlighted (specs/modes/cascade.md)",
  );
});
