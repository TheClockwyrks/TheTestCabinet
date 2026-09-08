// instrumentation/overlay-sources-registered — the game registers every
// diagnostic `specs/instrumentation.md` asks the overlay to show.
//
// THE RULE, from Diagnostics: the overlay "shows the values the game registers
// with it as diagnostic sources", and "Register at least the current `screen` and
// `mode`, the open challenge's name and source, the part count and `cost`, the
// `period`, the run's `status`, `cycle`, `fraction`, and `speed` when one is
// active, each product's tally against the `target`, the mote count, the banked
// `area`, the fault kind when there is one, the focus, and the pointer position,
// the same facts the snapshot reports."
//
// HOW A REGISTRATION IS OBSERVED. Nothing but the overlay reports what was
// registered, so the overlay is where the check reads it: the panel's lines are
// the text one frame draws with it SHOWN over the text the frame before it drew
// with it hidden — the multiset difference, so a value the game's own readout
// already draws is still counted when the panel draws it a second time. Nothing
// here reads a LABEL: the specification names the facts, never the words a build
// prints beside them, so every reading below is of a VALUE. The lines are the
// LOGICAL runs each frame spells (`drawnTextLines`), not its `fillText` calls,
// so a panel that letter-spaces a line still reports the value that line
// carries rather than one character of it per line.
//
// THE FIGURES ARE READ OFF THE SNAPSHOT, not written down here. The world is posed
// so that every one of them is distinctive — a cost of `165`, a period of `12`, a
// cycle of `137`, tallies of `7` and `11` against a target of `17`, a pointer at
// `(731, 219)` — and then each is taken from `snapshot()` and looked for among the
// panel's own numbers. A number is matched EXACTLY once parsed, so a frame timing
// of `47.3 ms` is not mistaken for a cycle of `47`.
//
// THE FRACTION IS THE ONE VALUE WHOSE WRITING IS THE BUILD'S. `sim.fraction` is a
// running sum "read to within the rounding of that sum rather than bit for bit",
// and a build is free to round it or to write it as a percentage, so it is the one
// figure read with a tolerance: the run is frozen at seven eighths of a cycle and
// the panel must carry a number near `0.875`, or near `87.5` for a build that
// writes it out of a hundred.
//
// TWO WORLDS, BECAUSE TWO OF THE FACTS CANNOT STAND TOGETHER. "the run's `status`"
// is read on a paused run and "the fault kind when there is one" needs a faulted
// one, and a faulted run cannot be paused. So the first world is a paused run
// carrying every other fact, and the second is one arm whose tape holds `advance`
// with no track under it — which `specs/simulation.md` faults as `unmounted` —
// carrying the fault kind alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertMatches,
  assertTrue,
} from "../assert";
import { ARM_MIN_LEN, SPEEDS } from "../constants";
import { at } from "../field";
import { armPart, challenge, loneMote, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureStill,
  createHarness,
  drawnTextLines,
  openBareRun,
  placePart,
  placeTrack,
  toggleOverlay,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * How near a number on the panel must land to be the fraction.
 *
 * `sim.fraction` is the one registered value the specification leaves the build to
 * WRITE: it is a running sum of the frames' delta times, and rounding it to a
 * couple of places is the ordinary way to fit it on a line. A tenth of a place is
 * the widest rounding worth allowing, which is what this is; the percentage form
 * is allowed the same rounding scaled up.
 */
const FRACTION_DISPLAY_TOLERANCE = 0.05;
const PERCENT_DISPLAY_TOLERANCE = 0.5;

/** The challenge the world is posed on: two products, a distinctive name. */
const SHOWCASE = challenge({
  name: "Quorum Zenith",
  reagents: [loneMote("dust"), loneMote("luna")],
  products: [loneMote("dust"), loneMote("luna")],
  permitted: ["arm"],
  target: 17,
});

/** Six hexes far enough apart that six resting motes are the whole of the field. */
const MOTE_HEXES = [
  at(4, 0),
  at(-4, 0),
  at(0, 4),
  at(0, -4),
  at(4, -4),
  at(-4, 4),
];

/** The strings in `texts` left after removing `baseline`, as a multiset. */
function addedTexts(
  texts: readonly string[],
  baseline: readonly string[],
): string[] {
  const remaining = [...baseline];
  return texts.filter((text) => {
    const index = remaining.indexOf(text);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

/**
 * The panel's own lines, by toggling it once and taking the difference either way.
 *
 * One press either shows the panel or hides it, and WHICH it does turns on whether
 * the panel was already open — which is `overlay-off-at-start`'s point to decide,
 * not this one's. So the lines are read as whichever direction the press moved the
 * frame in: the text the next frame gained, or, failing that, the text it lost.
 */
async function panelLines(): Promise<string[]> {
  const before = drawnTextLines(await h.frameCalls());
  await toggleOverlay(h);
  const after = drawnTextLines(await h.frameCalls());
  const gained = addedTexts(after, before);
  const lost = addedTexts(before, after);
  assertTrue(
    gained.length > 0 !== lost.length > 0,
    "the backtick key moves the overlay onto the frame or off it, so its lines " +
      `can be read: the press gained ${JSON.stringify(gained)} and lost ${JSON.stringify(lost)}`,
  );
  return gained.length > 0 ? gained : lost;
}

/**
 * The separators a build may draw between a figure's digit triples.
 *
 * The specification fixes the figure and leaves its presentation to the build, and
 * grouping is what `Number.prototype.toLocaleString` does by default, so a panel
 * that wrote `1,234` wrote the one figure 1234 and reads as that. ASCII space is
 * deliberately absent from the set: the panel's lines are separate runs of text
 * and are joined before they are read, so accepting it would read the two figures
 * in `40 130` as the single figure `40130`. The decimal point is absent for the
 * same kind of reason — a build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One number as a build may draw it: grouped into triples, or plain. */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every number the panel wrote, whatever it wrote beside them. */
function numbersOn(lines: readonly string[]): number[] {
  return (lines.join("\n").match(DRAWN) ?? []).map((drawn) =>
    Number(drawn.replace(new RegExp(GROUP, "g"), "")),
  );
}

it("registers every diagnostic the specification asks the overlay to show", async () => {
  // A world in which every registered fact has a figure of its own.
  await h.debug.reset();
  await h.debug.loadChallenge(SHOWCASE);
  await h.debug.clearMachine();
  const hexarm = await placePart(h, "hexarm", ORIGIN, 0);
  await placePart(h, "piston", at(0, -2), 0);
  await placeTrack(
    h,
    Array.from({ length: 9 }, (_, index) => at(-5 + index, 2)),
  );
  await placePart(h, "bind", at(-3, -2), 0);
  await placePart(h, "bind", at(2, -4), 0);
  await h.debug.setTapeCell(hexarm, 11, "rotate-cw");
  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  for (const hex of MOTE_HEXES) await h.debug.spawnMote(hex.q, hex.r, "dust");
  await h.debug.setSpeed(3);
  await h.debug.setCycle(137);
  await h.debug.setTally(0, 7);
  await h.debug.setTally(1, 11);
  await advanceFraction(h, 0.875);
  await h.debug.setPaused(true);
  await h.debug.setFocus("tape");
  await h.debug.setMode("extras");
  await h.debug.pointerMove(731, 219);

  const posed = await h.snapshot();
  const sim = posed.sim;
  const lines = await panelLines();
  await captureStill(h, "sources");

  assertDefined(sim, "the world is posed on a live run");
  assertEqual(
    sim?.status,
    "paused",
    "held still, so the panel reads a game that is not moving under it",
  );
  assertGreaterThan(
    lines.length,
    0,
    "showing the overlay draws the diagnostics the game registered",
  );
  const said = lines.join("\n").toLowerCase();
  const wrote = numbersOn(lines);

  /** The panel wrote this string somewhere among its lines. */
  const reports = (value: string, fact: string): void => {
    assertMatches(said, value.toLowerCase(), `the overlay reports ${fact}`);
  };
  /** The panel wrote this number somewhere among its lines. */
  const counts = (value: number, fact: string): void => {
    assertTrue(
      wrote.includes(value),
      `the overlay reports ${fact} (${value}), and wrote ${JSON.stringify(wrote)}`,
    );
  };

  reports(posed.screen, "the current screen");
  reports(posed.mode, "the current mode");
  reports(posed.challenge?.name ?? "", "the open challenge's name");
  reports(posed.challenge?.source ?? "", "the open challenge's source");
  counts(posed.editor.parts.length, "the part count");
  counts(posed.editor.cost, "the machine's cost");
  counts(posed.editor.period, "the period");
  reports(sim?.status ?? "", "the run's status");
  counts(sim?.cycle ?? -1, "the run's cycle");
  assertTrue(
    wrote.some(
      (number) =>
        Math.abs(number - (sim?.fraction ?? -1)) <=
          FRACTION_DISPLAY_TOLERANCE ||
        Math.abs(number - (sim?.fraction ?? -1) * 100) <=
          PERCENT_DISPLAY_TOLERANCE,
    ),
    `the overlay reports the run's fraction (${sim?.fraction ?? -1}), and wrote ${JSON.stringify(wrote)}`,
  );
  assertTrue(
    wrote.includes(sim?.speed ?? -1) ||
      wrote.includes(SPEEDS[sim?.speed ?? 0] ?? -1),
    `the overlay reports the run's speed (index ${sim?.speed ?? -1}), and wrote ${JSON.stringify(wrote)}`,
  );
  counts(sim?.tallies[0] ?? -1, "the first product's tally");
  counts(sim?.tallies[1] ?? -1, "the second product's tally");
  counts(
    posed.challenge?.target ?? -1,
    "the target the tallies are counted against",
  );
  counts(sim?.motes.length ?? -1, "the mote count");
  counts(sim?.area ?? -1, "the banked area");
  reports(posed.editor.focus, "the focus");
  counts(posed.pointer.x, "the pointer's x");
  counts(posed.pointer.y, "the pointer's y");

  // The second world: a fault, which the first world could not carry.
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["advance"]),
    ]),
  });
  await advanceCycles(h, 1);
  const faulted = await h.snapshot();
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "advance on a part with no track under it halts the run, so there is a fault to report",
  );
  const kind = faulted.sim?.fault?.kind;
  assertDefined(kind, "a halted run names the fault that raised it");

  const faultLines = await panelLines();
  assertMatches(
    faultLines.join("\n").toLowerCase(),
    String(kind).toLowerCase(),
    "the overlay reports the fault kind when there is one",
  );
});
