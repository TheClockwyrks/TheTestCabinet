# Diagnostics

The debug overlay draws three things: the engine's own line for the open world,
the named values a game registers, and the engine's frame-time metrics. A game
registers its sources into one of two registries; the engine owns everything
around them.

```ts
// On the instance, in initialize:
api.diagnostics.register(name: string, source: () => unknown): void;

// On the world, from anywhere that holds it:
world.diagnostics.register(name: string, source: () => unknown): void;
```

## The two registries

`source` is a zero-argument function returning the value to display. It is
invoked on each read, never sampled at registration, so it reports whatever the
game holds at that instant.

| Registry | Registered through | Lifetime |
| --- | --- | --- |
| Instance | `InitApi.diagnostics` | The life of the engine. Its sources survive every level transition. |
| World | `world.diagnostics` | The life of the world. Its sources are dropped when the world closes. |

Re-registering a name replaces its source and retains the name's original
position in its registry.

A value that spans levels is registered on the instance, in `initialize`, which
closes each source over the instance — the one framework object that outlives a
transition:

```ts
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

A value read off the world, its game mode, its game state, or an actor belongs
to the world's registry, because all of them are rebuilt when a level opens.
Register those in the game mode's `beginPlay`, which runs once per world after
every declared actor has begun play:

```ts
export class RallyMode extends GameMode {
  override beginPlay(): void {
    this.addPlayer();
    this.setPhase("playing");

    const world = this.world;
    world.diagnostics.register("bricks", () => world.byTag(TAG_BRICK).length);
    world.diagnostics.register("elapsed", () => this.state.elapsed);
    world.diagnostics.register("ball", () => {
      const ball = world.find(Ball);
      return ball ? { x: ball.transform.x, y: ball.transform.y } : "none";
    });
  }
}
```

The world drops these sources when it closes, so the next level registers its
own and the panel always describes the level on screen. An actor registers a
source of its own in `beginPlay` the same way, through `this.world.diagnostics`.

## What makes a good source

A source reads and returns, leaving the world exactly as it found it. It runs on
every frame the overlay is visible, so keep it cheap: read a field, count a tag,
build a small object. Prefer values the simulation already holds — a diagnostic
that derives something the game never computed is a second implementation able
to disagree with the first.

Guard a source against the object it reports being absent, so the game stays
free of guards around the diagnostic:

```ts
world.diagnostics.register("pawn", () => world.players()[0]?.pawn?.id ?? "none");
```

A source that throws contributes its error message as a string value rather than
failing the read, so one careless source costs nothing but its own line.

The engine already draws the open level, the match phase, and the live actor
count on its own line, so a source that repeats one of the three costs a line
and adds nothing.

## The overlay

The overlay is hidden when the engine is created. The backtick key (`Backquote`)
toggles it, handled by a listener the engine owns rather than by a registered
input action, so a game needs no key handling of its own and leaves that key
free of bindings.

It is drawn after the pipeline renders, in device pixels over the finished
picture, so debug text stays the same physical size however far the game's own
coordinates are being scaled. The text is a column of lines, in order:

1. The engine's own world line, reading
   `` `level: ${level}  phase: ${phase}  actors: ${count}` `` from the open
   world's level name, its match phase, and its number of live actors.
2. The instance registry's lines, in the order the game registered them.
3. The world registry's lines, in the order the game registered them.
4. A metrics line reading `` `frame: ${meanMs} / ${p95Ms} / ${p99Ms} ms` ``.

The frame-time graph sits beside the text, to its right.

| Value | Displayed as |
| --- | --- |
| `string` | The string itself. |
| Integer `number` | `String(value)`. |
| Non-integer `number` | `value.toFixed(3)`. |
| `null`, `undefined` | `"null"`, `"undefined"`. |
| `object`, array | `JSON.stringify(value)`, falling back to `String(value)`. |
| Any other type | `String(value)`. |

One line per source, formatted `` `${name}: ${value}` ``. Keep each value to
about a line: a string where the presentation matters, a number where the
magnitude is the point, and a small object for a pair such as a position. A
framework object such as an actor is not plain data, so report its position, its
tag, or its count in its place.

## Frame metrics

The engine times each frame it runs, measuring the wall time spent in the
frame's ticks, its collision pass, its render, and the overlay itself. One
sample is recorded per frame that ran, so a build reports metrics without
registering anything.

```ts
interface FrameMetrics {
  samples: number;
  meanMs: number;
  p95Ms: number;
  p99Ms: number;
}
```

| Field | Meaning |
| --- | --- |
| `samples` | How many frames the window holds. |
| `meanMs` | The arithmetic mean of the window's samples, in milliseconds. |
| `p95Ms` | The 95th percentile of the window's samples, in milliseconds. |
| `p99Ms` | The 99th percentile of the window's samples, in milliseconds. |

Percentiles are nearest-rank over the window's samples sorted ascending. An
empty window reports `0` for all three.

The window is the last 10 seconds of frames, held in a ring buffer whose
capacity is 2048 samples, so a run of any length at any frame rate holds the
same number of bytes. Age is measured against simulated time, so the window
covers 10 seconds of the time the world was stepped by rather than 10 seconds of
real time.

The graph plots the window's samples oldest at the left and newest at the right,
one column per sample. The vertical scale runs from `0` to the largest sample in
the window, with a floor of `33.3` milliseconds so an even run reads as flat
rather than as amplified noise.
