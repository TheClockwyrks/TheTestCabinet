// Meltdown — audio/no-autoplay: a freshly loaded build plays nothing until the
// first input reaches it.
//
// `specs/audio.md` states it directly: "The engine owns the first-interaction
// unlock, so the game plays nothing before the first input reaches it and it
// starts and runs correctly whether or not audio can start." The rule that makes
// it decidable is the same one every other point in this group rests on — "an
// event that does not resolve raises nothing" — because on a freshly loaded
// build sitting on its title screen, no event has resolved.
//
// THE READING STARTS BEFORE THE GAME DOES. `createHarness` subscribes to the
// engine's cue bus BEFORE it calls `initialize`, and construction runs no game
// code, so `h.cues` holds every play the build has ever made, including any it
// made while defining its cues or opening its first screen. That is what makes
// this a reading of the LOAD and not merely of the frames after it.
//
// THE SECOND HALF IS WHAT KEEPS THE FIRST HONEST. Silence alone is also what a
// build that has no audio at all produces, so the input the item names is
// delivered afterwards and the cue it must raise is read: a build that passes the
// quiet half by never playing anything fails here. The input is one `down` on the
// title menu, which `specs/audio.md` binds to the `menu` cue — the cheapest event
// a game one frame old can resolve.
//
// NOTHING HERE NEEDS AUDIO TO BE AUDIBLE. The engine announces a play whether or
// not its context has been unlocked, so this check reads what the build ASKED
// FOR, which is the thing the build controls.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Frames the freshly loaded build is left to itself.
 *
 * Two seconds of the suite's clock, which is far longer than any opening
 * animation or first-frame setup a title screen could carry, so a build that
 * sounds anything on its own — a start-up sting, a menu blip on the frame it
 * opens, a loop it left running — has sounded it inside this window.
 */
const IDLE_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays nothing before the first input, and plays on the input that follows", async () => {
  // Read before a single frame has run: everything the build did while it was
  // being initialized is already in here.
  assertDeepEqual(
    h.cues.map((cue) => cue.cue),
    [],
    "the cues the build played while it was loading, before any frame ran — " +
      "the game plays nothing before the first input reaches it " +
      "(specs/audio.md)",
  );

  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: a freshly loaded build opens on the title screen " +
      "(specs/screens.md)",
  );

  await h.advance(IDLE_TICKS);
  captureStill(h, "silent");

  assertDeepEqual(
    h.cues.map((cue) => cue.cue),
    [],
    `the cues the build played over the ${String(IDLE_TICKS)} frames it ran ` +
      "with no input at all (specs/audio.md)",
  );

  // The first input. `specs/audio.md` answers a menu highlight moving with the
  // `menu` cue, so silence past this line would be a build with no audio rather
  // than a build that waits for the interaction.
  await tapAction(h, "down");

  assertLength(
    h.cues.filter((cue) => cue.cue === CUES.menu),
    1,
    "plays of the menu cue on the first input to reach the build — silence " +
      "before the first interaction is only meaningful if the build sounds " +
      "after it (specs/audio.md)",
  );
});
