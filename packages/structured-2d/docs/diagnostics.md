# Diagnostics

The debug overlay draws three things: the engine's own line for the open world,
the named values a game registers, and the engine's frame-time metrics. A game
registers its sources into one of two registries; the engine owns everything
around them.

```ts
type DiagnosticValue = string | number | boolean;

// On the instance, in initialize:
api.diagnostics.register(name: string, source: () => DiagnosticValue): void;

// On the world, from anywhere that holds it:
world.diagnostics.register(name: string, source: () => DiagnosticValue): void;
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
position in its registry. A name registered in both registries keeps a line in
each.

A value that spans levels is registered on the instance, in `initialize`, which
closes each source over the instance, the one framework object that outlives a
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
      return ball === null
        ? "none"
        : `${ball.transform.x.toFixed(0)}, ${ball.transform.y.toFixed(0)}`;
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
format a pair of coordinates.

A source reports one of three types: a `string` where the presentation matters,
a `number` where the magnitude is the point, and a `boolean` for a flag. A
framework object such as an actor is reduced to one of the three inside the
source, so report its position as a formatted string, its tag as a string, or
its count as a number.

A source always returns a value. Where the thing it names is absent, it returns
a short placeholder string in the game's own vocabulary, such as `"none"` or
`"-"`, so the name keeps its line and the reader sees a word the game chose:

```ts
world.diagnostics.register("pawn", () => world.players()[0]?.pawn?.id ?? "none");
```

Prefer values the simulation already holds. A diagnostic that derives something
the game never computed is a second implementation able to disagree with the
first.

The engine already draws the open level, the match phase, and the live actor
count on its own line, so a source that repeats one of the three costs a line
and adds nothing.

## Reading the values back

```ts
interface DiagnosticReading {
  readonly name: string;
  readonly value?: DiagnosticValue;
  readonly error?: string;
}

engine.diagnostics(): readonly DiagnosticReading[];
```

`engine.diagnostics()` evaluates every source in both registries and returns one
reading per source, the instance registry's first and then the world registry's,
each in registration order. That is the order the panel draws them in. Exactly
one of `value` and `error` is present on each reading.

Reading is pure. It evaluates the sources and changes nothing else: the world,
the frame counter, and the overlay's visibility are the same after a read as
before it, so a hidden overlay reads exactly as a visible one does.

A source that throws yields a reading carrying `error` and no `value`. The
message is the `message` of a thrown `Error`, and the `String` form of anything
else thrown. A failure therefore stays distinguishable from a reading of any
type, and `engine.diagnostics()` itself always returns.

Registering the values a case names is the game's part, so a check reads
`engine.diagnostics()` and asserts the names the build registered and what each
one reports for a posed world. Drawing the panel and toggling it belong to the
engine.

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

One line per source, formatted `` `${name}: ${value}` ``.

| Reading | Drawn as |
| --- | --- |
| `string` value | The string itself. |
| Integer `number` value | `String(value)`. |
| Non-integer `number` value | `value.toFixed(3)`. |
| `boolean` value | `"true"` or `"false"`. |
| A source that threw | The `error` message, in the value's place. |

A number that is not finite draws as `NaN`, `Infinity`, or `-Infinity`. Keep
each value to about a line, since a line is the unit the panel draws.

## Frame metrics

The engine times each frame it runs, measuring the wall time spent in the
frame's ticks, its collision pass, its render, and the overlay itself. One
sample is recorded per frame that ran.

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
