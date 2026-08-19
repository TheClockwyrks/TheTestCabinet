# Diagnostics

The overlay shows values the game names. The engine draws the panel and owns the
toggle key.

```ts
engine.diagnostics.register(name: string, source: () => unknown): void;
engine.diagnostics.setEnabled(enabled: boolean): void;
engine.diagnostics.enabled(): boolean;
engine.diagnostics.toggle(): void;
engine.diagnostics.read(): Record<string, unknown>;
```

## Registering a source

A source is a function returning the value to show. It is called on every read,
not sampled at registration, so it always reports live state:

```ts
engine.diagnostics.register("fps", () => 1000 / engine.frame.info().lastDeltaMs);
engine.diagnostics.register("ball", () => ({ x: ball.x, y: ball.y }));
engine.diagnostics.register("score", () => `${p1Score} - ${p2Score}`);
engine.diagnostics.register("state", () => phase);
```

Register sources during setup. Re-registering a name replaces its source and
keeps its line in place, so the panel does not reshuffle mid-run.

Values are formatted for one line each:

| Value | Shown as |
| --- | --- |
| `string` | Itself. |
| Integer `number` | Itself. |
| Non-integer `number` | Fixed to three decimals. |
| `object` or array | `JSON.stringify`, falling back to the string form. |
| `null` / `undefined` | `"null"` / `"undefined"`. |

Keep each value to about a line's worth of text. A source is called every frame
the overlay is visible, so keep it cheap and free of side effects.

A source that throws is contained: its line shows the error message and the rest
of the panel draws normally.

## The overlay is engine-drawn

The engine draws the panel top-left, after `render`, over the finished picture.
It is drawn in device pixels rather than logical ones, so the text stays the same
physical size however far the game's coordinates are being scaled.

Nothing is drawn while the overlay is off, and nothing is drawn when no sources
are registered.

## The toggle

The engine owns the backtick key (`` ` ``, `KeyboardEvent.code` `"Backquote"`)
and toggles the overlay on every press. It is not a registered action, so it
does not appear in `engine.input.actions()`, and the game must leave that key
alone.

`setEnabled(true)` shows the overlay, `setEnabled(false)` hides it, `toggle()`
flips it, and `enabled()` reports the current state. The overlay starts hidden.

## Read-only

The overlay reports; it does not control. There is no way to edit a value
through it, and it accepts no input beyond its toggle. A source must never
mutate game state — a diagnostic exists to explain behaviour, not to change it.

`read()` evaluates every source and returns the values as a plain object,
regardless of whether the overlay is visible.
