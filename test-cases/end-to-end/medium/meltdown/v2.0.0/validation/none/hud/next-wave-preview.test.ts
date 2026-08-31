// hud/next-wave-preview — a build phase with nothing hovered and nothing selected
// previews the coming wave's type and its count.
//
// `specs/hud.md`, The next-wave preview: "In the `opening` phase or a build phase,
// with nothing selected and no shop entry hovered, the information area draws the
// coming wave's type and its count." The two figures are `specs/waves.md`'s
// `waveType(w, n)` and `waveSize(w, n)`.
//
// TWO WAVES, BECAUSE ONE CANNOT TELL A PREVIEW FROM A CAPTION. Wave 6 of a 20-wave
// run fields 17 Drifts and Wave 8 fields 13 Hulks, so a preview that read the
// coming wave reads a different type AND a different count at each, and one that
// drew Wave 1's twelve Motes whatever the wave reads neither. The second reading
// therefore requires the first wave's type and count GONE as well as the second's
// there.
//
// WHY THESE TWO WAVES. Both fall inside `WAVE_OPENING`, so neither is a milestone
// Core wave, and their counts — `17` and `13` — are equal to no other number this
// panel can draw: not a build cost, not a footprint side, not the wave or the wave
// count, not the countdown, and not one of the other wave's own figures. So a run
// carrying one of them is carrying the coming wave's count.
//
// THE PRECONDITION IS READ BACK, because the rule is conditional: the preview is
// what the information area draws "with nothing selected and no shop entry
// hovered", and `startRun` poses exactly that. A build that had something hovered
// or selected would be answering a different question, so the snapshot is checked
// before the panel is.
//
// THE WAVE PHASE DRAWING NO PREVIEW is `specs/hud.md`'s too — "The `wave` phase
// draws no preview: the wave is already on the floor" — and it is not this point:
// this one decides that a build phase draws one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import { modeFigures, waveSize, waveType } from "../constants";
import { captureStill, createHarness, startRun, type Harness } from "../harness";
import { readPanel, reads, saysWord } from "./panel";

/** The run previewed against: Containment on Medium, twenty waves. */
const TOTAL = modeFigures("containment", "medium").waveCount;

/** The two waves previewed, and what `specs/waves.md` gives each. */
const WAVES = [6, 8] as const;

/** A count is a whole number of units; only a trailing point is allowed for. */
const EXACT = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("previews 17 Drifts on Wave 6 and 13 Hulks on Wave 8", async () => {
  await startRun(h, "containment", "medium");

  const read = [] as { type: string; count: number; runs: Awaited<ReturnType<typeof readPanel>> }[];
  for (const wave of WAVES) {
    await h.debug.setWave(wave);
    const runs = await readPanel(h);
    if (wave === WAVES[0]) await captureStill(h, "preview");
    const posed = await h.snapshot();
    assertEqual(posed.phase, "building", `precondition: wave ${wave} is previewed from a build phase`);
    assertNull(posed.selected, `precondition: nothing is selected on wave ${wave}`);
    assertNull(posed.hoverShop, `precondition: no shop entry is hovered on wave ${wave}`);
    read.push({
      type: waveType(wave, TOTAL),
      count: waveSize(wave, TOTAL),
      runs,
    });
  }

  const [first, second] = read;
  assertEqual(first.type, "drift", "the type specs/waves.md gives Wave 6 of a 20-wave run");
  assertEqual(first.count, 17, "the count specs/waves.md gives Wave 6 of a 20-wave run");
  assertEqual(second.type, "hulk", "the type specs/waves.md gives Wave 8 of a 20-wave run");
  assertEqual(second.count, 13, "the count specs/waves.md gives Wave 8 of a 20-wave run");

  assertTrue(
    saysWord(first.runs, first.type),
    `the panel to name the coming wave's type, the ${first.type}, on Wave ${WAVES[0]}`,
  );
  assertTrue(
    reads(first.runs, first.count, EXACT),
    `the panel to draw the coming wave's count of ${first.count} on Wave ${WAVES[0]}`,
  );
  assertTrue(
    saysWord(second.runs, second.type),
    `the panel to name the coming wave's type, the ${second.type}, on Wave ${WAVES[1]}`,
  );
  assertTrue(
    reads(second.runs, second.count, EXACT),
    `the panel to draw the coming wave's count of ${second.count} on Wave ${WAVES[1]}`,
  );
  assertTrue(
    !saysWord(second.runs, first.type),
    `the panel to have stopped naming the ${first.type} once the wave moved to ${WAVES[1]}`,
  );
  assertTrue(
    !reads(second.runs, first.count, EXACT),
    `the panel to have stopped drawing the count ${first.count} once the wave moved to ${WAVES[1]}`,
  );
});
