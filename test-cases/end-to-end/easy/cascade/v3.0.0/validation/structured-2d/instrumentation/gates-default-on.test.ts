// instrumentation/gates-default-on — all four faculties start on, and `reset`
// turns them back on.
//
// THE RULE. specs/instrumentation.md, under The faculty gates: "each gates one
// faculty and nothing else, each is on by default and restored to on by
// `reset`, and each is reported by `snapshot`". That is TWO facts, and this
// point owes both. specs/state.md carries the first in as many words: all four
// "are on when a game begins, and the debugging surface poses them".
//
// WHY IT MATTERS ON ITS OWN. Every suite opens by resetting, and a check that
// says nothing about a gate is relying on that reset to have left the faculty
// running: a build whose `reset` left `winDetect` off would win no game under
// any check in the `winning` group, and a build whose reset left `autoFlip` off
// would turn no exposed card in the `tableau` group. The gates are the one part
// of the reset list whose failure would be read as a fault in a rule rather
// than in the reset.
//
// TWO CHECKS, BECAUSE THEY FAIL ON DIFFERENT BUILDS. The first reads the game
// as it STARTS, before anything has been posed at all, which is the state a
// player meets; a build that declares its gates off fails it whatever its
// `reset` does, and `createHarness` never resets, so the reading really is of
// the pristine game. The second poses all four off and resets, which is what a
// build that restores nothing fails — and it reads the four back off first, so
// what follows is a reading of a restoration rather than of a gate that would
// not go off in the first place.
//
// ALL FOUR ARE READ AS ONE TUPLE, so a build that gets three of them right
// names the fourth rather than reporting a bare `false`.
//
// THE READING IS TAKEN WITH NO FRAME ADVANCED. Under this engine a pose acts on
// the live game at the call, so the gates are back the moment `reset` returns.
//
// WHAT IT DOES NOT DECIDE. What each gate GATES is
// `instrumentation/auto-flip-gate`, `win-detect-gate`, `launching-gate` and
// `trail-painting-gate`; the rest of the reset list is
// `instrumentation/reset-restores-title`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The four faculty gates, read as one comparable tuple. */
interface Gates {
  autoFlip: boolean;
  winDetect: boolean;
  launching: boolean;
  trailPainting: boolean;
}

/** Every gate on: the value the specification gives all four. */
const ALL_ON: Gates = {
  autoFlip: true,
  winDetect: true,
  launching: true,
  trailPainting: true,
};

/** Every gate off: what the four are posed to before the reset. */
const ALL_OFF: Gates = {
  autoFlip: false,
  winDetect: false,
  launching: false,
  trailPainting: false,
};

/** The four gate fields of a snapshot, as one comparable tuple. */
function gates(snapshot: Gates): Gates {
  return {
    autoFlip: snapshot.autoFlip,
    winDetect: snapshot.winDetect,
    launching: snapshot.launching,
    trailPainting: snapshot.trailPainting,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every gate on in a game that has just started", async () => {
  // Nothing posed and nothing reset: the game as a player meets it.
  const opened = h.snapshot();

  await h.advance(1);
  captureStill(h, "opened");

  assertDeepEqual(
    gates(opened),
    ALL_ON,
    "the four faculty gates in a game that has just started, before " +
      "anything has been posed: each is on by default " +
      "(specs/instrumentation.md, specs/state.md)",
  );
});

it("reports every gate on after a reset that followed all four being turned off", async () => {
  h.debug.setAutoFlip(false);
  h.debug.setWinDetect(false);
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(false);

  // The four really went off, so what the reset restores is a gate that was
  // holding `false` rather than one that never moved.
  assertDeepEqual(
    gates(h.snapshot()),
    ALL_OFF,
    "the four faculty gates posed off, read before the reset — a gate that " +
      "would not go off leaves the reset nothing to restore",
  );

  h.debug.reset();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "reset");

  assertDeepEqual(
    gates(after),
    ALL_ON,
    "the four faculty gates after a reset that followed all four being " +
      "turned off: each is restored to on by reset " +
      "(specs/instrumentation.md)",
  );
});
