// audio/one-per-tick — a tick sounds each cue it raises exactly once.
//
// specs/progression.md governs all seven cues with one sentence: "Each is played
// on the tick its event happens, and at most once on that tick." The seven points
// beside this one decide the FIRST half — the cue sounded, and on the event's own
// tick. This one decides the second, which none of them can: a scenario that
// stages one event has only one play to count, and a build that sounded a cue
// twice for one event and a build that sounded it once are the same reading there.
//
// SCOPED TO THE TWO ENGINES. The claim is a COUNT of plays of a NAMED cue, and
// under `none` the build writes its whole audio layer, so what is observable in a
// browser is that a sound was emitted and on which tick — not which cue it was,
// and not how many plays one blip was made of, since a cue may honestly be a tone
// and a noise burst together. The count this point is entirely about is not
// decidable there, so it leaves the checklist of a `none` run rather than
// pretending to decide it.
//
// THE TICK COUNTED IS THE ONE A CLEARED MAZE RAISES TWO CUES ON. The mouthful
// that takes a maze's last plankton raises `eat` and, by clearing the maze,
// `descend`. Each has to sound exactly once on it, which is the at-most-once rule
// read across two names on one tick.
//
// WHY NOT ONE CUE RAISED TWICE. Two Gloamfins casting on the same tick would read
// the same rule over a single name, but nothing in the rendered specs fixes the
// value a Gloamfin's ping timer opens on: specs/predators/gloamfin.md fixes only
// that the timer runs down every step and that a cast sets it back to
// `GLOAMFIN_PING_INTERVAL`, and specs/instrumentation.md's `addPredator` says
// nothing about it. A build that arms each Gloamfin's opening phase
// independently — so two hunters do not ping in unison — honors every stated
// requirement and would never produce the coincident tick, so this point does not
// ask for one.
//
// THE BOARD IS POSED DOWN TO WHAT THE HALF IS ABOUT: one plankton, on the tile
// ahead of the forager, and nothing else left on the board to eat.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan } from "../assert";
import { BINDINGS, CUES } from "../constants";
import { poseMoveKeyRun, stockPlankton } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `right` to first, which swims the forager. */
const MOVE_KEY = BINDINGS.right[0];

/**
 * The frames the forager is given to swim into the maze's last plankton.
 *
 * At `FORAGER_SPEED` (`128`) a tile is `0.25 s` and the forager's center enters
 * the next tile half a tile in, so a conforming build eats inside `0.13 s`. Half
 * a second is a hard ceiling four times that.
 */
const EAT_TICKS = ticks(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds eat and descend once each on the tick a maze is cleared", async () => {
  await startPlaying(h);
  const run = await poseMoveKeyRun(h, "right");
  // One plankton, on the tile the forager swims into: the mouthful that takes it
  // is both an eat and the maze cleared, which raises the two cues on one tick.
  await stockPlankton(h, []);
  h.debug.clearPlankton();
  const ahead = { tx: run.start.tx + 1, ty: run.start.ty };
  h.debug.setPlankton(ahead.tx, ahead.ty, true);
  assertEqual(
    h.snapshot().planktonRemaining,
    1,
    "the plankton left on the board, so the mouthful ahead is the one that " +
      "clears the maze (specs/gameplay.md)",
  );

  const watch = await captureReplay(h, "once", async () => {
    h.hold(MOVE_KEY);
    let eat = 0;
    let descend = 0;
    let found = false;
    for (let step = 1; step <= EAT_TICKS && !found; step += 1) {
      const read = h.cues.length;
      await h.advance(1);
      const played = h.cues.slice(read).map((one) => one.cue);
      if (played.includes(CUES.eat) || played.includes(CUES.descend)) {
        eat = played.filter((cue) => cue === CUES.eat).length;
        descend = played.filter((cue) => cue === CUES.descend).length;
        found = true;
      }
    }
    h.release(MOVE_KEY);
    return { eat, descend, found, snapshot: h.snapshot() };
  });

  assertEqual(
    watch.found,
    true,
    `the forager reached the maze's last plankton inside ${String(EAT_TICKS)} ` +
      "ticks, which is the tick this point counts",
  );
  if (!watch.found) return;
  assertGreaterThan(
    watch.eat + watch.descend,
    0,
    "cues sounded on the tick the last plankton was eaten (specs/progression.md)",
  );
  assertEqual(
    watch.eat,
    1,
    `plays of ${CUES.eat} on the tick the maze's last plankton was eaten — a ` +
      "cue is played at most once on the tick that raises it " +
      "(specs/progression.md)",
  );
  assertEqual(
    watch.descend,
    1,
    `plays of ${CUES.descend} on that same tick, which clearing the maze ` +
      "raises alongside the eat (specs/progression.md)",
  );
});
