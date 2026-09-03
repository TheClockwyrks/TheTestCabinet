// screens/mute-playable — the game stays playable muted.
//
// WHAT THIS DECIDES. One thing: muting takes the sound away and nothing else. A
// whole short night is played muted, from the title through movement, a level-up
// and its choice, a pause and a resume, and every step reaches the state it
// reaches unmuted.
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
//   `KeyD`.
//   specs/instrumentation.md ("A deterministic core"): "Given the same seed,
//   the same sequence of operations, and the same number of ticks, the game
//   reaches the same `run` and `rngState` every time", which is what makes the
//   muted night and the unmuted one comparable at all.
//
// THE DRIVE. The same night twice, on two harnesses laid with the same seed and
// given the same keys, one muted at the title and one given a key bound to no
// action in its place, so both spend the same frames on the same screens. Every
// step is a real key: `Enter` on `LIGHT THE LAMP`, `ArrowRight` held, `Enter` on
// the offer, `KeyP` and `KeyP` again. The one pose is `setPendingLevelUps`,
// which queues the level-up the overlay opens from, since a scenario that had to
// collect enough gems to earn one would be grading the drop rate.
//
// The muted night's own steps are asserted first, so a build that cannot be
// played muted fails on the step it failed at; then the two nights' runs are
// compared stage by stage, which is what "exactly as unmuted" means. The mute
// bit is read from the first playing stage on, because the specification
// requires the mirror only "every frame" and fixes no order within one.
//
// THE TOLERANCE. None: screens, counts, and the run's stored fields are exact,
// and the lamplighter's movement is read as a strict increase in `x`, since the
// distance it covers is the lamplighter category's point rather than this one's.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { DEFAULT_SEED, UNBOUND_KEY } from "../constants";
import {
  captureReplay,
  createHarness,
  hold,
  runFields,
  tap,
  type Harness,
  type WickSnapshot,
} from "../harness";

let h: Harness;

/** How long the lamplighter is walked, in whole ticks. */
const WALK_TICKS = 30;

/** One stage of the night, named for the failure that reports it. */
interface Stage {
  name: string;
  snapshot: WickSnapshot;
}

/**
 * Play the same short night on `harness`, muted or not, and hand back what each
 * step left. The muting press is replaced by a key bound to no action when the
 * night is played unmuted, so both nights spend the same frames on the same
 * screens.
 */
async function playthrough(harness: Harness, mute: boolean): Promise<Stage[]> {
  harness.reset(DEFAULT_SEED);
  await tap(harness, mute ? "KeyM" : UNBOUND_KEY);
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

it("plays a night muted exactly as it plays unmuted", async () => {
  const muted = await captureReplay(h, "playable", () => playthrough(h, true));

  const [started, walked, overlay, accepted, paused, resumed] = muted;
  assertEqual(started.snapshot.screen, "playing", started.name);
  assertEqual(
    started.snapshot.run.player.x,
    0,
    "the lamplighter's x at the world origin",
  );
  assertGreaterThan(
    walked.snapshot.run.player.x,
    started.snapshot.run.player.x,
    "the lamplighter's x after ArrowRight was held",
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

  const control = await createHarness();
  try {
    const unmuted = await playthrough(control, false);
    for (let stage = 0; stage < muted.length; stage += 1) {
      assertEqual(
        unmuted[stage].snapshot.muted,
        false,
        `the control night's mute bit at ${muted[stage].name}`,
      );
      assertDeepEqual(
        runFields(muted[stage].snapshot.run),
        runFields(unmuted[stage].snapshot.run),
        `the muted night at ${muted[stage].name}, against the same night unmuted`,
      );
    }
  } finally {
    control.dispose();
  }
});
