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
      return ball ? { ...ball.transform.position } : "none";
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
count on its own line above these, so a source that repeats one of the three
costs a line and adds nothing.

## What makes a good source

A source reads and returns, leaving the world exactly as it found it. It runs on
every frame the overlay is visible, so keep it cheap: read a field, count a tag,
build a small object.

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

Guard a source against the object it reports being absent, so the game stays
free of guards around the diagnostic. A source that throws shows its message in
place of its value and leaves the rest of the panel intact.

```ts
world.diagnostics.register(
  "pawn",
  () => world.players()[0]?.pawn?.id ?? "none",
);
```

Keep each value to about a line. Return a string where the presentation matters,
a number where the magnitude is the point, and a small object for a triple such
as a position.

## What a case's checks read

A case's checks read the world and the build's
[debug surface](/engines/structured-3d/usage/debug/), and the overlay is for a
person watching the build play. A source still returns plain data, a string, a
number, a boolean, or a small object of those, because the panel formats each
value as one line. A framework object such as an actor is not plain data, so
report its position, its tag, or its count in its place.

Name a source after the vocabulary a case fixes. A count over a tag the case
declares, the level names it declares, and the figures its specification states
are the values a reviewer reads off the panel without inferring them from
pixels, and they read the same way in every build of the case.

```ts
world.diagnostics.register("bricks", () => world.byTag(TAG_BRICK).length);
world.diagnostics.register("phase-elapsed", () => this.state.elapsed);
```

## Showing the overlay

The engine owns the backtick key and toggles the overlay with it, so a game
needs no key handling of its own and leaves that key free of action bindings.
The overlay starts hidden, which is the right default for a game a human is
about to play, and a reviewer brings it up whenever a build's behavior needs
explaining.

The panel is drawn after the pipeline renders, in device pixels on the engine's
own overlay surface above the rendering canvas: the engine's world line, then
the instance's sources in registration order, then the world's, then the frame
metrics. The overlay never enters a recording.
