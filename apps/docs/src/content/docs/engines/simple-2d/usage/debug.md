---
title: Debug Surface
---

A build hands the engine one object a caller drives it through. The game builds
that surface in `initialize` over the state it just built, hands it to
`api.debug.expose`, and the engine returns the same value from `engine.debug`.
A caller poses a scenario through it, steps the simulation, and reads the
outcome back, with no keyboard and no waiting on real time.

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
  initialize(api) {
    const state: State = {
      phase: "serve",
      ball: { x: 320, y: 180, vx: 0, vy: 0 },
      score: { left: 0, right: 0 },
    };

    api.debug.expose({
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
    });

    return state;
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
`unknown`, so a game that exposes nothing writes `Game<State>` and leaves
`expose` alone.

The engine holds the value and reads no member of it. The methods, their
signatures, and the vocabulary they use are the game's own design.

## What belongs on it

Expose the operations a scenario is written in rather than the fields of the
state: placing a piece, serving the ball, spawning a wave, ending a round,
reading the score. Each one runs through the same systems play runs through, so
a scenario posed from code and the same scenario reached by playing leave the
game in one state.

A diagnostic source names a value for a human reading the overlay; the surface
names the operations a caller drives from code, and the readings it needs to
decide what happened. Return a copy where a reading would otherwise hand back a
reference into the live state.

```ts
api.debug.expose({
  spawn: (kind, x) => addEnemy(state, kind, x),
  live: () => state.enemies.length,
  hud: () => ({ lives: state.lives, wave: state.wave }),
});
```

## Exposing it

`initialize` is the one place `expose` can be called, so the surface is in place
before the first frame and a caller finds it the moment `engine.initialize`
resolves. Build the state, expose over it, and return it.

A build that keeps `api` and exposes after initialization finishes gets an error
naming the ordering, and a second `expose` gets one naming the duplicate. One
surface per game is what keeps every caller that read `engine.debug` holding the
same object.

Reading `engine.debug` before a surface exists throws the same way, so a build
that skips the call leaves the handle unreadable rather than returning a value
every caller has to test.

## The case's module

A case that checks a build through the engine supplies the `Debug` type and the
factory that builds it over a `State`, and the build writes the line that joins
them: `initialize` builds the surface from that module and hands it to
`api.debug.expose`. The module paths a case fixes are at
[The Suite](/engines/simple-2d/validators/the-suite/).
