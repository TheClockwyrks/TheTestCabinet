---
title: Reaching the Host
---

A validation script reaches the engine through the host interface the engine
installs on the page. This page covers finding it, calling it, and deciding what
belongs to it rather than to the case's own instrumentation.

## Naming the handle

The handle is the `handle` field of the engine's `engine.toml`. A script names
it once, from the engine catalogue, and every read and call goes through that
constant.

```js
/** The `window` property the engine installs its host interface on. */
export const ENGINE_HANDLE = "__tcabEngine";
```

## Detecting the engine

A validation script detects the engine from the page rather than being told
which one the run selected. `createEngine` installs the handle, so a build with
the handle present is an engine run.

Read `version` in the same evaluation, so a script that needs an operation
introduced at a later version reports that the build predates it rather than
calling a missing function. The read goes through the driver's generic page
evaluation, the same capability every engine-side call needs.

A driver without that capability still settles the question from the shape of
the case handle. Under an engine the build carries none of the five debug
operations the engine took over, and under `none` every one of them is
mandatory, so a handle carrying none of them is an engine run. Inferring beats
assuming `none`: a script that guessed wrong would drive an engine build as
though it had written its own instrumentation.

```js
const ENGINE_PROVIDED_DEBUG_OPS = [
  "step",
  "setAutoStep",
  "keyDown",
  "keyUp",
  "press",
];

async function detectEngineHost(api) {
  if (typeof api.evaluate === "function") {
    const seen = await api.evaluate(
      `(() => {
        const host = window[${JSON.stringify(ENGINE_HANDLE)}];
        if (!host) return { present: false, version: null };
        return {
          present: true,
          version: typeof host.version === "number" ? host.version : null,
        };
      })()`,
    );
    return { present: seen?.present === true, version: seen?.version ?? null };
  }

  // Presence inferred rather than read, so the version stays unknown.
  const { ops } = await api.probe(ENGINE_PROVIDED_DEBUG_OPS);
  const present = ENGINE_PROVIDED_DEBUG_OPS.every(
    (op) => ops?.[op] !== "function",
  );
  return { present, version: null };
}
```

A `version` of `null` therefore means presence was inferred without being read,
which a script needing a particular version distinguishes from version `1`.

Detection runs on every call into an engine-backed helper, so cache the answer.
Key the cache on the `api` object: each pass builds its own, so a cache keyed on
it cannot leak the validate pass's answer into the record pass's page.

## Calling an operation

The rest of the driver `api` is bound to the case handle. `api.call` and
`api.probe` reach the build's own debug API, which is a different handle from
the engine's. Every engine-side read and call therefore goes through the
driver's generic page evaluation.

Generic page evaluation is a driver capability rather than one every driver has.
`@test-cabinet/browser-driver` uses it internally and exposes no `api.evaluate`
on the script API it hands a validation script, so `hostCall` checks for the
capability and throws naming what is missing.

A void operation returns `undefined`, which does not survive the trip back out
of the page. Normalize it to `null`, so `setSchedule` and `setAction` resolve
instead of reading as a failed evaluation.

```js
export async function hostCall(api, method, ...args) {
  if (typeof api.evaluate !== "function") {
    throw new Error(
      `the ${ENGINE_HANDLE} engine host is installed, but this driver exposes no ` +
        `generic page evaluation (api.evaluate), so ${method}() cannot be reached — ` +
        `see packages/browser-driver/driver.mjs`,
    );
  }
  const call = `window[${JSON.stringify(ENGINE_HANDLE)}].${method}(${args
    .map((arg) => JSON.stringify(arg))
    .join(", ")})`;
  return api.evaluate(
    `(() => { const result = ${call}; return result === undefined ? null : result; })()`,
  );
}
```

Arguments are serialized as JSON, and the host validates each one on arrival. A
rejected argument throws inside the page and surfaces as a failed evaluation
naming the offending value.

## Which handle owns what

Under an engine the frame clock, keyboard injection, the debug overlay, and the
audio bus belong to the engine host. The case handle carries only what is about
that game: resetting it, reading a snapshot back, and the control operations
that pose a scenario in the game's own world.

| Surface | Reached through |
| --- | --- |
| Stepping frames, the schedule, the frame counter | `setClock`, `setSchedule`, `advance`, `frame` on the engine host |
| Held keys, taps, the registered bindings and layout | `setAction`, `pressAction`, `actions`, `layout` on the engine host |
| The cue log, mute and unlock state, the asset log | `audioLog`, `audioState`, `assetLog` on the engine host |
| The overlay and the values behind it | `diagnostics`, `setOverlay` on the engine host |
| Reset, snapshot, and scenario setup | The case's own handle |

Absorb each of those differences behind one helper, so a calling item is written
once and reads the same whichever engine the run selected. The
[clock](/engines/simple-2d/validators/clock/),
[input](/engines/simple-2d/validators/input/), and
[observation](/engines/simple-2d/validators/observations/) pages cover the
helpers for each surface.
