// diagnostics/overlay-toggle — the overlay starts hidden and toggles on the
// backtick.
//
// specs/instrumentation.md, "Diagnostics", under `none`: "The overlay is part of
// the runtime layer you write. It draws the registered sources in the game's
// monospace type, plainly and clearly apart from the HUD, and the backtick key
// (`KeyboardEvent.code` `Backquote`) shows and hides it. It starts hidden."
//
// SCOPED TO `none`, because under either engine the overlay is the ENGINE's panel
// and its key is the engine's: a point that graded it there would grade the engine
// rather than the build. What the build owes on every engine — the SOURCES — is
// `diagnostics.sources-registered`.
//
// WHAT "DRAWS NOTHING UNTIL IT IS ASKED FOR" IS READ AS. The overlay is text, and
// where a build puts it is its own, so what is measured is the whole frame: how
// many runs of text it drew. A hidden overlay adds none; an open one adds a line
// per source, which specs/instrumentation.md requires at least a dozen of. So the
// reading is the count of runs before the key, after it, and after it again — up,
// then back to where it started.
//
// AND THE GAME UNDERNEATH IS HELD. The whole snapshot is taken at each of the
// three moments and the three have to agree, so an overlay that advanced the game
// to draw itself, or a toggle wired to something that poses state, fails here.
// `simTime` is excluded from that comparison and from nothing else: every tick
// adds to it whatever the screen (specs/state.md), and the three readings are a
// frame apart.
//
// THE BOARD IS EMPTIED OF HUNTERS AND THE FORAGER PARKED, so the only thing that
// could move between the three readings is the overlay itself.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan } from "../assert";
import { OVERLAY_KEY } from "../constants";
import { poseStraightRun } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager } from "../scene";
import { frameOps, textRuns } from "../states/screens";

/** How much corridor the forager is parked on, in tiles. */
const RUN_TILES = 8;

/**
 * How many runs of text an open overlay must add to a frame.
 *
 * Four. specs/instrumentation.md names a dozen facts a build registers and asks
 * that each be "short enough to read on a line", so an overlay drawing them adds
 * far more than this; the bound is set low because how a build packs several
 * facts onto one line is its own, and what this rules out is an overlay that
 * draws nothing at all.
 */
const OVERLAY_RUNS_MIN = 4;

/** The whole snapshot, with the clock taken out: what must not move. */
function held(snapshot: object): string {
  return JSON.stringify({ ...snapshot, simTime: 0 });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws nothing until the backtick, then draws, then goes away again", async () => {
  await startPlaying(h);
  const run = await poseStraightRun(h, RUN_TILES);
  await parkForager(h, run.start);

  const hidden = textRuns(await frameOps(h)).length;
  const before = await h.snapshot();

  await h.tap(OVERLAY_KEY);
  const open = textRuns(await frameOps(h)).length;
  // Before the assertions, so a failing check still leaves the overlay it read.
  await captureStill(h, "overlay");
  const opened = await h.snapshot();

  await h.tap(OVERLAY_KEY);
  const closed = textRuns(await frameOps(h)).length;
  const after = await h.snapshot();

  assertGreaterThan(
    open,
    hidden + OVERLAY_RUNS_MIN,
    `runs of text on the frame with the overlay open, against the ` +
      `${String(hidden)} the same dive drew with it hidden — a Backquote press ` +
      "draws it over the running game (specs/instrumentation.md)",
  );
  assertEqual(
    closed,
    hidden,
    `runs of text on the frame after a second Backquote, against the ` +
      `${String(hidden)} drawn before the first — the overlay starts hidden ` +
      "and the key takes it away again (specs/instrumentation.md)",
  );

  assertEqual(
    held(opened),
    held(before),
    "the whole snapshot across the overlay being opened, which draws over the " +
      "running game without changing anything (specs/instrumentation.md)",
  );
  assertEqual(
    held(after),
    held(before),
    "the whole snapshot across the overlay being opened and closed again " +
      "(specs/instrumentation.md)",
  );
});
