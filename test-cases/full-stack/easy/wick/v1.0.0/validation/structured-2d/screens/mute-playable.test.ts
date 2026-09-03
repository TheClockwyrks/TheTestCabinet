// Wick — screens/mute-playable: a muted run plays exactly as an unmuted one.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, Audio: "The game
// stays fully playable with sound muted." `specs/instrumentation.md`,
// "A deterministic core": "Given the same seed, the same sequence of
// operations, and the same number of ticks, the game reaches the same `run`
// and `rngState` every time. `simTime` and `muted` stand outside that", which
// is what makes "exactly as unmuted" a comparison rather than an impression.
//
// WHAT IS READ. Two things. First, that a muted run does each of the things
// the point names: it starts from the title on `LIGHT THE LAMP`, the
// lamplighter moves under a held key by `MOVE_SPEED` (`180`) units per second
// (`specs/world.md`, Movement), a level-up overlay opens and its highlighted
// offer is accepted (`specs/progression.md`), and the run pauses and resumes
// (`specs/ui.md`, `paused`). Second, that the run it reaches is the SAME run,
// field for field, and the same `rngState`, as the identical script driven
// unmuted from the same seed — so a build whose muted path skips a cue's
// side effect, or takes a different branch while silent, fails.
//
// WHY THE UNMUTED SCRIPT PRESSES A KEY TOO. The two runs must cover the same
// frames as well as the same ticks, so the control presses `UNBOUND_CODE`
// where the muted run presses `KeyM`: a `KeyboardEvent.code` `BINDINGS` gives
// no action and the engine reserves nothing (its overlay is on
// `OVERLAY_TOGGLE_CODE`), delivered on the title screen, which
// `specs/ui.md` says advances nothing.
//
// THE DRIVE. Both runs from `DEFAULT_SEED` through `reset`, every driver
// switch on as `reset` leaves them, so what runs beneath the script is the
// game's own night. The muted one is recorded for the replay.
//
// THE TOLERANCE. The lamplighter's travel is compared to `MOTION_EPS`, the
// suite's slack for a figure summed tick by tick; everything else is exact.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNear,
} from "../assert";
import { MOTION_EPS, MOVE_SPEED, OFFER_COUNT, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  hold,
  tap,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** A code BINDINGS gives no action and the engine reserves nothing. */
const UNBOUND_CODE = "F13";
/** How long the lamplighter is walked right, in whole ticks. */
const MOVE_TICKS = 30;
/** How far that walk carries it (specs/world.md, Movement). */
const TRAVEL = MOVE_SPEED * TICK_DT * MOVE_TICKS;

/** What one run of the script left at each of its stages. */
interface Played {
  started: WickSnapshot;
  moved: WickSnapshot;
  overlay: WickSnapshot;
  accepted: WickSnapshot;
  paused: WickSnapshot;
  resumed: WickSnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/**
 * The same script either way: one press on the title, `LIGHT THE LAMP`, a
 * walk to the right, a level-up overlay opened by a posed pending level-up and
 * its highlighted offer accepted, then a pause and a resume.
 */
async function play(mute: boolean): Promise<Played> {
  h.reset();
  await tap(h, mute ? "KeyM" : UNBOUND_CODE);
  const started = await tap(h, "Enter");
  const moved = await hold(h, "ArrowRight", MOVE_TICKS);
  h.debug.setPendingLevelUps(1);
  const overlay = await advanceTicks(h, 1);
  const accepted = await tap(h, "Enter");
  const paused = await tap(h, "KeyP");
  const resumed = await tap(h, "KeyP");
  return { started, moved, overlay, accepted, paused, resumed };
}

it("plays the same run muted as unmuted", async () => {
  // The control runs FIRST because `reset` leaves `muted` as it stands
  // (`specs/instrumentation.md`, `reset`): a control driven after the muted
  // run would start muted and be no control at all.
  const plain = await play(false);
  assertEqual(plain.resumed.muted, false, "muted through the control run");

  const muted = await captureReplay(h, "playable", () => play(true));

  assertEqual(muted.started.muted, true, "muted while the run is played");
  assertEqual(
    muted.started.screen,
    "playing",
    "the screen LIGHT THE LAMP entered",
  );
  assertNear(
    muted.moved.run.player.x - muted.started.run.player.x,
    TRAVEL,
    MOTION_EPS,
    `the lamplighter's travel over ${MOVE_TICKS} ticks of a held right`,
  );
  assertEqual(
    muted.overlay.screen,
    "levelup",
    "the screen the pending level-up opened",
  );
  assertLength(
    muted.overlay.run.offers,
    OFFER_COUNT,
    "the offers on the overlay",
  );
  assertEqual(
    muted.accepted.screen,
    "playing",
    "the screen accepting the offer returned to",
  );
  assertEqual(
    muted.accepted.run.pendingLevelUps,
    0,
    "the level-ups left after accepting",
  );
  assertEqual(muted.paused.screen, "paused", "the screen KeyP entered");
  assertEqual(
    muted.resumed.screen,
    "playing",
    "the screen the second KeyP returned to",
  );
  assertEqual(muted.resumed.muted, true, "muted at the end of the run");

  assertDeepEqual(
    muted.resumed.run,
    plain.resumed.run,
    "the run a muted script reaches, against the same script unmuted",
  );
  assertEqual(
    muted.resumed.rngState,
    plain.resumed.rngState,
    "rngState a muted script reaches, against the same script unmuted",
  );
});
