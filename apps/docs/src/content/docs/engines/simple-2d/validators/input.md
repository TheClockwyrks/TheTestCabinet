---
title: Driving Input
---

Input is driven through the host interface by action name, so a driver
synthesizes no keyboard events. The examples below call the host through the
`hostCall` helper defined in
[Reaching the Host](/engines/simple-2d/validators/the-host/).

Under an engine the frame clock belongs to the engine host, so the frames these
examples run go through the host's `advance` rather than through the case
handle's own stepping operation, which an engine build does not carry.

## Reading the bindings

`actions()` is a static read. Confirming that a build registered and bound every
action its case asked for takes no simulated keystrokes and no gameplay, and the
resolved kind and the layout provenance come back with it.

```js
const actions = await hostCall(api, "actions");
const byName = new Map(actions.map((action) => [action.name, action]));

for (const [name, keys] of Object.entries(EXPECTED_KEYS)) {
  const action = byName.get(name);
  check.expectEq(`${name} is digital`, action?.kind, "digital");
  check.expectEq(
    `${name} is bound to ${keys}`,
    action?.keys?.join(","),
    keys.join(","),
  );
}
```

Each entry's `layout` names the touch layout the action came from, or is `null`
for an action the build registered beyond that layout's vocabulary. The entries
arrive in registration order.

`layout()` reports the selected layout as `{ name, actions }`, or `null` when
the build selected none, which is how a driver confirms the vocabulary the run
was configured for is the one the build is speaking.

```js
const layout = await hostCall(api, "layout");
check.expectEq("dual-vertical is selected", layout?.name, "dual-vertical");
```

## Holding an action

`setAction(name, value)` drives an action's magnitude exactly as a held key or a
touch slider does. The value persists across frames, so a hold is a set, some
frames, and a set back to `0`.

```js
await hostCall(api, "setAction", "p1-up", 1);
await hostCall(api, "advance", 36);
await hostCall(api, "setAction", "p1-up", 0);
```

A digital action quantizes any non-zero magnitude to full deflection, so a
partial value is worth sending only at an action the build registered as analog.
Crossing from `0` to non-zero also arms the action's edge, so a build reading
either the held value or the press sees what a player would have caused.

`setAction` rejects a value that is not a finite number, so a bad magnitude
fails at the call rather than several frames later.

## Tapping an action

`pressAction(name)` arms an action's edge and leaves its magnitude alone. A
driver has no release to send afterwards, so arming the edge is the whole tap: a
press that also raised the value would leave the action held for the rest of the
run.

An edge is news for one frame, and the engine discards it at the end of the
frame it was armed in. Follow a tap with a single frame, which is what delivers
it.

```js
await hostCall(api, "pressAction", "confirm");
await hostCall(api, "advance", 1);
```

Driving an action the build never registered changes nothing, which is what
makes a missing action visible through `actions()` rather than through a run
that silently does nothing.
