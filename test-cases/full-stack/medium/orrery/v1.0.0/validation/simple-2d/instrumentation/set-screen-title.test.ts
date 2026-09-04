// instrumentation/set-screen-title — `setScreen("title")` enters the title menu
// the way arriving at it does.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress: "`setScreen(name)`
// | Enters the screen `name`, one of `title`, `howto`, `select`, and `editor`,
// exactly as the real transition into it enters it, as the table below states",
// whose first row is "`title` | Shows the title menu, `menuIndex` at `titleIndex`,
// exactly as a return from the how-to or a select screen shows it."
//
// THE CONFIGURATION. A reset session, so the remembered title selection stands at
// the `0` a reset leaves it at — nothing has taken a title item, and no pose
// reaches `titleIndex` at all — whose menu highlight is then deliberately moved
// off `0` with `setMenuIndex(2)`, the last of the three `TITLE_ITEMS`, and which
// is taken away to the how-to, so the call under test is a real arrival rather
// than a no-op on the screen it already stood on. What a return lands on once an
// item HAS been taken is `title-returns-to-the-entry-left-from`, next door.
//
// WHY THE HIGHLIGHT IS MOVED FIRST. `menuIndex` rests at `0`, so a build that
// changed the screen and nothing else would pass a check that arrived from a
// resting session. Posing `2` first is what makes `0` afterwards a consequence of
// the arrival.
//
// HOW THE TEXT IS READ. `specs/assets.md` puts every word on the stage on the
// frame as drawn text and fixes no more — "Which typeface carries them is yours" —
// and letter spacing is not portable, so a build is free to draw one run of copy as
// one call, as a call per word, or as a call per glyph. What all of those share is
// the baseline: one line of copy is drawn at one `y`. So the frame's text runs are
// gathered by the `y` their anchor maps to and joined in `x` order, and the match is
// by substring, so a build is free to draw a marker or padding around an item's
// words. `screens/title-draws-menu-items` reads the title frame the same way.
//
// THE VERDICT. The screen is `title` and the highlight is back on the first item,
// and the title really is what is being drawn: the frame after the call puts up the
// title menu's own items rather than the how-to's copy, and pressing `confirm` on
// the highlighted item takes the first of `TITLE_ITEMS` — `CAMPAIGN`, which "Sets
// `state.mode` to `campaign` and goes to `select`" (`specs/ui.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openTitle,
  pressAction,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";

/** One baseline the frame drew text on, and the runs on it read left to right. */
interface Line {
  y: number;
  text: string;
}

/** The frame's text runs, gathered into the baselines they were drawn on. */
function linesOf(draws: readonly TextDraw[]): Line[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of draws) {
    baselines.set(draw.y, [...(baselines.get(draw.y) ?? []), draw]);
  }
  return [...baselines.entries()]
    .map(([y, on]) => ({
      y,
      text: [...on]
        .sort((a, b) => a.x - b.x)
        .map((draw) => draw.text)
        .join(""),
    }))
    .sort((a, b) => a.y - b.y);
}

/** The line the frame drew `text` on, or `null` when it drew it on none. */
function lineWith(lines: readonly Line[], text: string): Line | null {
  const wanted = text.trim().toLowerCase();
  return lines.find((line) => line.text.toLowerCase().includes(wanted)) ?? null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the title menu with its first item highlighted", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(2);
  assertEqual(
    (await h.snapshot()).menuIndex,
    2,
    "the highlight is posed off the first item before the arrival",
  );

  await openHowto(h);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the session is somewhere else, so setScreen(title) is a real arrival",
  );

  await h.debug.setScreen("title");
  const arrived = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "title");
  assertEqual(
    arrived.screen,
    "title",
    'setScreen("title") enters the title screen',
  );
  assertEqual(
    arrived.titleIndex,
    0,
    "no title item has been taken, so the remembered selection is still 0",
  );
  assertEqual(
    arrived.menuIndex,
    0,
    "arriving at the title puts the highlight on the remembered selection",
  );

  const lines = linesOf(textDraws(await h.lastCalls()));
  for (const item of TITLE_ITEMS) {
    assertNotNull(
      lineWith(lines, item),
      `the title menu's own items are what the frame put up, not the how-to's: ${item}`,
    );
  }

  await pressAction(h, "confirm");
  const taken = await h.snapshot();
  assertEqual(
    taken.screen,
    "select",
    "confirm takes the highlighted item, which is the title menu's first",
  );
  assertEqual(
    taken.mode,
    "campaign",
    "the title menu's first item is CAMPAIGN, which sets the mode to campaign",
  );
});
