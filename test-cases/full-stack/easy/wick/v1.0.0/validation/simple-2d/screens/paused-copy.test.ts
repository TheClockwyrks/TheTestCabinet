// screens/paused-copy — the pause screen draws PAUSED over the held world,
// with the pause menu beneath it.
//
// WHAT THIS DECIDES. One thing: the pause frame carries `PAUSED_TEXT`, the HUD
// reading the run as the pause left it, and the pause menu drawn below the
// heading, rather than a bare overlay or a HUD that has moved on. That both
// names of `PAUSE_ITEMS` are on the frame at all is `paused-lists-items`; the
// relation this point reads is where they sit.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "The world held still, with the HUD, under
//   `PAUSED_TEXT` (`PAUSED`), and the menu `PAUSE_ITEMS` below it: `RESUME`,
//   `MAIN MENU`, in that order."
//   specs/ui.md (`playing`, the HUD table): "Clock | The run clock as `m:ss`,
//   counting up from `0:00` in whole seconds, the seconds always two digits",
//   and "Experience | ... labeled with `LEVEL_LABEL` (`LEVEL`) and the current
//   level, as `LEVEL 4`".
//   specs/ui.md ("What advances on each screen"): on `paused` "Nothing. The
//   world beneath holds exactly the tick it was at", so the clock on the pause
//   frame is the clock of the tick the pause found.
//   specs/ui.md ("Presentation"): the screen fixes no palette, font, or
//   styling, and "each screen's layout is yours except where a table below
//   places one element relative to another", which the "below it" above does.
//
// THE DRIVE. An isolated `playing` run with the clock posed to a reading no
// other figure on the HUD shares and a level posed beside it, paused through
// `setScreen("paused")`, which enters the screen "Exactly as `pause` does"
// (specs/instrumentation.md), so a build with a broken pause key fails its own
// point and not this one. One frame is drawn and its runs of text are read.
//
// THE TOLERANCE. The heading is matched as a substring of a run of drawn text
// through the shared harness's `drewText`, ignoring case and whitespace, which
// admits any font, layout, or marker; the clock is matched as a whole token in
// the `m:ss` spelling the specification fixes, and the level as `LEVEL`
// followed by its number with any run of spaces between them, the digits
// standing as their own token, which is how specs/ui.md spells the label. "Below it" is read as a
// strict inequality between the topmost anchor of `PAUSED_TEXT` and that of
// each menu item, which admits any spacing, font, and alignment the build
// chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertTrue } from "../assert";
import { LEVEL_LABEL, PAUSED_TEXT, PAUSE_ITEMS, clockText } from "../constants";
import {
  captureStill,
  createHarness,
  hasToken,
  isolate,
  present,
  textReadings,
  topAnchorOf,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";

let h: Harness;

/** A clock and a level whose spellings no other HUD figure of this scene shares. */
const TICK = 7523;
const LEVEL = 12;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws PAUSED over the HUD of the tick the pause found, the menu below", async () => {
  isolate(h, { level: LEVEL });
  h.debug.setTick(TICK);
  h.debug.setScreen("paused");
  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the frame is read from");
  assertEqual(posed.run.tick, TICK, "the tick the pause held the world at");

  const { calls } = await h.frameDraw();
  captureStill(h, "paused");

  assertTrue(
    drewText(calls, PAUSED_TEXT),
    `the pause frame drew ${PAUSED_TEXT} (specs/ui.md, paused)`,
  );
  // The raw calls and the logical runs they spell, both (`textReadings`): a
  // figure drawn a glyph per call is the number it is off the runs, and one
  // drawn a narrow gap after its label, which the run rule merges into
  // `TIME2:05`, still stands alone as the raw call.
  const lines = textReadings(calls);
  assertTrue(
    hasToken(lines, clockText(TICK)),
    `the HUD's clock reading ${clockText(TICK)}, the tick the pause found`,
  );
  const level = new RegExp(`${LEVEL_LABEL}\\s*${LEVEL}(?![\\w])`, "i");
  assertTrue(
    lines.some((line) => level.test(line)),
    `a run of text reading ${LEVEL_LABEL} ${LEVEL}, the HUD's level`,
  );

  const heading = present(
    topAnchorOf(calls, PAUSED_TEXT),
    `where the frame drew ${PAUSED_TEXT}`,
  );
  for (const item of PAUSE_ITEMS) {
    const anchor = present(
      topAnchorOf(calls, item),
      `where the frame drew ${item}`,
    );
    assertLessThan(
      heading,
      anchor,
      `${PAUSED_TEXT} drawn above ${item}, the menu below the heading`,
    );
  }
});
