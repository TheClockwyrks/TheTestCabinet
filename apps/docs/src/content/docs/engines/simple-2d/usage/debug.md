---
title: Debug Surface
---

A build hands the engine one object a caller drives it through. The game builds
that surface in `initialize` over the state it just built and returns the two
together as the pair `[state, debug]`, and the engine returns the surface
unchanged from `engine.debug`. A caller poses a scenario through it, steps the
simulation, and reads the outcome back, with no keyboard and no waiting on real
time.

```ts
import type { Game } from "@test-cabinet/simple-2d";

interface State {
  phase: "serve" | "rally" | "over";
  ball: { x: number; y: number; vx: number; vy: number };
  score: { left: number; right: number };
}

interface Debug {
  place(x: number, y: number): void;
  serve(vx: number, vy: number): void;
  phase(): State["phase"];
  score(): { left: number; right: number };
}

const game: Game<State, Debug> = {
  initialize() {
    const state: State = {
      phase: "serve",
      ball: { x: 320, y: 180, vx: 0, vy: 0 },
      score: { left: 0, right: 0 },
    };

    const debug: Debug = {
      place(x, y) {
        state.ball.x = x;
        state.ball.y = y;
      },
      serve(vx, vy) {
        state.phase = "rally";
        state.ball.vx = vx;
        state.ball.vy = vy;
      },
      phase: () => state.phase,
      score: () => ({ ...state.score }),
    };

    return [state, debug];
  },
  update(state, api, dt) {
    step(state, dt);
  },
  render(state, api) {
    draw(api.ctx, state);
  },
};
```

The surface closes over the state the game is about to run, which is the same
value every frame reads and writes. An operation therefore moves the running
simulation, and a reading reports what the game holds at the instant it is
called.

## Declaring the type

`Game` takes the surface as a second type parameter alongside the state, and
`createEngine` infers both from the game the options carry. `D` defaults to
`unknown`. A game with no surface writes `Game<State, null>` and returns
`[state, null]`.

The engine holds the value and reads no member of it. The methods, their
signatures, and the vocabulary they use are the game's own design.

## What belongs on it

Offer the operations a scenario is written in rather than the fields of the
state: placing a piece, serving the ball, spawning a wave, ending a round,
reading the score. Each one runs through the same systems play runs through, so
a scenario posed from code and the same scenario reached by playing leave the
game in one state.

A diagnostic source names a value for a human reading the overlay; the surface
names the operations a caller drives from code, and the readings it needs to
decide what happened. Return a copy where a reading would otherwise hand back a
reference into the live state.

```ts
const debug: Debug = {
  spawn: (kind, x) => addEnemy(state, kind, x),
  live: () => state.enemies.length,
  hud: () => ({ lives: state.lives, wave: state.wave }),
};

return [state, debug];
```

## Returning it

`initialize` returns the state and the surface as one pair, so the surface is
in place before the first frame and a caller finds it the moment
`engine.initialize` resolves. There is no moment at which the engine holds a
state with no surface beside it, and every caller that reads `engine.debug`
holds the same object.

The surface's implementation may live wherever the game likes, inline as above
or in its own module that `initialize` builds from, so long as the pair
`initialize` returns carries it. A return that is anything but a two-element
array rejects `initialize` with an error naming the pair.

Reading `engine.debug` before `initialize` resolves throws, naming the ordering
and the pair, exactly as `engine.state` does.

## The case's contract

A case that checks a build through the engine specifies the surface in its
instrumentation spec, and the build writes it: `initialize` builds the surface
over the state and returns the two together. The validators reach the surface
only through `engine.debug`, declaring their own type for it from the spec. The
module paths a case fixes are at
[The Suite](/engines/simple-2d/validators/the-suite/).
