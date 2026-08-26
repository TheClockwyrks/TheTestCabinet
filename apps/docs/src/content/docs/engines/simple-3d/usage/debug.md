---
title: Debug Surface
---

A build hands the engine one object a caller drives it through. The game builds
that surface in `initialize` and returns it beside the state as the pair
`[state, debug]`, and the engine returns the surface unchanged from
`engine.debug`. A caller poses a scenario through it, steps the simulation, and
reads the outcome back, with no keyboard and no waiting on real time.

The surface holds no state of its own. Its operations are written in the shape
of `update`: a pose takes the current state and returns the next, and a reading
takes the current state and returns what it read. A caller drives a pose through
`engine.apply` and a reading through `engine.state`.

```ts
import type { Game, Vec3 } from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

interface State {
  readonly phase: "serve" | "rally" | "over";
  readonly ball: {
    readonly position: Vec3;
    readonly velocity: Vec3;
  };
  readonly score: { readonly left: number; readonly right: number };
}

interface Debug {
  place(state: DeepReadonly<State>, position: Vec3): State;
  serve(state: DeepReadonly<State>, velocity: Vec3): State;
  phase(state: DeepReadonly<State>): State["phase"];
  score(state: DeepReadonly<State>): { left: number; right: number };
}

const game: Game<State, Debug> = {
  initialize() {
    const state: State = {
      phase: "serve",
      ball: {
        position: { x: 0, y: 1, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      },
      score: { left: 0, right: 0 },
    };

    const debug: Debug = {
      place: (s, position) => ({ ...s, ball: { ...s.ball, position } }),
      serve: (s, velocity) => ({
        ...s,
        phase: "rally",
        ball: { ...s.ball, velocity },
      }),
      phase: (s) => s.phase,
      score: (s) => ({ ...s.score }),
    };

    return [state, debug];
  },
  update(state, api, dt) {
    return step(state, dt);
  },
  render(state, api) {
    draw(api.scene, state);
  },
};
```

A pose is a `Transition<State>` with arguments in front of it, and the engine
keeps the value it returns as the state the next frame's `update` receives. A
reading is handed the value current at the call, so it reports what the game
holds at that instant.

```ts
await engine.initialize();

engine.apply((s) => engine.debug.place(s, { x: 8, y: 1, z: 0 }));
engine.apply((s) => engine.debug.serve(s, { x: -6, y: 0, z: 2 }));
await engine.advance(60);

const score = engine.debug.score(engine.state);
```

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
reading the score. Each pose is a transition the game's own systems could have
produced, so a scenario posed from code and the same scenario reached by playing
leave the game in one state.

Poses take and return plain values, so a position or a velocity crosses the
surface as a `Vec3` and an orientation as a `Quat`, the same shapes the state
itself holds. A diagnostic source names a value for a human reading the
overlay; the surface names the operations a caller drives from code, and the
readings it needs to decide what happened. A reading returns a new value,
because the state it is handed is read-only and a plain object is what a caller
compares and serializes.

```ts
const debug: Debug = {
  spawn: (s, kind, position) => ({
    ...s,
    enemies: [...s.enemies, makeEnemy(kind, position)],
  }),
  live: (s) => s.enemies.length,
  hud: (s) => ({ lives: s.lives, wave: s.wave }),
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
or in its own module of pure functions that `initialize` gathers, so long as the
pair `initialize` returns carries it. A return that is anything but a
two-element array rejects `initialize` with an error naming the pair.

Reading `engine.debug` before `initialize` resolves throws, naming the ordering
and the pair, exactly as `engine.state` and `engine.apply` do.

## The case's contract

A case that checks a build through the engine specifies the surface in its
instrumentation spec, and the build writes it: `initialize` builds the surface
and returns the two together. The validators reach the surface only through
`engine.debug`, declaring their own type for it from the spec, and drive it
through `engine.apply` and `engine.state`. The module paths a case fixes are at
[The Suite](/engines/simple-3d/validators/the-suite/).
