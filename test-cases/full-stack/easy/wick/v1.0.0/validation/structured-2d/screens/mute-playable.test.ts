// Wick — screens/mute-playable: the game stays playable muted.
//
// WHAT THIS DECIDES. One thing: muting takes the sound away and nothing else.
// A whole short night is played muted, from the title through movement, a
// level-up and its choice, a pause and a resume, and every step reaches the
// screen and the figures the rules give it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, Audio: "The game
// stays fully playable with sound muted." `specs/ui.md` (`title`):
// `LIGHT THE LAMP` starts a fresh run and sets `screen = playing`;
// (`levelup`): `confirm` accepts the highlighted offer and returns to
// `playing` when nothing is queued; (`paused`): `pause` returns to `playing`.
// `specs/controls.md` ("Moving the lamplighter"): the movement actions are
// read as held values, and `right` is `ArrowRight`; `specs/world.md`
// ("Movement"): the lamplighter moves by `MOVE_SPEED` (`180`) units per
// second with no Bellows held.
//
// THE DRIVE. Every step is a real key: `KeyM` on the title, `Enter` on
// `LIGHT THE LAMP`, `ArrowRight` held, `Enter` on the offer, `KeyP` and `KeyP`
// again. The one pose is `setPendingLevelUps`, which queues the level-up the
// overlay opens from, since a scenario that had to collect enough gems to
// earn one would be grading the drop rate. Every driver switch is on as
// `reset` leaves them, so what runs beneath the script is the game's own
// night; nothing the night draws at random reaches a figure read here.
//
// THE TOLERANCE. The lamplighter's travel is compared to `MOTION_EPS`, the
// suite's slack for a figure summed tick by tick; screens and counts are
// exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
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

/** How long the lamplighter is walked right, in whole ticks. */
const MOVE_TICKS = 30;
/** How far that walk carries it (specs/world.md, Movement). */
const TRAVEL = MOVE_SPEED * TICK_DT * MOVE_TICKS;

/** What the script left at each of its stages. */
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
 * The script: `KeyM` on the title, `LIGHT THE LAMP`, a walk to the right, a
 * level-up overlay opened by a posed pending level-up and its highlighted
 * offer accepted, then a pause and a resume.
 */
async function play(): Promise<Played> {
  h.reset();
  await tap(h, "KeyM");
  const started = await tap(h, "Enter");
  const moved = await hold(h, "ArrowRight", MOVE_TICKS);
  h.debug.setPendingLevelUps(1);
  const overlay = await advanceTicks(h, 1);
  const accepted = await tap(h, "Enter");
  const paused = await tap(h, "KeyP");
  const resumed = await tap(h, "KeyP");
  return { started, moved, overlay, accepted, paused, resumed };
}

it("plays a night muted through every screen it names", async () => {
  const muted = await captureReplay(h, "playable", () => play());

  assertEqual(muted.started.muted, true, "muted while the run is played");
  assertEqual(
    muted.started.screen,
    "playing",
    "the screen LIGHT THE LAMP entered",
  );
  assertEqual(
    muted.started.run.player.x,
    0,
    "the lamplighter's x at the world origin",
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
});
