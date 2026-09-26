// The step schedule: what each clock hands out, and what it takes back.
//
// A clock's `delta` is read one frame at a time by the driven loop, so where it
// stands is never in doubt there. An IN-PAGE sweep is the case that puts it in
// doubt: the frames run inside the page, so every delta the sweep might run has
// to be drawn before the crossing opens — and a sweep that stops on its predicate
// runs fewer of them than it drew. Without `rewind` the clock would be left
// further along than the frames that actually ran, and the next sweep would step
// differently for it: a `SequenceClock` would resume mid-pattern and a
// `JitterClock` at the wrong index, so a check whose whole claim is that its
// failing case REPLAYS would not replay.

import { afterEach, expect, it } from "vitest";
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  type Clock,
} from "../src/index";
import { createHarness, type Harness } from "./fixture";

/** The next `count` deltas a clock hands out. */
function drawn(clock: Clock, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(clock.delta());
  return out;
}

let h: Harness | null = null;

afterEach(async () => {
  await h?.dispose();
  h = null;
});

it("puts a sequence clock back where the frames that ran left it", () => {
  const clock = new SequenceClock([10, 20, 30, 40]);
  expect(drawn(clock, 4)).toEqual([10, 20, 30, 40]);

  // Three of those four went unused, so the next delta is the one that followed
  // the one frame that ran.
  clock.rewind(3);
  expect(drawn(clock, 3)).toEqual([20, 30, 40]);

  // Floored at the opening step, so a sweep handed more deltas than this clock
  // ever produced cannot wind it into a negative index.
  clock.rewind(1000);
  expect(drawn(clock, 2)).toEqual([10, 20]);
});

it("puts a jitter clock back, so the failing case still replays", () => {
  const seeded = () => new JitterClock(8, 24, 1234);
  const straight = drawn(seeded(), 6);

  const wound = seeded();
  drawn(wound, 6);
  wound.rewind(4);
  // The draw is a pure function of the seed and the index, so winding the index
  // back is exactly as strong as never having drawn: the sequence from here is
  // the one the unused draws would have been.
  expect(drawn(wound, 4)).toEqual(straight.slice(2));
});

it("asks nothing of a clock every frame of which is the same", () => {
  // A constant clock genuinely has nothing to put back, which is why it carries
  // the member as a no-op rather than not carrying it: the shape a case copies
  // from should have it, so swapping in a stepping clock changes no call site.
  // Held at the interface, which is how the harness holds one: `rewind` is
  // optional there, and this is a clock that answers it.
  const clock: Clock = new ConstantClock(16);
  expect(drawn(clock, 3)).toEqual([16, 16, 16]);
  clock.rewind?.(3);
  expect(drawn(clock, 1)).toEqual([16]);
});

it("hands an in-page sweep's unused deltas back to the clock", async () => {
  // The whole reason the member exists, end to end. The sweep is given a bound of
  // four frames and stops after one, so three deltas go back — and the drive that
  // follows takes the SECOND step of the pattern rather than resuming past the
  // frames nobody ran.
  h = await createHarness({ clock: new SequenceClock([10, 20, 30, 40]) });
  const swept = await h.sweep((snapshot) => snapshot.frames >= 1, null, {
    maxFrames: 4,
  });

  expect(swept.hit).toBe(true);
  expect(swept.frames).toBe(1);
  // One frame ran, so one delta was spent: the first of the pattern.
  expect(h.frame()).toBe(1);
  expect(h.timeMs()).toBe(10);

  await h.advance(1);
  expect(h.frame()).toBe(2);
  expect(h.timeMs()).toBe(30);
});

it("hands a stopped reading run's unused deltas back the same way", async () => {
  // `samples` draws its deltas up front for the same reason and stops early for a
  // different one — its `stop` rather than a predicate — so it hands them back at
  // the same place.
  h = await createHarness({ clock: new SequenceClock([10, 20, 30, 40]) });
  const run = await h.samples(4, {
    project: (snapshot) => snapshot.frames,
    argument: null,
    stop: (sample) => sample >= 2,
  });

  expect(run.samples).toEqual([0, 1, 2]);
  expect(run.frames).toBe(2);
  expect(h.timeMs()).toBe(30);

  await h.advance(1);
  expect(h.timeMs()).toBe(60);
});

it("drives a clock that carries no rewind at all", async () => {
  // `HarnessOptions.clock` accepts any object of the shape, and the cases write
  // their own — a paced clock, a coasting one, a tunable one, each a dozen lines
  // implementing `delta` and nothing else. Making `rewind` required would have
  // stopped every one of them compiling for a member most would implement as a
  // no-op, so a clock without it simply keeps the deltas it handed out.
  let handed = 0;
  const bare: Clock = {
    delta() {
      handed += 1;
      return 10;
    },
  };
  h = await createHarness({ clock: bare });

  const swept = await h.sweep((snapshot) => snapshot.frames >= 1, null, {
    maxFrames: 5,
  });
  expect(swept.frames).toBe(1);
  // All five were drawn and four went unused; the harness counted the one frame
  // that ran, which is the reading a check reads.
  expect(handed).toBe(5);
  expect(h.frame()).toBe(1);
  expect(h.timeMs()).toBe(10);
});
