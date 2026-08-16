// Automated validation for the Waves item `count-increases`: clearing every rock advances
// to a new wave with more rocks. A real game is started and its first wave WAITED FOR; its
// number and rock count are read, the field is then SHOT down to nothing, and the real
// spawner's next, denser wave is waited for and read in turn.
//
// Waiting is one of the two corrections here. A new game does not necessarily open with its
// first wave already on the field: `specs/ui.md` puts a `WAVE N` banner "at the start of each
// wave" and `specs/instrumentation.md` defines the wave number as "0 before the first
// spawns", so a build that raises `WAVE 1`, holds it for its second or so, and then spawns is
// reporting wave 0 with an empty field for that whole opening — exactly as specified.
// Sampling the instant the game starts reads that opening and calls it wave 1 with no rocks;
// sampling a fixed 1.7 s after the clear then reads the FIRST wave arriving and calls it the
// second. Both readings are off by one whole wave against a conformant build. Waiting for
// each wave to actually be on the field measures the waves themselves, and works just as well
// on a build that spawns wave 1 immediately.
//
// SHOOTING THE FIELD DOWN IS THE OTHER. An earlier revision emptied the field with
// `clearRocks()` and called it "as if every rock were destroyed". It is not: `clearRocks` is
// specified as a way to make room ("so a scenario can start from a known-empty field or
// isolate a single rock it adds"), it awards no score, and nothing in
// `specs/instrumentation.md` says a wave turns over on it. `specs/gameplay.md` says how a
// wave is cleared — "no rocks remain on the field, which happens only by shooting every rock
// down to nothing" — so a build is free to raise its next wave from the destruction that
// empties the field rather than from polling the field's emptiness. The two are the same
// thing in play, and they come apart only under a debug op that removes rocks without
// destroying them. One graded build implements it that way, clears wave after wave correctly
// when played, and was failed here — along with `waves/banner` and
// `waves/plays-through-banner`, which emptied the field the same way — for a wave loop that
// works. Shooting the rocks down grades the wave loop on the path the spec names.
//
// The grinding is `skipShootRocksDown`, which is instant in both passes: forty-odd rounds of
// armor and fragments is the journey to the evidence, not the evidence, and a reviewer should
// not sit through it. It leaves ONE rock — a Small, since destroying a Small is the only kill
// that shrinks the field — so `act` is the single shot that empties the field, the banner,
// and the denser wave arriving. That is the whole item in about three seconds of clip.

import {
  TICK,
  ticks,
  actShootRockAt,
  skipShootRocksDown,
} from "../_helpers.mjs";

const WINDOW = ticks(5); // generous: the banner between waves is about 1.5 s
const SETTLE = 12; // 0.1 s, so a wave spawned across a few steps is read whole

export default function item() {
  // Whether each wave arrived, and the state of each once it had.
  let first;
  let second;
  let w1;
  let w2;
  // The grind that left one rock for `act` to shoot, what it left, and the shot itself.
  let ground;
  let lastRock;
  let cleared;

  return {
    id: "waves.count-increases",

    async arrange(api) {
      await api.reset({ seed: 3 });
      await api.call("startGame");
      await api.call("setInvuln", 99); // seconds — keep the ship alive through the measurement

      // Skip ahead to the first wave actually being fielded, so its count is the count
      // the wave was spawned with.
      first = await api.skipUntil((s) => s.wave >= 1 && s.rocks.length > 0, {
        max: WINDOW,
        poll: TICK,
      });
      await api.skip(SETTLE);
      w1 = await api.snapshot();

      // Shoot wave 1 down to its last rock, off camera.
      ground = await skipShootRocksDown(api, { leave: 1 });
      lastRock = (await api.snapshot()).rocks.length;
    },

    async act(api) {
      // The last rock dies, which clears the wave.
      cleared = await actShootRockAt(api, { x: 640, y: 360 });

      // The wave that clear brought on, once IT is fielded.
      second = await api.until(
        (s) => s.wave >= w1.wave + 1 && s.rocks.length > 0,
        {
          max: WINDOW,
          poll: TICK,
        },
      );
      await api.advance(SETTLE);
      w2 = await api.snapshot();
      await api.advance(60); // 0.5 s holding on the denser field, for the clip
    },

    async assert(api, check) {
      check.expectOk("a first wave is fielded", first.hit);
      check.expectEq("the first wave is wave 1", w1.wave, 1);
      check.expectEq("wave 1 fields four rocks", w1.rocks.length, 4);

      // If the grind could not get the field down to one rock there was nothing for the
      // shot in `act` to clear, and what follows would be read against a field that was
      // never emptied.
      check.expectEq(
        `wave 1 was shot down to a single rock (in ${ground} rounds)`,
        lastRock,
        1,
      );
      check.expectEq(
        "the last rock was shot away, leaving the field empty",
        cleared.snap.rocks.length,
        0,
      );

      check.expectOk("clearing the field brings on another wave", second.hit);
      check.expectEq("clearing the field advances to wave 2", w2.wave, 2);
      check.expectEq("wave 2 fields more rocks (five)", w2.rocks.length, 5);
    },
  };
}
