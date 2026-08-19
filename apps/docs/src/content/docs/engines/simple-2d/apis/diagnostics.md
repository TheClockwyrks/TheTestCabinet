---
title: Diagnostics
---

`engine.diagnostics` is the named-value registry behind the debug overlay. Its
class is exported from `@test-cabinet/simple-2d` as a type only.

```ts
class Diagnostics {
  register(name: string, source: () => unknown): void;
  setEnabled(enabled: boolean): void;
  enabled(): boolean;
  toggle(): void;
  read(): Record<string, unknown>;
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
}
```

## Methods

| Method | Returns | Behaviour |
| --- | --- | --- |
| `register(name, source)` | `void` | Binds `name` to `source`. Re-registering a name replaces the source and retains the name's original position in the registry. |
| `setEnabled(enabled)` | `void` | Shows the overlay when `true`, hides it when `false`. |
| `enabled()` | `boolean` | Whether the overlay is currently drawn. |
| `toggle()` | `void` | Inverts the enabled state. |
| `read()` | `Record<string, unknown>` | Evaluates every registered source and returns the values. |
| `draw(ctx, width, height)` | `void` | Draws the overlay onto `ctx`. Called by the engine after the game's `render`. |

The overlay is disabled when the engine is created.

## `register`

`source` is a zero-argument function returning the value to display. It is
invoked on each call to `read`, never sampled at registration.

## `read`

Returns a plain object keyed by registered name, in registration order, whose
values are whatever the sources returned. Values are returned unformatted; the
formatting in the table below applies to the overlay only.

A source that throws contributes its error message as a `string` value: the
`message` of a thrown `Error`, otherwise the `String` form of what was thrown.
`read` itself never throws.

`read` is independent of `enabled()`; a disabled overlay is still read.

## `draw`

`width` and `height` are the dimensions of the surface being drawn on, in device
pixels. The engine resets the context transform to the identity before calling
`draw`, and `draw` saves and restores the context around all of its own work,
including when measuring or drawing throws.

`draw` performs no drawing when the overlay is disabled and no drawing when the
registry is empty.

## Overlay toggle key

The engine installs a `keydown` listener on the canvas's owning document that
calls `toggle()` when `KeyboardEvent.code` is `"Backquote"` and
`KeyboardEvent.repeat` is `false`. The key is not a registered input action and
does not appear in `engine.input.actions()`.

## Display formatting

One line per source, formatted `` `${name}: ${value}` ``.

| Value | Displayed as |
| --- | --- |
| `string` | The string itself. |
| Integer `number` | `String(value)`. |
| Non-integer `number` | `value.toFixed(3)`. |
| `null`, `undefined` | `"null"`, `"undefined"`. |
| `object`, array | `JSON.stringify(value)`, falling back to `String(value)` when it throws or yields `undefined`. |
| Any other type | `String(value)`. |

## Host operations

A driver reaches the registry through `diagnostics()` and `setOverlay(enabled)`
on the host interface, specified in [the host
API](/engines/simple-2d/apis/host/).
