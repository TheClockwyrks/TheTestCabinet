// audio/music-restarts-on-pause-restart — the round RESTART lays out has the
// bed under it.
//
// WHAT THE SPECIFICATION FIXES. `specs/ui.md` plays `music` when "a round
// begins" and has the bed "loop under the round it began with", and of the
// pause menu: "`RESTART` starts a fresh round in the same mode." It names this
// path outright: "A round laid out by `RESTART` or by `PLAY AGAIN` is a round
// beginning, so the bed sounds under it. The bed the paused round kept playing
// carries on as the restarted round's own."
//
// WHY THE PAUSE PATH IS ITS OWN POINT. `music-cue-plays` decides the title path
// and nothing else: it watches a bed start on a board that had none under it.
// The pause is the one entry into a fresh round reached from a screen the
// specification keeps the bed running on — "It keeps playing while that round is
// paused, because pausing has not ended the round" — so a build that retires the
// bed on the way into the pause menu, or as it lays the round RESTART asked for,
// leaves the player in a fresh round in silence while getting the title path
// right. That is a different observable behaviour, so it is a different point.
//
// WHAT IS SOUNDING IS READ, NOT WHAT WAS ASKED FOR. A cue log records the
// moments a bed was ASKED for, and what an engine announces is a bed STARTING: a
// build asking for a bed that is already looping is asking for what it already
// has, and there is nothing to announce. The bed the paused round left running
// is exactly that, so a log would read silence for a build whose music never
// stopped. `harness.looping` reads the other thing, which is whether the bed is
// sounding now. That is what the player hears, and both of the routes to it the
// specification allows — carrying the running bed on, and retiring it and
// starting another — satisfy it.
//
// WHY EVERY SCREEN HERE IS REACHED BY PRESSING A KEY. What the point is about is
// a round BEGINNING, and `specs/instrumentation.md` says a posed screen is not
// one: "moving to `playing` this way runs the tick over the board as it stands
// rather than laying out a fresh round". Only a menu accepting its item begins a
// round, so the drive runs title to round to pause to restart. The highlight is
// posed onto `RESTART` rather than pressed for, so a build whose highlight will
// not move fails `controls/menu-highlight-moves` alone rather than losing this
// point to it.
//
// WHAT IS ASSERTED. That the fresh round was actually laid — a build that merely
// returned to `playing` has not begun a round and is failing `states/pause-restart`
// rather than this — and that the music bed is sounding under that round once it
// has run for a few ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS, CUES, PAUSE_ITEMS, START_CELLS } from "../constants";

import {
  captureReplay,
  createHarness,
  startRoundWithKeys,
  type Harness,
} from "../harness";

/** `RESTART` is the second item of `PAUSE_ITEMS` (specs/ui.md). */
const RESTART_INDEX = PAUSE_ITEMS.indexOf("RESTART");

/** Ticks of the first round driven before it is paused, so the bed is under it. */
const ROUND_TICKS = 8;

/** The first key `specs/controls.md` binds to `confirm`. */
const CONFIRM = BINDINGS.confirm[0];

/** The first key `specs/controls.md` binds to `pause`. */
const PAUSE = BINDINGS.pause[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the music bed under the round RESTART lays out", async () => {
  await startRoundWithKeys(h);
  await h.tick(ROUND_TICKS);

  await h.tap(PAUSE);
  const paused = h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the pause opened");
  h.debug.setMenuIndex(RESTART_INDEX);

  const fresh = await captureReplay(h, "restart", async () => {
    await h.tap(CONFIRM);
    const begun = h.snapshot();
    await h.tick(ROUND_TICKS);
    return begun;
  });

  assertEqual(fresh.screen, "playing", "the screen RESTART opened");
  assertDeepEqual(
    fresh.snake,
    START_CELLS,
    "the chain the fresh round opens on",
  );
  assertEqual(
    h.looping(CUES.music),
    true,
    `whether the bed was sounding ${ROUND_TICKS} ticks into the fresh round`,
  );
});
