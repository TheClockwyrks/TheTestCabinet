// Automated validation for the Waves item `count-increases`: clearing every rock advances
// to a new wave with more rocks. A real game is started and its first wave WAITED FOR; its
// number and rock count are read, the field is then cleared, and the real spawner's next,
// denser wave is waited for and read in turn.
//
// Waiting is the whole correction here. A new game does not necessarily open with its first
// wave already on the field: `specs/ui.md` puts a `WAVE N` banner "at the start of each wave"
// and `specs/instrumentation.md` defines the wave number as "0 before the first spawns", so a
// build that raises `WAVE 1`, holds it for its second or so, and then spawns is reporting
// wave 0 with an empty field for that whole opening — exactly as specified. Sampling the
// instant the game starts reads that opening and calls it wave 1 with no rocks; sampling a
// fixed 1.7 s after the clear then reads the FIRST wave arriving and calls it the second.
// Both readings are off by one whole wave against a conformant build. Waiting for each wave
// to actually be on the field measures the waves themselves, and works just as well on a
// build that spawns wave 1 immediately.
//
// Only starting the game is a precondition (`arrange`). Reading wave 1, clearing the field and
// Reaching the FIRST wave is `arrange`, through `skipUntil`: it is the journey to the
// evidence, not the evidence, and on a build that opens with a banner it is a second and a
// half of empty field the clip is better off without. The clear and the wave it brings on are
// the behavior, so they stay in `act` — `clearRocks` is a control op, which is legal there —
// and the clip opens on a full field, empties it, and shows the denser wave arrive.

import { TICK, ticks } from "../_helpers.mjs";

const WINDOW = ticks(5); // generous: the banner between waves is about 1.5 s
const SETTLE = 12; // 0.1 s, so a wave spawned across a few steps is read whole

export default function item() {
  // Whether each wave arrived, and the state of each once it had.
  let first;
  let second;
  let w1;
  let w2;

  return {
    id: "waves.count-increases",

    async arrange(api) {
      await api.reset({ seed: 3 });
      await api.call("startGame");
      await api.call("setInvuln", 99); // seconds — keep the ship alive through the measurement

      // Skip ahead to the first wave actually being fielded, so `act` starts there.
      first = await api.skipUntil((s) => s.wave >= 1 && s.rocks.length > 0, {
        max: WINDOW,
        poll: TICK,
      });
      await api.skip(SETTLE);
      w1 = await api.snapshot();
    },

    async act(api) {
      await api.advance(60); // 0.5 s holding on the full field, for the clip

      await api.call("clearRocks"); // as if every rock were destroyed
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

      check.expectOk("clearing the field brings on another wave", second.hit);
      check.expectEq("clearing the field advances to wave 2", w2.wave, 2);
      check.expectEq("wave 2 fields more rocks (five)", w2.rocks.length, 5);
    },
  };
}
