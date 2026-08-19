---
title: Reading a Build
---

The engine records what a build asked it to do, so a driver can establish what
the build did without any cooperation from the build's own code. The audio log,
the asset log, and the diagnostics read all come off the host interface through
the [`hostCall`](/engines/simple-2d/validators/the-host/) helper, and so do the
frames these examples run: under an engine the frame clock belongs to the engine
host rather than to the case handle's own stepping operation.

## Audio

`audioLog` returns every cue the build has played, oldest first, each entry
naming the cue, the frame-loop time it played at, and the gain it played at. The
read is a copy, so take one before the event under test and one after; what the
second has that the first does not is what the event played.

```js
export async function audioCues(api) {
  return hostCall(api, "audioLog");
}

const before = await audioCues(api);
await actBounceOffPaddle(api);
const after = await audioCues(api);

const played = after.slice(before.length);
check.expectGt("a paddle hit plays a sound", played.length, 0);
check.expectOk(
  "the paddle hit plays the paddle cue",
  played.some((entry) => entry.cue === "paddle-hit"),
);
```

Because the entries name the cue, a build that fires its scoring blip on every
wall bounce is caught rather than passing on a count.

The log records every play regardless of the unlock state, so a cue check needs
no gesture. Unlocking affects audibility only, which a headless driver cannot
observe.

`audioState` returns the bus's two observable bits, and they separate the two
reasons a build can be silent.

| Reading | Means |
| --- | --- |
| `unlocked: false` | No gesture has reached the page yet, so nothing was ever audible. |
| `muted: true` | The build or the player muted the bus. Cues still appear in the log, at gain `0`. |

A mute is therefore visible in the log rather than absent from it, so a muted
build and an unresponsive one are distinguishable.

## Assets

`assetLog` returns every asset the build has requested, oldest first, with the
path it asked for, the URL that path resolved to, and whether the load
succeeded.

```js
const requested = await hostCall(api, "assetLog");

check.expectOk(
  "the sprite sheet is requested",
  requested.some((entry) => entry.path === "sprites/paddles.png"),
);
check.expectOk(
  "every requested asset arrived",
  requested.every((entry) => entry.ok),
);
```

An entry with `ok: false` and an empty `url` is a path the engine refused rather
than a file that was missing.

## Diagnostics

`diagnostics` evaluates the build's registered sources at the moment of the call
and returns them as a name-to-value record. The read is independent of whether
the overlay is visible, so a script inspecting the build's own reported state
never has to switch on a piece of human-facing chrome.

```js
const values = await hostCall(api, "diagnostics");

check.expectOk("the build reports its screen", typeof values.screen === "string");
check.expectEq("the build reports the score it is showing", values.score, 3);
```

A source may return anything, so values are reduced to a plain form on the way
out. A value that is already plain arrives unchanged, one that cannot be encoded
arrives as its string form, and one with no representation at all arrives as
`null`. A single unrepresentable source therefore degrades its own line rather
than failing the whole read, and a source that threw arrives as its error
message.

## The overlay

`setOverlay` shows or hides the debug overlay directly, so a script puts it into
a known state without sending the toggle key and without depending on which
state the build left it in.

```js
await hostCall(api, "setOverlay", true);
await hostCall(api, "advance", 1); // the overlay is drawn at the end of a frame
```

Hide it again before an item whose recorded clip should show the game alone.
