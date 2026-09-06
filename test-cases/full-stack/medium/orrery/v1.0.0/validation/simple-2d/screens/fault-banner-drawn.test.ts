// screens/fault-banner-drawn — a faulted run puts a banner over the field naming
// what stopped it, and no other status does.
//
// THE RULE is the last clause of `specs/ui.md`, The fault display: "While
// `sim.status` is `faulted`, THE FIELD SHOWS the machine frozen at the cycle the
// fault stopped, the parts and motes `specs/simulation.md` names in the fault
// drawn visibly distinct from the rest, AND A BANNER NAMING WHICH OF THE `FAULTS`
// OF `specs/simulation.md` STOPPED THE RUN. The banner's wording is the build's
// own." So two things are fixed and one is not: the banner is part of what the
// FIELD shows, and it NAMES the fault; the sentence around that name is the
// build's.
//
// HOW A BANNER IS READ, GIVEN THAT ITS WORDING IS FREE. The one thing every
// conformant banner carries is the name of the fault that stopped the run, and
// `FAULTS` "names every way a run halts" (`specs/simulation.md`), so the reading
// is: does the FIELD REGION carry a name from `FAULTS`? The field's extent is
// fixed — "`x` `TRAY_REGION_W` (`224`) to `READOUT_X0` (`1008`), `y` `HEADING_H`
// (`48`) to `TAPE_Y0` (`560`)" (`specs/editor.md`) — which is what separates the
// banner from the readout beside it, whose own contents are fixed by the same
// file ("the status, the cycle count, the period, the speed, and each set's
// tally") and which sits outside it. Nothing here reads where inside the field
// the banner sits, how large it is, or what it says beyond the fault's name.
//
// THE CONFIGURATION IS ONE MACHINE IN FOUR STATUSES, so the presence and the
// absence are read off the same scene rather than off four different ones. One
// `piston` at the origin stands at `ARM_MAX_LEN` (`3`) with the tape
// `[blank, blank, extend]`: "A blank cell is a rest on every part … and never
// faults", so cycles `0` and `1` pass quietly and the fetch of cycle `2` raises
// `overextended` — "`extend` on a piston already at `ARM_MAX_LEN` (`3`)". That
// gives a frame while `paused`, a frame while `running`, and a frame while
// `faulted`, one after another. The fourth comes from a second world in the same
// suite: the same challenge with the set for its one product, its tally posed to
// the `target`, completed in one cycle — because "a boundary that satisfies every
// set's target" is the only way to reach `complete` (`specs/simulation.md`).
//
// THE VERDICT. The field region carries a `FAULTS` name on the faulted frame and
// on none of the other three. A build that draws no banner fails the first half;
// a build that leaves one up while the machine runs, or puts one under the solved
// panel, fails the second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { FAULTS } from "../constants";
import { FIELD_REGION } from "../field";
import { armPart, setPart, solution } from "../formats";
import { BARE, ORIGIN, TARGET } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureStill,
  createHarness,
  openBareRun,
  openRun,
  resumeRun,
  textIn,
  type DrawCall,
  type Harness,
  type TextDraw,
} from "../harness";

/**
 * One piston at the origin at `ARM_MAX_LEN`, resting through two cycles and then
 * asked to `extend` past its bound, which raises `overextended` at the fetch of
 * cycle `2`.
 */
const FAULTING = solution([
  armPart("piston", ORIGIN.q, ORIGIN.r, 0, 3, [null, null, "extend"]),
]);

/** The whole machine of the completing world: the set for the one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The names of `FAULTS` the frame drew inside the field region.
 *
 * The runs are gathered into the baselines they were drawn on and read left to
 * right, because a build is free to draw a line of copy as one call, as a call
 * per word, or as a call per glyph — letter spacing is not portable, and
 * `specs/assets.md` fixes no more than that the copy reaches the frame as
 * drawn text. Joining a baseline's runs in `x` order reads a banner the same
 * way whichever of those it was drawn as.
 */
function faultsNamedOnField(calls: readonly DrawCall[]): string[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of textIn(calls, FIELD_REGION)) {
    baselines.set(draw.y, [...(baselines.get(draw.y) ?? []), draw]);
  }
  const lines = [...baselines.values()].map((on) =>
    [...on]
      .sort((a, b) => a.x - b.x)
      .map((draw) => draw.text)
      .join("")
      .toLowerCase(),
  );
  return FAULTS.filter((fault) => lines.some((line) => line.includes(fault)));
}

it("draws a banner naming the fault while faulted, and none while paused, running or complete", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: FAULTING,
    paused: true,
  });
  await h.advance(1);

  const paused = await h.snapshot();
  assertEqual(
    paused.sim?.status,
    "paused",
    "the run is posed paused before anything is fetched",
  );
  const whilePaused = faultsNamedOnField(await h.lastCalls());

  await resumeRun(h);
  await advanceFraction(h, 1 / 2);
  const running = await h.snapshot();
  assertEqual(
    running.sim?.status,
    "running",
    "cycle 0's cell is blank, which every part rests on, so the run is still going",
  );
  const whileRunning = faultsNamedOnField(await h.lastCalls());

  await advanceCycles(h, 3);
  await h.advance(1);
  const calls = await h.lastCalls();
  await captureStill(h, "banner");

  const faulted = await h.snapshot();
  assertNotNull(faulted.sim, "the run is still reported once it has faulted");
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "the fetch of cycle 2 asked a piston at ARM_MAX_LEN to extend, which faults",
  );
  const kind = faulted.sim?.fault?.kind;
  assertEqual(
    kind,
    "overextended",
    "and the fault it raised is the one named for that instruction",
  );
  const whileFaulted = faultsNamedOnField(calls);

  await h.dispose();
  h = await createHarness();
  await openRun(h, { challenge: BARE, machine: ONE_SET });
  await h.debug.setTally(0, TARGET);
  await advanceCycles(h, 1);
  await h.advance(1);
  const complete = await h.snapshot();
  assertEqual(
    complete.sim?.status,
    "complete",
    "the second world's boundary reached the target, so its run is complete",
  );
  const whileComplete = faultsNamedOnField(await h.lastCalls());

  assertEqual(
    whileFaulted.includes(kind as string),
    true,
    "while the run is faulted the field carries a banner naming which of the " +
      `FAULTS stopped it, which here is ${String(kind)}`,
  );
  assertEqual(
    whilePaused.length,
    0,
    "and no such banner is on the field while the run is paused",
  );
  assertEqual(whileRunning.length, 0, "nor while it is running");
  assertEqual(
    whileComplete.length,
    0,
    "nor while it is complete, where the solved panel is what is drawn instead",
  );
});
