// instrumentation/overlay-sources-report-the-live-game — each diagnostic reads the
// state the frame is drawing, not the state the game started in.
//
// THE RULE, from Diagnostics in `specs/instrumentation.md`: a registered source is
// "called with the state current at the read" and reads off that argument — "a
// source that closed over the state `initialize` built would report the title
// screen forever, because every frame leaves a new value behind" — and under the
// engineless runtime and the structured engine alike the panel "reports the frame
// being drawn". The facts it is registered for are the ones the same section
// lists, and the ones this check follows are the ones the review item names: the
// screen, the challenge, the part count, the cost, the period, the status, the
// cycle, the tallies, the mote count, the area and the pointer.
//
// THE SHAPE OF THE CHECK IS A BEFORE AND AN AFTER, WITH THE PANEL OPEN ACROSS BOTH.
// The overlay is shown on a freshly reset game — the title screen, no challenge, no
// machine, no run, the pointer at the origin — and its lines are read. Then, with
// the panel never hidden, a challenge, a five-part machine, a run, a cycle, two
// tallies, six motes and a pointer position are posed under it, and its lines are
// read again. A source that closed over what it was handed at registration reports
// the first reading for the second world; a source that reads at the read reports
// the world it is now looking at.
//
// HOW THE PANEL'S LINES ARE READ. The lines are the text one frame draws with the
// panel over the text the frame beside it draws without — the multiset difference —
// so a figure the game's own readout already draws is still counted when the panel
// draws it a second time. Nothing here reads a LABEL: the specification names the
// facts, never the words a build prints beside them, and every figure below is
// taken from `snapshot()` rather than written down.
//
// THE NEGATIVE IS THE CHALLENGE'S NAME. "Quorum Zenith" is on the panel in the
// second world and cannot be on it in the first, where no challenge is open — so
// a build whose panel prints the same lines whatever the game is doing fails
// there, and a build whose sources are live passes both halves.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertMatches,
  assertNotNull,
  assertTrue,
} from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { at } from "../field";
import { challenge, loneMote } from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  drawnText,
  openTitle,
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

/** The challenge the second world is posed on: two products, a distinctive name. */
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
  const before = drawnText(await h.frameCalls());
  await toggleOverlay(h);
  const after = drawnText(await h.frameCalls());
  const gained = addedTexts(after, before);
  const lost = addedTexts(before, after);
  assertTrue(
    gained.length > 0 !== lost.length > 0,
    "the backtick key moves the overlay onto the frame or off it, so its lines " +
      `can be read: the press gained ${JSON.stringify(gained)} and lost ${JSON.stringify(lost)}`,
  );
  return gained.length > 0 ? gained : lost;
}

/** Every number the panel wrote, whatever it wrote beside them. */
function numbersOn(lines: readonly string[]): number[] {
  return (lines.join("\n").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Pose the second world: a challenge, a machine, a run, and a pointer on it. */
async function poseTheRun(): Promise<void> {
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
  await h.debug.setCycle(137);
  await h.debug.setTally(0, 7);
  await h.debug.setTally(1, 11);
  await advanceFraction(h, 0.875);
  await h.debug.setPaused(true);
  await h.debug.pointerMove(731, 219);
}

it("moves every reported figure to the posed world rather than the one it started in", async () => {
  await openTitle(h);
  const started = await h.snapshot();
  assertEqual(
    started.screen,
    "title",
    "a reset game opens on the title screen",
  );
  assertEqual(started.challenge, null, "with no challenge open");
  assertEqual(started.sim, null, "and no run live");

  const atStart = await panelLines();
  assertGreaterThan(
    atStart.length,
    0,
    "showing the overlay draws the diagnostics the game registered",
  );
  const saidAtStart = atStart.join("\n").toLowerCase();
  assertMatches(
    saidAtStart,
    started.screen,
    "the panel reports the screen the game is on",
  );

  // The panel stays open across everything below.
  await captureReplay(h, "live", async () => {
    await h.advance(RECORDING_RUN_UP);
    await poseTheRun();
    await h.advance(RECORDING_SETTLE);
  });

  const posed = await h.snapshot();
  const sim = posed.sim;
  const after = await panelLines();
  const said = after.join("\n").toLowerCase();
  const wrote = numbersOn(after);

  assertDefined(sim, "the second world is a live run");
  assertNotNull(posed.challenge, "with a challenge open on the editor");
  assertGreaterThan(after.length, 0, "and the panel still drawing its lines");

  /** The panel wrote this string somewhere among its lines. */
  const reports = (value: string, fact: string): void => {
    assertMatches(said, value.toLowerCase(), `the overlay now reports ${fact}`);
  };
  /** The panel wrote this number somewhere among its lines. */
  const counts = (value: number, fact: string): void => {
    assertTrue(
      wrote.includes(value),
      `the overlay now reports ${fact} (${value}), and wrote ${JSON.stringify(wrote)}`,
    );
  };

  reports(posed.screen, "the screen the game moved to");
  reports(
    posed.challenge?.name ?? "",
    "the challenge that was opened under it",
  );
  reports(sim?.status ?? "", "the status of the run that was started");
  counts(
    posed.editor.parts.length,
    "the part count of the machine that was built",
  );
  counts(posed.editor.cost, "that machine's cost");
  counts(posed.editor.period, "that machine's period");
  counts(sim?.cycle ?? -1, "the cycle the run was set to");
  counts(sim?.tallies[0] ?? -1, "the first product's tally");
  counts(sim?.tallies[1] ?? -1, "the second product's tally");
  counts(
    sim?.motes.length ?? -1,
    "the mote count of the field that was spawned",
  );
  counts(sim?.area ?? -1, "the banked area of that run");
  counts(posed.pointer.x, "the pointer's x");
  counts(posed.pointer.y, "the pointer's y");

  // And none of it was on the panel before the world was posed: a source frozen at
  // registration would still be reporting the first reading here.
  assertEqual(
    saidAtStart.includes((posed.challenge?.name ?? "").toLowerCase()),
    false,
    "the challenge's name was not on the panel before the challenge was opened",
  );
});
