// screens/title-shows-title — the title screen draws `TITLE_TEXT`.
//
// `specs/screens.md` gives the `title` screen a table of elements, and its first
// row is the Title, `TITLE_TEXT`, whose content is `CASCADE`. The file states
// that "Every piece of screen copy below carries the name this specification
// gives it, and the literal text it names is the text that is drawn", so the
// literal is the requirement and the palette, the type and the layout around it
// are not.
//
// The match is by substring and case-insensitive (`drewText`), because a build is
// free to draw the word inside a longer run, and by CASE because the literal the
// specification fixes is upper case while the casing a font renders is the
// build's. The tagline and the two menu items are `screens/title-shows-tagline`
// and `screens/title-shows-items`: three literals, three items, so a build that
// drew one and dropped another grades differently from one that drew all three.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_TEXT } from "../constants";
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

it(`draws "${TITLE_TEXT}" on the title screen`, async () => {
  await openTitle(h);

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `the title screen draws "${TITLE_TEXT}" (specs/screens.md)`,
  );
});
