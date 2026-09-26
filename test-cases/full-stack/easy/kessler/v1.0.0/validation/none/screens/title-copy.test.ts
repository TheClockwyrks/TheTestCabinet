// screens/title-copy — the title screen draws its copy.
//
// specs/screens.md, on `title`: "Shows the title, `KESSLER`, and the menu"
// whose entries are `START` and `HOW TO PLAY`. The reading is of what the
// frame drew, as text, wherever and however the build laid it out.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { drewText } from "../case-harness/text";
import { TITLE_COPY, TITLE_MENU } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws KESSLER and both menu entries on the title frame", async () => {
  await h.reset();
  const { calls } = await h.frameDraw();
  await captureStill(h, "title");

  assertTrue(
    drewText(calls, TITLE_COPY),
    "the KESSLER heading drawn on the title frame",
  );
  assertTrue(
    drewText(calls, TITLE_MENU[0]),
    "the START entry drawn on the title frame",
  );
  assertTrue(
    drewText(calls, TITLE_MENU[1]),
    "the HOW TO PLAY entry drawn on the title frame",
  );
});
