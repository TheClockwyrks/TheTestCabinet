// campaign/defeat-has-no-rating — a lost run never reaches the finale.
//
// specs/campaign.md: "A defeat never reaches the finale, so a defeated run has no
// Maze Rating." The finale is what produces the figure — "The run keeps no
// running score. Its one end-of-run figure is the Maze Rating, produced by a
// finale that runs after wave `N` is cleared" — and the outcome table sends a
// defeat straight to the defeat screen, immediately.
//
// The run is lost on its LAST wave, which is where a build is most likely to
// take the wrong branch: the wave that would have ended in the finale ends in
// defeat instead. Grid Integrity is posed at `1`, wave `N` is launched by the
// level's harvest, and one of the wave's own units is walked into the collector.
//
// Three things are read. The phase is sampled at every step from the launch to
// the defeat, and never reads `finale`. The Maze Rating is still `0`, which
// specs/instrumentation.md gives as its resting value "before the finale". And
// the screen the run ends on is `overload`, which shows no rating —
// specs/campaign.md puts the Maze Rating on the victory screen and nowhere else,
// and specs/ui.md has the defeat screen show "no Maze Rating". A screen that
// SAYS there is no rating is stating exactly that and shows none; what fails is
// a screen that presents one, a `MAZE RATING` label with or without a figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, type Harness } from "../harness";
import { frameText } from "../screens/reading";
import {
  LEAK_FROM,
  createRunHarness,
  harvestWave,
  openFinalWave,
  RUN_HZ,
} from "./runs";
import { COLLECTOR_WAYPOINT } from "../constants";

/** One short of the end: any unit's leak takes the counter to zero or below. */
const INTEGRITY = 1;

const DIFFICULTY = "easy";

/** Frames between two samples of the phase. */
const POLL = 4;

/** Half a minute of simulation: past the walk of three tiles staged here. */
const MAX_FRAMES = 30 * RUN_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the last wave on the overload screen, with no finale and no rating", async () => {
  const waves = openFinalWave(h, DIFFICULTY);
  h.debug.setIntegrity(INTEGRITY);
  harvestWave(h, waves);

  const phases = new Set<string>();
  let walked = false;
  let ended = null as null | Awaited<ReturnType<Harness["snapshot"]>>;

  for (let frames = 0; frames < MAX_FRAMES; frames += POLL) {
    await h.advance(POLL);
    const s = h.snapshot();
    phases.add(String(s.phase));
    if (s.screen === "overload") {
      ended = s;
      break;
    }
    // The first unit the wave releases is walked into the collector, which is
    // the leak that empties the counter.
    if (!walked && s.units.length > 0) {
      const first = s.units[0]!;
      h.debug.setUnitWaypoint(first.id, COLLECTOR_WAYPOINT);
      h.debug.setUnitPosition(first.id, LEAK_FROM.x, LEAK_FROM.y);
      h.debug.setUnitFrozen(first.id, false);
      walked = true;
    }
  }

  assertEqual(
    ended === null,
    false,
    `the run to be lost on wave ${waves} once its counter emptied`,
  );
  const defeat = ended!;

  assertEqual(
    phases.has("finale"),
    false,
    `the phase never to read \`finale\` on a lost run; it read ` +
      `${[...phases].join(", ")}`,
  );
  assertEqual(
    defeat.screen,
    "overload",
    "a lost run ends on the defeat screen",
  );
  assertEqual(defeat.phase, null, "a run off the yard reports no phase");
  assertEqual(defeat.mazeRating, 0, "a defeated run has no Maze Rating");

  const calls = await h.frameCalls();
  captureStill(h, "defeat");
  // Off the whole of the frame's text, upper-cased, with letter-spacing folded
  // back into words: a screen that letter-spaces `MAZE RATING` a glyph at a time
  // shows a rating as surely as one that draws it whole, and `frameText` reads
  // the merged runs of the shared harness (`case-harness/text.ts`) joined with a
  // space, so a phrase the merge split at a narrow space glyph still reads as
  // one line here. What counts is a rating SHOWN: a `MAZE RATING` label, with a
  // figure after it or without. A `NO MAZE RATING` or `NO RATING` — the
  // disclaimer specs/ui.md has the defeat screen make — states that there is
  // none, and is not one. The spaces of the disclaimer are optional because a
  // recording without geometry folds a letter-spaced line by shape, and a build
  // that skips its space glyphs then folds to `NOMAZERATING`.
  const text = frameText(calls).replace(/\s+/g, " ");
  assertEqual(
    /(?<!\bNO ?(?:MAZE ?)?)RATING/.test(text),
    false,
    "the defeat screen shows no rating; saying there is none is not one, and " +
      "the Maze Rating shows on the victory screen (specs/campaign.md). It " +
      `drew: ${text}`,
  );
});
