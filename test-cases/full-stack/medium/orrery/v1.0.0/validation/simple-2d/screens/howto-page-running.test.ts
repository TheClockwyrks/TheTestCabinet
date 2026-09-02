// screens/howto-page-running — the how-to's page about running NAMES the keys
// that run a machine.
//
// THE RULE. `specs/ui.md` fixes the how-to's five pages in order, and the fourth
// of them — `howtoPage` `3`, counting from `0` as `state.howtoPage` does — is
// "Running: play, step, and speed, NAMING THE KEYS; that motes collide; and that
// a fault stops the machine and where to read what went wrong". The four actions
// named there are `play`, `step`, `speed-down` and `speed-up`, and `BINDINGS` is
// where each one's key is fixed: "`BINDINGS` maps each to the
// `KeyboardEvent.code` values that fire it" — `Space`, `KeyN`, `Comma` and
// `Period`. So the list this page must name is derived from `BINDINGS` here
// rather than written out.
//
// THE COPY IS READ AS TEXT, because `specs/assets.md` says where it comes from:
// under What stays drawn in code, "The title, howto, and select screens, the
// solved panel, and all text" are drawn by the build, and "No produced file
// covers the following".
//
// HOW A KEY COUNTS AS NAMED. `specs/` fixes the KEY — its `KeyboardEvent.code` —
// and not the spelling a page uses for it, so the reading accepts every way a
// page tells a player which key to press. A cap standing on its own among the
// words of the page names it (`N`, `(N)`); a key whose name is a word is named
// wherever that word appears in any case (`Space`); and the two punctuation keys
// are named either by their plain-English names — `comma`, `period`, `full stop`,
// `dot` — or by the character itself standing alone rather than doing a
// sentence's own punctuation, so a page's every full stop does not name the
// `Period` key.
//
// THE POSE. A fresh session, the how-to, and its page moved to `3` with
// `setHowtoPage`, the faculty gate `specs/instrumentation.md` names for the page.
// One frame is drawn there and read; nothing advances on the how-to, so that
// frame is the page.
//
// THE VERDICT. Every one of the four keys `BINDINGS` gives the run actions is
// named on the page.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
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

/** The page of the how-to that `specs/ui.md` gives to running. */
const RUNNING_PAGE = 3;

/** The actions `specs/ui.md` requires that page to name the keys of. */
const RUN_ACTIONS: readonly ActionName[] = [
  "play",
  "step",
  "speed-down",
  "speed-up",
];

/** The plain name of a key, from its `KeyboardEvent.code`: `KeyN` is `N`. */
function labelOf(code: string): string {
  return code.startsWith("Key") ? code.slice(3) : code;
}

/** The character a punctuation key types, for the two keys that have one. */
const CHARACTERS: Readonly<Record<string, string>> = {
  Comma: ",",
  Period: ".",
};

/** The other names a page may give a key, beside the one `BINDINGS` uses. */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  Comma: ["comma"],
  Period: ["period", "fullstop", "dot"],
  Space: ["space", "spacebar"],
};

/** What may stand beside a lone character for it to read as a key's name. */
const EDGE = /[\s"'`([{<>)\]}]/;

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

/** Whether some run of text carries `char` standing on its own. */
function drawsCharacter(runs: readonly string[], char: string): boolean {
  return runs.some((run) => {
    for (let index = 0; index < run.length; index += 1) {
      if (run[index] !== char) continue;
      const before = run[index - 1] ?? " ";
      const after = run[index + 1] ?? " ";
      if (EDGE.test(before) && EDGE.test(after)) return true;
    }
    return false;
  });
}

/** Whether the page names the key `code`. */
function namesKey(
  lines: readonly string[],
  runs: readonly string[],
  code: string,
): boolean {
  const label = labelOf(code);
  if (label.length === 1 && wordsOf(lines).includes(label)) return true;
  const spellings = [
    ...(label.length === 1 ? [] : [label.toLowerCase()]),
    ...(ALIASES[label] ?? []),
  ];
  const flattened = lines.map((line) => line.replace(/\s+/g, "").toLowerCase());
  if (
    spellings.some((spelling) =>
      flattened.some((line) => line.includes(spelling)),
    )
  ) {
    return true;
  }
  const character = CHARACTERS[label];
  return character !== undefined && drawsCharacter(runs, character);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names every key BINDINGS gives play, step, speed-down and speed-up", async () => {
  await openTitle(h);
  await openHowto(h);
  await h.debug.setHowtoPage(RUNNING_PAGE);
  await h.advance(1);

  const draws = textDraws(await h.lastCalls());
  const lines = linesOf(draws);
  const runs = draws.map((draw) => draw.text);
  await captureStill(h, "page");

  const shown = await h.snapshot();
  assertEqual(shown.screen, "howto", "the frame read is a frame of the how-to");
  assertEqual(
    shown.howtoPage,
    RUNNING_PAGE,
    "the frame read is the page specs/ui.md gives to running",
  );

  for (const action of RUN_ACTIONS) {
    const code = BINDINGS[action][0] as string;
    assertTrue(
      namesKey(lines, runs, code),
      `the running page names ${labelOf(code)}, the key BINDINGS gives ` +
        `${action}, and what it drew is ${JSON.stringify(lines)}`,
    );
  }
});
