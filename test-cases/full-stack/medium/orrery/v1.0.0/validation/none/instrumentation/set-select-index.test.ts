// instrumentation/set-select-index — `setSelectIndex` moves the select screen's
// highlight, and `confirm` opens the row it is on.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress:
// "`setSelectIndex(n)` | Sets the highlighted row of the current mode's select
// screen, from `0`." The snapshot reports it as `selectIndex`, "the highlighted
// select row of the current mode" (`specs/state.md`). `specs/modes/campaign.md`
// says what the highlight is for, and `specs/modes/extras.md` adopts it: "One row
// is highlighted, drawn distinctly from the rest... `confirm` on an unlocked or
// solved challenge opens it in the editor."
//
// THE CONFIGURATION. The Extras' select screen, because "Every challenge is
// unlocked from the start and can be entered in any order"
// (`specs/modes/extras.md`) — so `confirm` opens whichever row is posed and the
// check never has to unlock anything first. Three rows are posed in turn, none of
// them the row the screen landed on, and each is opened.
//
// WHAT SAYS WHICH ROW OPENED. `specs/instrumentation.md` fixes what a shipped
// challenge reports: "The snapshot reports it under that `mode` and `index`." So
// the challenge that opens names the row it came from, and `specs/challenges.md`
// — which `specs/modes/extras.md` makes authoritative, "build each exactly as
// written there, in that order" — names what is on that row, which `challenges.ts`
// carries.
//
// THE VERDICT. Each posed row is the highlighted one, and `confirm` from it opens
// that row's challenge: the Extras' challenge at that index, under the name
// `specs/challenges.md` gives it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { EXTRA_NAMES } from "../challenges";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** Three rows away from the first, which is where the screen would land anyway. */
const ROWS = [6, 2, 9];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights the posed row, and confirm opens that row's challenge", async () => {
  await openTitle(h);

  for (const row of ROWS) {
    await openSelect(h, "extras");
    assertEqual(
      (await h.snapshot()).screen,
      "select",
      "the check is on the select screen before posing a row",
    );

    await h.debug.setSelectIndex(row);
    await h.advance(1);
    if (row === ROWS[0]) await captureStill(h, "row");
    assertEqual(
      (await h.snapshot()).selectIndex,
      row,
      `setSelectIndex(${row}) highlights row ${row}`,
    );

    await pressAction(h, "confirm");
    const opened = await h.snapshot();
    assertEqual(opened.screen, "editor", `confirm on row ${row} opened it`);
    assertNotNull(opened.challenge, `row ${row} opened a challenge`);
    assertEqual(
      opened.challenge?.source,
      "extras",
      `the challenge opened from row ${row} is the current mode's`,
    );
    assertEqual(
      opened.challenge?.index,
      row,
      `the challenge opened is the one on row ${row}, not another`,
    );
    assertEqual(
      opened.challenge?.name,
      EXTRA_NAMES[row],
      `row ${row} holds the Extras challenge specs/challenges.md puts there`,
    );

    await h.debug.setScreen("title");
  }
});
