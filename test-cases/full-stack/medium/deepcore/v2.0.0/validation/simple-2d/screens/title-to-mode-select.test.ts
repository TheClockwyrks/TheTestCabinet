// screens/title-to-mode-select — NEW EXPEDITION opens the mode choice, and the
// mode choice states what each mode costs.
//
// specs/ui.md: `NEW EXPEDITION` goes to `mode-select`, and "`mode-select` shows
// each mode's death rule before it is chosen". specs/modes.md says what those
// rules are: in Standard "a death lets the expedition be restored from the last
// save"; in Hardcore "a death deletes the save and ends the expedition".
//
// HOW THE COPY IS READ. specs/ui.md fixes the screen's CONTENT and not its words:
// "The content and the navigation are fixed; the layout is yours." So what is
// read is the vocabulary the specification itself fixes — the three menu entries
// by name, and the two things both rules turn on, a DEATH and the SAVE — plus the
// shape of the rest: the screen carries real explanatory copy beyond its three
// entries, which a screen that listed the modes and said nothing about them does
// not.
//
// ISOLATION. The title reached directly with the slot cleared, so `NEW
// EXPEDITION` is the entry specs/ui.md puts first with no save, and nothing about
// an expedition exists yet.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS, TITLE_ITEMS } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertMatches,
} from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  drawnText,
  drewText,
  type Harness,
} from "../harness";
import { drawnCopy } from "./frames";

/** The main menu with no save banked: `TITLE_ITEMS` without its first entry. */
const ITEMS_NO_SAVE = TITLE_ITEMS.slice(1);

/** The two things specs/modes.md has both death rules turn on. */
const NAMES_A_DEATH =
  /\bDEATH\b|\bDEATHS\b|\bDIE\b|\bDIES\b|\bDYING\b|\bDEAD\b/;
const NAMES_THE_SAVE = /\bSAVE\b|\bSAVES\b|\bSAVED\b|\bSAVING\b/;

/**
 * Characters of copy the screen must carry beyond its three entries.
 *
 * Two stated rules, however a build breaks them across runs: 40 is comfortably
 * under the length of the shortest pair of sentences that could say what
 * specs/modes.md says, and far over what a screen listing three words carries.
 */
const MIN_RULE_COPY = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches the mode choice, which states both death rules", async () => {
  h.debug.clearSave();
  h.debug.reset();
  h.debug.setScreen("title");
  h.debug.setMenuIndex(ITEMS_NO_SAVE.indexOf("NEW EXPEDITION"));
  await h.tap(ACTION_KEY.activate);

  const calls = await h.frameCalls();
  captureStill(h, "modes");

  assertEqual(
    h.snapshot().screen,
    "mode-select",
    "specs/ui.md: NEW EXPEDITION goes to mode-select",
  );
  for (const item of MODE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `specs/ui.md: the mode choice draws ${item}`,
    );
  }

  const copy = drawnCopy(calls);
  assertMatches(
    copy,
    NAMES_A_DEATH,
    "specs/ui.md: the mode choice states each mode's death rule",
  );
  assertMatches(
    copy,
    NAMES_THE_SAVE,
    "specs/modes.md: both death rules turn on the save",
  );

  // The copy that is not simply one of the entries, however a build marks the
  // highlighted one.
  const entries: readonly string[] = MODE_ITEMS.map((item) =>
    item.toUpperCase(),
  );
  const stated = drawnText(calls)
    .map((run) =>
      run
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, " ")
        .trim(),
    )
    .filter((text) => text.length > 0 && !entries.includes(text));
  assertGreaterThanOrEqual(
    stated.join(" ").length,
    MIN_RULE_COPY,
    "specs/ui.md: the mode choice states a rule for each mode, not just their names",
  );
});
