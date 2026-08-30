// Wireworm — instrumentation/worm-entry-gate: `setWormEntry(false)` keeps the
// level's worm away as the banner gives way, and turning it back on lets it in.
//
// specs/instrumentation.md: "The level's and the respawn's entry of a worm. Off,
// no worm appears unless one is added." specs/progression.md fixes the moment the
// gate stands at: "When the `banner` phase's timer runs out, the phase becomes
// `active` and the level's worm enters... The worm enters at that moment and at no
// other."
//
// WHY THE SUITE RESTS ON IT. Nearly every scenario in this project poses the worms
// it is about and no others, and without this gate it would be left to the build
// whether a level's own worm materialises in the middle of one. `startPlaying`
// therefore opens on a board with entry gated off, and this point is what says
// that gate works before anything leans on it.
//
// THE TRANSITION IS DRIVEN, NOT POSED. The rule is about a banner GIVING WAY, so
// the board is posed on the `banner` phase with its timer at `BANNER_TIME` and
// the frames that run it out are advanced; a phase posed straight into `active`
// would never reach the moment the rule is written about. The gate-off half then
// runs a further ten seconds, so a build that brings a worm in late rather than
// at the transition fails it too.
//
// FOE SPAWNING AND THE CURSOR'S CONTACT TEST STAY OFF throughout, at level 1,
// where specs/foes.md opens no spawner anyway: what this point reads is the worm
// roster, and nothing else may reach into it.
//
// The two directions are two checks, so a build that gates nothing and a build
// that brings in no worm at all grade differently.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The seconds of active play the item runs past the transition. */
const AFTER_S = 10;

/** Frames covering the banner, plus one so the transition has run. */
const BANNER_TICKS = ticksFor(BANNER_TIME) + 1;
const AFTER_TICKS = ticksFor(AFTER_S);

/** Pose a quiet level-1 board on its banner, with worm entry as given. */
function openLevel(h: Harness, entry: boolean): void {
  startPlaying(h);
  h.debug.setWormEntry(entry);
  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(BANNER_TIME);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings in no worm over ten seconds with entry off", async () => {
  openLevel(h, false);

  await h.advance(BANNER_TICKS);
  assertEqual(
    h.snapshot().phase,
    "active",
    "the banner gives way to active play (specs/progression.md)",
  );
  assertLength(
    h.snapshot().worms,
    0,
    "no worm enters as the banner gives way with setWormEntry(false) " +
      "(specs/instrumentation.md)",
  );

  await h.advance(AFTER_TICKS);
  // The active level no worm entered.
  captureStill(h, "gated");

  assertLength(
    h.snapshot().worms,
    0,
    `no worm enters over the ${String(AFTER_S)} seconds of active play that ` +
      "follow, either (specs/instrumentation.md)",
  );
  assertEqual(
    h.snapshot().wormEntry,
    false,
    "the gate is still off at the end of the sweep",
  );
});

it("brings in the level's worm as the banner gives way with entry on", async () => {
  openLevel(h, true);

  await h.advance(BANNER_TICKS);
  const opened = h.snapshot();

  assertEqual(
    opened.phase,
    "active",
    "the banner gives way to active play (specs/progression.md)",
  );
  assertLength(
    opened.worms,
    1,
    "the level's worm enters as the banner gives way with setWormEntry(true) " +
      "(specs/progression.md)",
  );
});
