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
// where a build puts it is its own, so what is measured is the whole frame: the
// logical runs of text it drew. A hidden overlay adds none. An open one adds the
// registered sources, and how many runs those come to is the build's — the
// specification asks that each source be "short enough to read on a line" and
// fixes nothing about how many share one — so what is read off the open frame is
// not a count but the one source whose text the snapshot fixes exactly: the runs
// the press added must spell the current `screen`, which specs/instrumentation.md
// puts first among the sources a build registers. A second press has to take
// every added run away again, so the frame is back to the runs it drew before
// the first. What the rest of the sources report is `diagnostics/sources-
// registered`'s.
//
// AND THE GAME UNDERNEATH IS HELD. The whole snapshot is taken at each of the
// three moments and the three have to agree, so an overlay that advanced the game
// to draw itself, or a toggle wired to something that poses state, fails here.
// The readings are a few driven ticks apart — the frame that reads the canvas is
// a driven frame, and so is the press — so the two clocks the specification lets
// a playing tick move are held to those ticks rather than to equality;
// `diagnostics/held.ts` says which and why.
//
// THE BOARD IS EMPTIED OF HUNTERS AND THE FORAGER PARKED, so the only thing that
// could move between the three readings is the overlay itself.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertMatches } from "../assert";
import { OVERLAY_KEY } from "../constants";
import { poseStraightRun } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager } from "../scene";
import { frameOps, textLines } from "../states/screens";
import { added, assertHeld } from "./held";

/** How much corridor the forager is parked on, in tiles. */
const RUN_TILES = 8;

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

  const hidden = textLines(await frameOps(h));
  const before = await h.snapshot();
  const tickBefore = h.tick();

  await h.tap(OVERLAY_KEY);
  const open = textLines(await frameOps(h));
  // Before the assertions, so a failing check still leaves the overlay it read.
  await captureStill(h, "overlay");
  const opened = await h.snapshot();
  const ticksOpened = h.tick() - tickBefore;

  await h.tap(OVERLAY_KEY);
  const closed = textLines(await frameOps(h));
  const after = await h.snapshot();
  const ticksClosed = h.tick() - tickBefore;

  assertMatches(
    added(hidden, open),
    before.screen.toUpperCase(),
    `the current screen, among the runs of text a Backquote press added to the ` +
      `${String(hidden.length)} the same dive drew with the overlay hidden — ` +
      "the press draws the registered sources over the running game, and the " +
      "screen is the first of them (specs/instrumentation.md)",
  );
  assertEqual(
    added(hidden, closed),
    "",
    `runs of text on the frame after a second Backquote beyond the ` +
      `${String(hidden.length)} drawn before the first — the overlay starts ` +
      "hidden and the key takes it away again (specs/instrumentation.md)",
  );
  assertEqual(
    added(closed, hidden),
    "",
    "runs of text the frame drew before the first Backquote that it no longer " +
      "draws after the second — closing the overlay takes away nothing but the " +
      "overlay (specs/instrumentation.md)",
  );

  assertHeld(before, opened, ticksOpened, "the overlay being opened");
  assertHeld(
    before,
    after,
    ticksClosed,
    "the overlay being opened and closed again",
  );
});
