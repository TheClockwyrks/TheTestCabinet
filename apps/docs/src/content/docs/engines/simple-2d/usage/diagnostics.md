---
title: Diagnostics
---

The debug overlay shows values the game names. Register one source per value in
`initialize`, as a function that takes the state and returns what to display.
The engine evaluates the sources whenever the overlay draws, handing each one
the state current at that read, so each one keeps reporting correctly as the
state advances.

```ts
import type { Game, InitApi } from "@test-cabinet/simple-2d";

interface State {
  readonly phase: "serve" | "rally" | "over";
  readonly ball: {
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
  };
  readonly score: { readonly left: number; readonly right: number };
}

const game: Game<State, null> = {
  initialize(api: InitApi<State>): [State, null] {
    api.diagnostics.register("phase", (s) => s.phase);
    api.diagnostics.register("score", (s) => `${s.score.left} - ${s.score.right}`);
    api.diagnostics.register("ball", (s) => ({ x: s.ball.x, y: s.ball.y }));
    api.diagnostics.register("speed", (s) => Math.hypot(s.ball.vx, s.ball.vy));

    return [
      {
        phase: "serve",
        ball: { x: 320, y: 180, vx: 180, vy: 90 },
        score: { left: 0, right: 0 },
      },
      null,
    ];
  },
  update(state, api, dt) {
    return step(state, dt);
  },
  render(state, api) {
    draw(api.ctx, state);
  },
};
```

`InitApi<State>` types the argument each source receives, and `createEngine`
infers it from the game. A source reads off that argument rather than off the
object `initialize` built, because the state a frame leaves behind is a new
value: a source that held the first object would report the opening state
forever. Registration happens once and the sources need no further attention.

## What makes a good source

A source reads and returns. It is handed a read-only view, runs on every frame
the overlay is visible, so keep it cheap: read a field, compute one number,
build a small object.

Name the values a reviewer would otherwise infer from pixels. The score, the
current phase, the number of live entities, and the position of the object under
test each turn a squint at the screen into a direct reading. Values the
simulation already holds make the best sources, since a diagnostic that derives
something the game never computed is a second implementation able to disagree
with the first.

Keep each value to about a line. Return a string where the presentation matters,
a number where the magnitude is the point, and a small object for a pair such as
a position.

```ts
api.diagnostics.register("hud", (s) => `${s.lives} lives, wave ${s.wave}`);
api.diagnostics.register("paused", (s) => s.phase === "over");
```

A value that comes from the frame counter is captured in `update` and reported
from the state, since `api.frame()` belongs to the frame the counter describes.

```ts
import type { UpdateApi } from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

interface Timing {
  readonly fps: number;
}

function update(state: DeepReadonly<Timing>, api: UpdateApi, dt: number): Timing {
  return { ...state, fps: Math.round(1000 / api.frame().lastDeltaMs) };
}
```

## Showing the overlay

The engine owns the backtick key and toggles the overlay with it, so a game
needs no key handling of its own and leaves that key free of gameplay bindings.
The overlay starts hidden, which is the right default for a game a human is
about to play, and a reviewer brings it up whenever a build's behavior needs
explaining.

The panel is drawn after the game's render, in device pixels over the finished
picture, one line per registered source in registration order. The state each
source reads is the one that frame's `update` returned, which is the state the
picture under the panel was drawn from.

## Replacing a source

Re-registering a name replaces its source and keeps its line where it was, which
is what a value that changes shape between phases uses.

```ts
api.diagnostics.register("target", (s) => s.target ?? "none");
```

A source that throws shows its message in place of its value and leaves the rest
of the panel intact. A diagnostic therefore guards against the state it reports
being absent, and the game stays free of guards around the diagnostic.
