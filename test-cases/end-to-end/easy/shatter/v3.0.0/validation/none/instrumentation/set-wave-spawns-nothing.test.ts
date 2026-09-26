// instrumentation/set-wave-spawns-nothing — `setWave(n)` changes the reported wave
// and leaves the rock roster exactly as it was.
//
// A POSE IS NOT A WAVE. `specs/instrumentation.md` says it directly — "Sets the
// current wave number. It spawns no rocks and clears none" — and it is the rule
// that keeps the surface atomic: every operation poses ONE field, and putting a
// wave of rocks up is the game's own wave loop rather than a side effect of writing
// a number. `startPlaying` poses a wave for almost every scenario in this project,
// so a build that spawned `WAVE_BASE_ROCKS + n` Large rocks on the pose would put
// them into every one of them.
//
// THE ROSTER IS NON-EMPTY WHEN THE POSE IS MADE, WHICH IS WHAT MAKES BOTH HALVES
// DECIDABLE. Two rocks are on the field: a build that SPAWNS reads back more than
// two, and a build that CLEARS reads back fewer. An empty field would only ever
// have caught the first of those.
//
// AND IT IS READ TWICE. Once with no tick at all between the pose and the reading,
// because `snapshot` is a pure read; and once a tick later, because a build that
// queues its spawn for the next update rather than doing it inside the operation
// would otherwise slip through.
//
// The game's own wave loop is shut throughout, which is where `startPlaying` leaves
// it. That is not a widening of what is asked: the loop has its own gate and its own
// item (`instrumentation/wave-spawning-gate`), and shutting it is what leaves the
// POSE as the only thing in the scenario that could have touched the roster.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";

/** The wave the run is posed at first. */
const OPENING_WAVE = 1;

/** The wave posed over it: several waves on, so the change is unmistakable. */
const POSED_WAVE = 5;

/** Where the two rocks stand: spread, at rest, and well clear of the star. */
const PLACES = [
  { size: "large", x: 200, y: 160 },
  { size: "small", x: 1080, y: 620 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes the wave and leaves the rock roster exactly as it was", async () => {
  await startPlaying(h, { wave: OPENING_WAVE });
  const ids: number[] = [];
  for (const place of PLACES) {
    ids.push(await poseRock(h, place.size, place.x, place.y));
  }
  const before = await h.step(1);
  assertEqual(before.wave, OPENING_WAVE, "the wave the run was posed at");

  await h.debug.setWave(POSED_WAVE);
  await captureStill(h, "posed");
  const posed = await h.snapshot();

  assertEqual(posed.wave, POSED_WAVE, "setWave");
  assertDeepEqual(
    posed.rocks.map((rock) => rock.id),
    ids,
    "the rocks setWave left on the field",
  );
  for (const [index, rock] of before.rocks.entries()) {
    assertEqual(posed.rocks[index].x, rock.x, `rocks[${index}].x`);
    assertEqual(posed.rocks[index].y, rock.y, `rocks[${index}].y`);
    assertEqual(posed.rocks[index].size, rock.size, `rocks[${index}].size`);
  }

  // And a tick later, so a build that queued its spawn for the next update is
  // caught rather than passing on the reading taken the instant the pose returned.
  const stepped = await h.step(1);
  assertEqual(stepped.wave, POSED_WAVE, "the wave a tick on");
  assertDeepEqual(
    stepped.rocks.map((rock) => rock.id),
    ids,
    "the rocks on the field a tick on",
  );
});
