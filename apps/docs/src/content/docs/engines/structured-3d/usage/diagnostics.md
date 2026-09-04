---
title: Diagnostics
---

The debug overlay shows values the game names. Register one source per value, as
a function that reads a framework object and returns what to display. The engine
evaluates the sources whenever the overlay draws, so each one keeps reporting
correctly as the game runs.

Where a source is registered decides how long it lives. A value that spans
levels is registered on the game instance, in `initialize`.

```ts
import { GameInstance, type InitApi } from "@test-cabinet/structured-3d";

export class ArcadeGame extends GameInstance<null> {
  highScore = 0;
  levelsCleared = 0;

  override initialize(api: InitApi): null {
    api.diagnostics.register("high-score", () => this.highScore);
    api.diagnostics.register("levels-cleared", () => this.levelsCleared);
    return null;
  }
}
```

Registering in `initialize` closes each source over the instance, which is the
one framework object that outlives a transition. Registration happens once and
the sources need no further attention for the rest of the run.

## Sources for one match

A value read off the world, its game mode, its game state, or an actor belongs
to the world's registry, because all of them are rebuilt when a level opens.
Register those in the game mode's `beginPlay`, which runs once per world after
every declared actor has begun play.

```ts
import { GameMode } from "@test-cabinet/structured-3d";
import { Ball } from "./actors";
import { TAG_BRICK } from "./constants";

export class RallyMode extends GameMode {
  beginPlay(): void {
    this.addPlayer();
    this.setPhase("playing");

    const world = this.world;
    world.diagnostics.register("bricks", () => world.byTag(TAG_BRICK).length);
    world.diagnostics.register("score", () => this.score());
    world.diagnostics.register("ball", () => {
      const ball = world.find(Ball);
      if (ball === null) return "none";
      const { x, y, z } = ball.transform.position;
      return `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    });
  }

  score(): number {
    return this.state.players[0]?.score ?? 0;
  }
}
```

The world drops these sources when it closes, so the next level registers its
own and the panel always describes the level on screen. An actor registers a
source of its own in `beginPlay` the same way, through `this.world.diagnostics`.

The engine already draws the open level, the match phase, and the live actor
count on its own line above these, so a game's sources report other values.

## What makes a good source

A source reads and returns a string, a number, or a boolean, leaving the world
exactly as it found it. It runs on every frame the overlay is visible, so keep
it cheap: read a field, count a tag, format a position.

```ts
world.diagnostics.register("elapsed", () => this.state.elapsed);
world.diagnostics.register("bricks", () => world.byTag(TAG_BRICK).length);
world.diagnostics.register(
  "hud",
  () => `${this.score()} in ${world.level}`,
);
```

Prefer values the simulation already holds. A diagnostic that derives something
the game never computed is a second implementation able to disagree with the
first, and a figure the game keeps on its game state or its player states is one
field read away.

A source always returns a value, so a source whose subject can be absent returns
a placeholder such as `"none"` or `"-"` in its place. The game therefore stays
free of guards around the diagnostic.

```ts
world.diagnostics.register(
  "pawn",
  () => world.players()[0]?.pawn?.id ?? "none",
);
```

Keep each value to about a line. Return a string where the presentation matters
or where several figures belong together, a number where the magnitude is the
point, and a boolean for a flag. A framework object such as an actor is reduced
to one of the three inside the source, which reports its position as a formatted
string, its tag, or its count. A camera is reported the same way, from
`world.camera.snapshot()`, as a formatted position or its `fov`.

## What a case's checks read

Name a source after the vocabulary a case fixes. A count over a tag the case
declares, the level names it declares, and the figures its specification states
are the values a reviewer reads off the panel without inferring them from
pixels, and they read the same way in every build of the case.

```ts
world.diagnostics.register("bricks", () => world.byTag(TAG_BRICK).length);
world.diagnostics.register("phase-elapsed", () => this.state.elapsed);
```

A check holds the engine and reads `engine.diagnostics()`, which returns one
reading per registered source, the instance registry's first and then the
world's, each in registration order, with the name the game registered and what
that source reports for the world the engine currently holds.

```ts
const readings = engine.diagnostics();

expect(readings.map((r) => r.name)).toEqual([
  "high-score",
  "levels-cleared",
  "bricks",
  "score",
  "ball",
]);
expect(readings[2]).toEqual({ name: "bricks", value: 40 });
```

Registering the values a case names is the game's part; drawing them, toggling
the panel and keeping it read-only are the engine's. A check therefore asserts
what a build registered rather than what the panel drew, beside what it reads
off the world, the scene, and the build's debug surface.

A source that throws shows its message in place of its value on the panel, and
its reading carries an `error` and no `value`, so a check sees a failed source
as a failure rather than as a reading. Reading changes nothing the engine holds,
and a hidden overlay reads exactly as a visible one does.

## Showing the overlay

The engine owns the backtick key and toggles the overlay with it, so a game
needs no key handling of its own and leaves that key free of action bindings.
The overlay starts hidden, which is the right default for a game a human is
about to play, and a reviewer brings it up whenever a build's behavior needs
explaining.

The panel is drawn on the screen layer after the pipeline renders, in device
pixels over the finished picture: the engine's world line, then the instance's
sources in registration order, then the world's, then the frame metrics. The
metrics line carries the frame times beside the draw calls and triangles the
renderer issued for the most recent frame, so a build that is drawing more than
its scene needs shows it there without registering anything.
