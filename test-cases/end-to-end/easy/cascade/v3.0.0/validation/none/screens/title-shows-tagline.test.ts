// screens/title-shows-tagline — the title screen draws `TAGLINE_TEXT`.
//
// `specs/screens.md`, the `title` screen's element table: Tagline,
// `TAGLINE_TEXT`, `KLONDIKE SOLITAIRE`. The literal it names is the text that is
// drawn.
//
// It is capped at `great` because a missing tagline costs a player nothing at the
// table: it names the game the build is, and a build without it still deals,
// plays and wins. The title itself (`screens/title-shows-title`) and the two menu
// items (`screens/title-shows-items`) are separate items, and cost more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import { openTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`draws "${TAGLINE_TEXT}" on the title screen`, async () => {
  await openTitle(h);

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual(
    drewText(calls, TAGLINE_TEXT),
    true,
    `the title screen draws "${TAGLINE_TEXT}" (specs/screens.md)`,
  );
});
