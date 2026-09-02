// screens/select-confirm-opens-highlighted-challenge — the challenge `confirm`
// opens is the one under the HIGHLIGHT.
//
// THE RULE. "One row is highlighted, drawn distinctly from the rest ... `confirm`
// on an unlocked or solved challenge opens it in the editor"
// (`specs/modes/campaign.md`, The select screen) — the row `confirm` takes is the
// highlighted one, which `specs/controls.md` states as the key's whole effect:
// "`confirm` opens the highlighted challenge when the mode's progression allows",
// and the navigation table gives `confirm` as "Accepts the highlighted item".
// `state.selectIndex` is where that highlight stands
// (`specs/instrumentation.md`, `setSelectIndex`, "Sets the highlighted row of the
// current mode's select screen"), and the challenge that ends up open is reported
// by the snapshot's `challenge`, whose `source` is its mode and whose `index` is
// its row.
//
// THE POSE. Both modes, each on a fresh session, with the highlight moved OFF the
// first row — onto row `2`, which is neither the row an arrival lands on nor the
// row a build that opened "the first one" would open. The campaign's course locks
// the later rows, so its unlocked count is raised to cover the highlighted row
// first: `setUnlockedCount` "Sets how many campaign challenges are open", and
// "`confirm` on an unlocked or solved challenge opens it". The Extras lock
// nothing.
//
// THE VERDICT. The editor's open challenge reports the mode the select screen was
// serving and the row the highlight stood on. Reading both is the point: a build
// that opened the right course at the wrong row, or the right row of the wrong
// course, is reported by one of the two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { MODES } from "../constants";
import {
  captureReplay,
  createHarness,
  openSelect,
  openTitle,
  pressAction,
  progressOf,
  type Harness,
} from "../harness";

/** A row that is neither the first nor the one an arrival lands on. */
const ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the challenge at selectIndex, in that mode, in both modes", async () => {
  for (const mode of MODES) {
    await openTitle(h);
    await openSelect(h, mode);

    const count = progressOf(await h.snapshot(), mode).count;
    assertGreaterThan(
      count,
      ROW,
      `the ${mode} list holds a row ${ROW}, so the highlight can stand off the first`,
    );
    if (mode === "campaign") await h.debug.setUnlockedCount(ROW + 1);
    await h.debug.setSelectIndex(ROW);

    const posed = await h.snapshot();
    assertEqual(
      posed.screen,
      "select",
      `the press under test is made on the ${mode} select screen`,
    );
    assertEqual(
      posed.mode,
      mode,
      `the select screen is serving the ${mode} course`,
    );
    assertEqual(
      posed.selectIndex,
      ROW,
      `the ${mode} highlight stands on the row the press must open`,
    );

    const after = await captureReplay(h, "opened", () =>
      pressAction(h, "confirm"),
    );

    assertEqual(
      after.screen,
      "editor",
      `confirm on the highlighted ${mode} row opens it in the editor`,
    );
    assertNotNull(
      after.challenge,
      `the editor reports the ${mode} challenge the confirm opened`,
    );
    assertEqual(
      after.challenge?.source,
      mode,
      `the challenge opened belongs to the ${mode} course the screen was serving`,
    );
    assertEqual(
      after.challenge?.index,
      ROW,
      `the challenge opened is the ${mode} row the highlight stood on, rather ` +
        "than another row's",
    );
  }
});
