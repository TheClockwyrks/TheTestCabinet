---
title: Diagnostics
---

The debug overlay shows values the game names. Register one source per value in
`initialize`, as a function that takes the state and returns what to display.
The engine evaluates the sources whenever the overlay draws, handing each one
the state current at that read, so each one keeps reporting correctly as the
state advances.

```ts
import type { Game, InitApi } from "@clockwyrks/simple-3d";

interface State {
  readonly phase: "build" | "run" | "over";
  readonly hook: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly vx: number;
    readonly vy: number;
    readonly vz: number;
  };
  readonly placed: number;
  readonly budget: number;
}

const game: Game<State, null> = {
  initialize(api: InitApi<State>): [State, null] {
    api.diagnostics.register("phase", (s) => s.phase);
    api.diagnostics.register("placed", (s) => s.placed);
    api.diagnostics.register(
      "hook",
      (s) =>
        `${s.hook.x.toFixed(1)}, ${s.hook.y.toFixed(1)}, ${s.hook.z.toFixed(1)}`,
    );
    api.diagnostics.register("speed", (s) =>
      Math.hypot(s.hook.vx, s.hook.vy, s.hook.vz),
    );
    api.diagnostics.register("running", (s) => s.phase === "run");

    return [
      {
        phase: "build",
        hook: { x: 0, y: 12, z: 0, vx: 0, vy: 0, vz: 0 },
        placed: 0,
        budget: 5000,
      },
      null,
    ];
  },
  update(state, api, dt) {
    return step(state, dt);
  },
  render(state, api) {
    draw(api.scene, api.camera, api.screen, state);
  },
};
```

`InitApi<State>` types the argument each source receives, and `createEngine`
infers it from the game. A source reads off that argument rather than off the
object `initialize` built, because the state a frame leaves behind is a new
value: a source that held the first object would report the opening state
forever. Registration happens once and the sources need no further attention.

## What makes a good source

A source reads and returns a string, a number, or a boolean. It is handed a
read-only view and runs on every frame the overlay is visible, so keep it cheap:
read a field, compute one number, format a triple of coordinates.

Name the values a reviewer would otherwise infer from pixels. The score, the
current phase, the number of live entities, and the position of the object under
test each turn a squint at the screen into a direct reading, and in three
dimensions a position is the reading a picture is least able to give. Values
the simulation already holds make the best sources, since a diagnostic that
derives something the game never computed is a second implementation able to
disagree with the first.

Keep each value to about a line. Return a string where the presentation matters
or where several figures belong together, a number where the magnitude is the
point, and a boolean for a flag. A value the state holds in another shape is
reduced to one of the three inside the source, so a position is formatted and a
collection is counted.

```ts
api.diagnostics.register(
  "hud",
  (s) => `${s.placed} placed, budget ${s.budget}`,
);
api.diagnostics.register("over", (s) => s.phase === "over");
```

A value that comes from the frame counter is captured in `update` and reported
from the state, since `api.frame()` belongs to the frame the counter describes.

```ts
import type { UpdateApi } from "@clockwyrks/simple-3d";
import type { DeepReadonly } from "ts-essentials";

interface Timing {
  readonly fps: number;
}

function update(
  state: DeepReadonly<Timing>,
  api: UpdateApi,
  dt: number,
): Timing {
  return { ...state, fps: Math.round(1000 / api.frame().lastDeltaMs) };
}
```

## Showing the overlay

The engine owns the backtick key and toggles the overlay with it, so a game
needs no key handling of its own and leaves that key free of gameplay bindings.
The overlay starts hidden, and a reviewer brings it up whenever a build's
behavior needs explaining.

The panel is drawn after the game's render, on the screen layer in device
pixels over the finished picture, one line per registered source in
registration order. Below the registered lines the engine draws its own metrics
line, the frame time's mean and percentiles beside the most recent frame's draw
calls and triangles, and the frame-time graph. The state each source reads is
the one that frame's `update` returned, which is the state the picture under
the panel was drawn from.

## Replacing a source

Re-registering a name replaces its source and keeps its line where it was, which
is what a value that changes shape between phases uses.

```ts
api.diagnostics.register("target", (s) => s.target ?? "none");
```

A source always returns a value, so a source whose subject can be absent returns
a placeholder such as `"-"` or `"none"` in its place. The game therefore stays
free of guards around the diagnostic.

## What a case's checks read

A check holds the engine and reads `engine.diagnostics()`, which returns one
reading per registered source, in registration order, with the name the game
registered and what that source reports for the state the engine currently
holds.

```ts
const readings = engine.diagnostics();

expect(readings.map((r) => r.name)).toEqual([
  "phase",
  "placed",
  "hook",
  "speed",
  "running",
]);
expect(readings[0]).toEqual({ name: "phase", value: "build" });
```

Registering the values a case names is the game's part; drawing them, toggling
the panel and keeping it read-only are the engine's. A check therefore asserts
what a build registered rather than what the panel drew.

A source that throws shows its message in place of its value on the panel, and
its reading carries an `error` and no `value`, so a check sees a failed source
as a failure rather than as a reading. Reading changes nothing the engine holds,
and a hidden overlay reads exactly as a visible one does.
