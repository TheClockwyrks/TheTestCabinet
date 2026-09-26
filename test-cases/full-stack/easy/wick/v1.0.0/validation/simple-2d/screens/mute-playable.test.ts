// screens/mute-playable — the game stays playable muted.
//
// WHAT THIS DECIDES. One thing: muting takes the sound away and nothing else. A
// whole short night is played muted, from the title through movement, a level-up
// and its choice, a pause and a resume, and every step reaches the screen and
// the figures the rules give it.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("Audio"): "The game binds the `mute` action to
//   `api.audio.setMuted` and toggles it from any screen ... The game stays
//   fully playable with sound muted."
//   specs/ui.md (`title`): "`LIGHT THE LAMP` | Starts a fresh run ... and sets
//   `screen = playing`"; (`levelup`): "`confirm` accepts the highlighted offer
//   ... else `screen = playing`"; (`paused`): "`pause` returns to `playing`".
//   specs/controls.md ("Moving the lamplighter"): "On `playing`, the four
//   movement actions are read as held values", and `right` is `ArrowRight`,
//   `KeyD`; specs/world.md ("Movement"): "each tick the position advances by
//   the velocity times `TICK_DT`", at `MOVE_SPEED` (180) with no Bellows held.
//
// THE DRIVE. Every step is a real key: `KeyM` on the title, `Enter` on
// `LIGHT THE LAMP`, `ArrowRight` held, `Enter` on the offer, `KeyP` and `KeyP`
// again. The one pose is `setPendingLevelUps`, which queues the level-up the
// overlay opens from, since a scenario that had to collect enough gems to earn
// one would be grading the drop rate. The mute bit is read from the first
// playing stage on, because the specification requires the mirror only "every
// frame" and fixes no order within one.
//
// THE TOLERANCE. `MOTION_TOLERANCE` on the lamplighter's travel, a figure
// summed tick by tick; screens and counts are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertWithin } from "../assert";
import { MOTION_TOLERANCE, MOVE_SPEED, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  hold,
  tap,
  type Harness,
  type WickSnapshot,
} from "../harness";

let h: Harness;

/** How long the lamplighter is walked, in whole ticks. */
const WALK_TICKS = 30;

/** How far that walk carries it (specs/world.md, Movement). */
const TRAVEL = MOVE_SPEED * TICK_DT * WALK_TICKS;

/** One stage of the night, named for the failure that reports it. */
interface Stage {
  name: string;
  snapshot: WickSnapshot;
}

/** Play the same short night on `harness`, muted, and hand back what each step left. */
async function playthrough(harness: Harness): Promise<Stage[]> {
  harness.reset();
  await tap(harness, "KeyM");
  const stages: Stage[] = [];

  stages.push({
    name: "the run started from the title",
    snapshot: await tap(harness, "Enter"),
  });
  stages.push({
    name: "the lamplighter walked",
    snapshot: await hold(harness, "ArrowRight", WALK_TICKS),
  });

  harness.debug.setPendingLevelUps(1);
  stages.push({
    name: "the level-up overlay opened",
    snapshot: await harness.tick(1),
  });
  stages.push({
    name: "the offer accepted",
    snapshot: await tap(harness, "Enter"),
  });
  stages.push({ name: "the run paused", snapshot: await tap(harness, "KeyP") });
  stages.push({
    name: "the run resumed",
    snapshot: await tap(harness, "KeyP"),
  });
  return stages;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays a night muted through every screen it names", async () => {
  const muted = await captureReplay(h, "playable", () => playthrough(h));

  const [started, walked, overlay, accepted, paused, resumed] = muted;
  assertEqual(started.snapshot.screen, "playing", started.name);
  assertEqual(
    started.snapshot.run.player.x,
    0,
    "the lamplighter's x at the world origin",
  );
  assertWithin(
    walked.snapshot.run.player.x - started.snapshot.run.player.x,
    TRAVEL,
    MOTION_TOLERANCE,
    `the lamplighter's travel over ${WALK_TICKS} ticks of a held right`,
  );
  assertEqual(overlay.snapshot.screen, "levelup", overlay.name);
  assertGreaterThanOrEqual(
    overlay.snapshot.run.offers.length,
    1,
    "offers the overlay presents",
  );
  assertEqual(accepted.snapshot.screen, "playing", accepted.name);
  assertEqual(
    accepted.snapshot.run.pendingLevelUps,
    0,
    "level-ups left queued",
  );
  assertEqual(paused.snapshot.screen, "paused", paused.name);
  assertEqual(resumed.snapshot.screen, "playing", resumed.name);
  for (const stage of muted) {
    assertEqual(stage.snapshot.muted, true, `the mute bit at ${stage.name}`);
  }
});
