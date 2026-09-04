// screens/howto-page-tape — the how-to's page about the tape NAMES the keys that
// write one.
//
// THE RULE. `specs/ui.md` fixes the how-to's five pages in order, and the third
// of them — `howtoPage` `2`, counting from `0` as `state.howtoPage` does — is
// "The tape: instructions, how every tape loops on one shared period, and how to
// write a tape, NAMING THE KEYS". The keys a tape is written with are the
// fourteen tape-focus actions of `specs/controls.md`, and `BINDINGS` is where
// each one's key is fixed: "`BINDINGS` maps each to the `KeyboardEvent.code`
// values that fire it" — `KeyA` through `KeyY`, `Delete` and `Backspace`. So the
// list this page must name is derived from `BINDINGS` here rather than written
// out, which is what makes it the specification's list and not a copy of one.
//
// THE COPY IS READ AS TEXT, because that is how `specs/assets.md` puts it on the
// stage: under What stays drawn in code, "The title, howto, and select screens,
// the solved panel, and all text" are drawn by the build, and "Every word the
// game puts on the stage is drawn as text ... rather than as shapes traced into
// the form of letters or assembled from images of glyphs". A page's words reach
// the canvas through the text operations, so that is where they are read.
//
// HOW A KEY COUNTS AS NAMED is fixed with the pages: "Where a page names a key it
// names the key itself rather than the action it fires, spelled as the keyboard
// spells it: a letter key by its capital letter standing on its own, `Space`,
// `Delete`, and `Backspace` by their names, and the comma and period keys by the
// character each types or by that character's name" (`specs/ui.md`). Nothing
// beyond the spelling is fixed — `specs/ui.md` fixes no font and no layout — so
// the frame's text runs are gathered onto the baselines they were drawn on,
// exactly as the select-screen checks gather a row, and a letter key counts as
// named when its CAP stands on its own among the words of the page: `A`, `W / S`,
// `(G)` and `[T]` all count, and the `a` of "a tape" does not. A key whose name is
// a word — `Delete`, `Backspace` — counts wherever that word appears, in any case.
//
// THE POSE. A fresh session, the how-to, and its page moved to `2` with
// `setHowtoPage`, the faculty gate `specs/instrumentation.md` names for the page.
// One frame is drawn there and read; nothing advances on the how-to, so that
// frame is the page.
//
// THE VERDICT. Every one of the fourteen keys `BINDINGS` gives the tape-focus
// actions is named on the page.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { BINDINGS, type ActionName } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openTitle,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";

/** The page of the how-to that `specs/ui.md` gives to the tape. */
const TAPE_PAGE = 2;

/**
 * The fourteen tape-focus actions of `specs/controls.md`, in the order its Tape
 * focus table lists them.
 */
const TAPE_ACTIONS: readonly ActionName[] = [
  "ins-rotate-ccw",
  "ins-rotate-cw",
  "ins-extend",
  "ins-retract",
  "ins-pivot-ccw",
  "ins-pivot-cw",
  "ins-grab",
  "ins-drop",
  "ins-advance",
  "ins-recede",
  "ins-blank",
  "ins-erase",
  "ins-reset",
  "ins-repeat",
];

/** The plain name of a key, from its `KeyboardEvent.code`: `KeyA` is `A`. */
function labelOf(code: string): string {
  return code.startsWith("Key") ? code.slice(3) : code;
}

/**
 * The page's text, one string per baseline the frame drew on.
 *
 * A build is free to draw a line as one run or as a run per word, and nothing in
 * `specs/` says which; what they share is the baseline, so the runs at one `y`
 * are joined in `x` order and read as that line.
 */
function linesOf(draws: readonly TextDraw[]): string[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of draws) {
    const on = baselines.get(draw.y) ?? [];
    on.push(draw);
    baselines.set(draw.y, on);
  }
  return [...baselines.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, on]) =>
      [...on]
        .sort((a, b) => a.x - b.x)
        .map((draw) => draw.text)
        .join(" "),
    );
}

/** Every word-like run of characters the page drew, in the case it drew it. */
function wordsOf(lines: readonly string[]): string[] {
  return lines.flatMap((line) =>
    line.split(/[^A-Za-z0-9]+/).filter((word) => word !== ""),
  );
}

/** Whether the page names the key `code`. */
function namesKey(lines: readonly string[], code: string): boolean {
  const label = labelOf(code);
  if (label.length === 1) {
    const words = wordsOf(lines);
    return words.includes(label) || words.includes(code);
  }
  const wanted = label.toLowerCase();
  return lines.some((line) =>
    line.replace(/\s+/g, "").toLowerCase().includes(wanted),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names every key BINDINGS gives the tape-focus actions", async () => {
  assertLength(
    TAPE_ACTIONS,
    14,
    "the tape-focus table of specs/controls.md holds fourteen actions",
  );

  await openTitle(h);
  await openHowto(h);
  await h.debug.setHowtoPage(TAPE_PAGE);
  await h.advance(1);

  const lines = linesOf(textDraws(await h.lastCalls()));
  await captureStill(h, "page");

  const shown = await h.snapshot();
  assertEqual(shown.screen, "howto", "the frame read is a frame of the how-to");
  assertEqual(
    shown.howtoPage,
    TAPE_PAGE,
    "the frame read is the page specs/ui.md gives to the tape",
  );

  for (const action of TAPE_ACTIONS) {
    const code = BINDINGS[action][0] as string;
    assertTrue(
      namesKey(lines, code),
      `the tape page names ${labelOf(code)}, the key BINDINGS gives ` +
        `${action}, and what it drew is ${JSON.stringify(lines)}`,
    );
  }
});
