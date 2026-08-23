---
title: Diagnostics
---

The debug overlay shows values the game names. Register one source per value in
`initialize`, as a function that reads the state and returns what to display.
The engine evaluates the sources whenever the overlay draws, so each one keeps
reporting correctly as the state changes.

```ts
import type { Game, InitApi } from "@test-cabinet/simple-2d";

interface State {
  phase: "serve" | "rally" | "over";
  ball: { x: number; y: number; vx: number; vy: number };
  score: { left: number; right: number };
}

const game: Game<State, null> = {
  initialize(api: InitApi): [State, null] {
    const state: State = {
      phase: "serve",
      ball: { x: 320, y: 180, vx: 180, vy: 90 },
      score: { left: 0, right: 0 },
    };

    api.diagnostics.register("phase", () => state.phase);
    api.diagnostics.register(
      "score",
      () => `${state.score.left} - ${state.score.right}`,
    );
    api.diagnostics.register("ball", () => ({
      x: state.ball.x,
      y: state.ball.y,
    }));
    api.diagnostics.register("speed", () =>
      Math.hypot(state.ball.vx, state.ball.vy),
    );

    return [state, null];
  },
  update(state, api, dt) {
    step(state, dt);
  },
  render(state, api) {
    draw(api.ctx, state);
  },
};
```

Registering in `initialize` closes each source over the state the game is about
to run, which is the same value every frame reads and writes. Registration
happens once and the sources need no further attention.

## What makes a good source

A source reads and returns, leaving the state exactly as it found it. It runs on
every frame the overlay is visible, so keep it cheap: read a field, compute one
number, build a small object.

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
api.diagnostics.register(
  "hud",
  () => `${state.lives} lives, wave ${state.wave}`,
);
api.diagnostics.register("paused", () => state.phase === "over");
```

A value that comes from the frame counter is captured in `update` and reported
from the state, since `api.frame()` belongs to the frame the counter describes.

```ts
import type { UpdateApi } from "@test-cabinet/simple-2d";

interface Timing {
  fps: number;
}

function update(state: Timing, api: UpdateApi, dt: number): void {
  state.fps = Math.round(1000 / api.frame().lastDeltaMs);
}
```

## Showing the overlay

The engine owns the backtick key and toggles the overlay with it, so a game
needs no key handling of its own and leaves that key free of gameplay bindings.
The overlay starts hidden, which is the right default for a game a human is
about to play, and a reviewer brings it up whenever a build's behavior needs
explaining.

The panel is drawn after the game's render, in device pixels over the finished
picture, one line per registered source in registration order.

## Replacing a source

Re-registering a name replaces its source and keeps its line where it was, which
is what a value that changes shape between phases uses.

```ts
api.diagnostics.register("target", () => state.target ?? "none");
```

A source that throws shows its message in place of its value and leaves the rest
of the panel intact. A diagnostic therefore guards against the state it reports
being absent, and the game stays free of guards around the diagnostic.
