// instrumentation/set-screen-howto — `setScreen("howto")` enters the how-to at its
// first page.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress, in the table of
// what each name does: "`howto` | Shows the how-to, `howtoPage` at `0`", under
// "Enters the screen `name`... exactly as the real transition into it enters it."
// `specs/ui.md` fixes the same figure from the screen's side: "`state.howtoPage`
// names the page shown, `0` on arriving", over "`HOWTO_PAGES` (`5`) pages".
//
// THE CONFIGURATION. A reset session taken to the how-to once and turned to its
// last page, `HOWTO_PAGES - 1`, then taken away to the title. The call under test
// is then the SECOND arrival, from a session that is holding a page other than the
// first — which is what tells "enters at page 0" apart from "leaves the page
// alone".
//
// THE VERDICT. The screen is `howto`, the page is `0`, and the frame drawn after
// the arrival is no longer the picture the last page was drawing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOWTO_PAGES, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  differingShare,
  openHowto,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the how-to at page 0, whatever page it was left on", async () => {
  await openTitle(h);
  await h.debug.setScreen("howto");
  const entered = await h.snapshot();
  assertEqual(entered.screen, "howto", 'setScreen("howto") enters the how-to');
  assertEqual(entered.howtoPage, 0, "the how-to is entered at its first page");

  await h.advance(1);
  const first = await h.pixelRect(0, 0, STAGE_W, STAGE_H);

  await h.debug.setHowtoPage(HOWTO_PAGES - 1);
  await h.advance(1);
  const last = await h.pixelRect(0, 0, STAGE_W, STAGE_H);
  assertGreaterThan(
    differingShare(first, last),
    0,
    "the last page draws something other than the first, so the picture tells them apart",
  );

  await h.debug.setScreen("title");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the session is somewhere else, so the next call is a real arrival",
  );

  await openHowto(h);
  await captureStill(h, "howto");
  const again = await h.snapshot();
  assertEqual(again.screen, "howto", 'setScreen("howto") enters the how-to');
  assertEqual(
    again.howtoPage,
    0,
    "arriving at the how-to shows its first page, whatever page it held",
  );
  assertGreaterThan(
    differingShare(await h.pixelRect(0, 0, STAGE_W, STAGE_H), last),
    0,
    "the frame drawn on the second arrival is no longer the last page's",
  );
});
