---
title: The Game Loop
---

A build writes one [`Game<S, D>`](/engines/simple-3d/apis/game/): `initialize`
returns the state beside the game's debug surface, `update` returns the next
state from the current one and the frame's delta, and `render` shows it. The
engine owns the loop, runs `update` and then `render` once per frame, and hands
each function only the part of itself that function may use.

```ts
import * as THREE from "three";
import type { Game } from "@test-cabinet/simple-3d";

const TURN_RATE = 2.4;       // radians per second
const THRUST = 6;            // world units per second squared
const DRAG_PER_SECOND = 0.6;

interface State {
  readonly rover: {
    readonly x: number;
    readonly z: number;
    readonly heading: number;
    readonly speed: number;
  };
  readonly score: number;
}

function roverIn(scene: THREE.Scene): THREE.Object3D {
  const found = scene.getObjectByName("rover");
  if (found !== undefined) return found;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.5, 1.6),
    new THREE.MeshStandardMaterial({ color: "#f5d76e" }),
  );
  mesh.name = "rover";
  scene.add(mesh);
  return mesh;
}

export const game: Game<State, null> = {
  initialize(api) {
    api.input.register("left", { keys: ["ArrowLeft", "KeyA"] });
    api.input.register("right", { keys: ["ArrowRight", "KeyD"] });
    api.input.register("thrust", { keys: ["ArrowUp", "KeyW"] });
    api.audio.define("boost", { freq: 180, freqTo: 520, durationMs: 120 });

    api.scene.add(new THREE.AmbientLight("#ffffff", 0.4));
    const sun = new THREE.DirectionalLight("#ffffff", 1.2);
    sun.position.set(5, 10, 4);
    api.scene.add(sun);

    return [{ rover: { x: 0, z: 0, heading: 0, speed: 0 }, score: 0 }, null];
  },

  update(state, api, dt) {
    const turn = api.input.value("right") - api.input.value("left");
    const thrusting = api.input.pressed("thrust");
    if (thrusting) api.audio.play("boost");

    const heading = state.rover.heading + turn * TURN_RATE * dt;
    const speed =
      (state.rover.speed + (thrusting ? THRUST * dt : 0)) * Math.pow(DRAG_PER_SECOND, dt);
    return {
      ...state,
      rover: {
        x: state.rover.x + Math.sin(heading) * speed * dt,
        z: state.rover.z + Math.cos(heading) * speed * dt,
        heading,
        speed,
      },
    };
  },

  render(state, api) {
    const rover = roverIn(api.scene);
    rover.position.set(state.rover.x, 0.25, state.rover.z);
    rover.rotation.y = state.rover.heading;

    api.camera.position.set(state.rover.x, 8, state.rover.z + 10);
    api.camera.lookAt(state.rover.x, 0, state.rover.z);

    api.screen.fillStyle = "#ffffff";
    api.screen.font = "16px monospace";
    api.screen.fillText(`SCORE ${state.score}`, 16, 24);
  },
};
```

`update` reads input and plays cues; `render` shows. Both receive the state as
a `DeepReadonly` view, so the only way a frame changes anything is the value
`update` returns: a frame's audible and observable behavior is decided entirely
by `update`, and the picture follows from the state it returned.

The `scene` handed to `render` is retained: what `render` adds on one frame is
still there on the next, so a game builds each object once, finds it again on
later frames, and writes its position from the state. The `camera` is the
engine's, posed by `render` each frame. The `screen` is already cleared and
already carries the logical viewport transform, so HUD drawing is in the design
size the engine was created with, and context state left behind at the end of a
frame is discarded because the transform is replaced at the top of the next
one. The [scene](/engines/simple-3d/usage/the-scene/) page states how a game
keeps many objects in step with the state.

## Booting the engine

The game is bound when the engine is created, and initialization is a separate
step that resolves to the state.

```ts
import { createEngine } from "@test-cabinet/simple-3d";
import { game } from "./game";

const engine = createEngine({ canvas, width: 1280, height: 720, game });

const opening = await engine.initialize();
await engine.run();
```

`engine.state` reads the current value, the one the most recent frame or
[`engine.apply`](/engines/simple-3d/apis/engine/) left. Reading it before
`initialize` resolves throws, and `apply`, `run`, and `advance` throw before it
too, so the ordering is enforced where a mistake happens rather than several
frames later.

## The state is a value

`initialize` returns the state as the first element of its pair. Each frame the
engine hands the current value to `update`, keeps what `update` returns, and
hands that to `render`. Everything a frame needs is therefore reachable from a
value the type system already checked, every field of it is present the moment
a frame can observe it, and a reader holds nothing a later frame writes to.

`update` builds the next state from the current one with spread, `map`, and
small helpers, and returns it. A frame that changes nothing returns the state
it was given. Returning `undefined` is refused with an error naming the rule,
and the engine keeps the state it had.

```ts
update(state, api, dt) {
  if (state.phase !== "running") return state;
  return { ...state, crane: integrate(state.crane, dt) };
}
```

The state carries the simulation alone. A mesh, a material, or a loaded model
is mutated in place, and the engine hands out
`DeepReadonly<S>` views, so the objects a game builds for its picture live on
the render side, keyed by the ids the state carries, and the state holds the
positions, headings, and phases those objects are posed from.

A module-level variable belongs to the module, so every engine built from that
module shares it and its values outlive the run that produced them. Returned
state belongs to the engine, so a second engine over the same game module starts
from its own. That is what lets a validator construct the engine once per test,
in one process, and get an independent scenario each time.

Module scope is for constants: speeds, sizes, tuning numbers, and the cue specs
a build declares once. It is also where the render cache lives, and the
[scene](/engines/simple-3d/usage/the-scene/) page states how that cache stays
per-engine.

## Loading in `initialize`

`initialize` may return a promise, and the engine awaits it before running any
frame. A game that needs assets loads them here. Images and audio buffers are
plain values that go in the state, so `update` and `render` receive a state
whose fields are all loaded; textures and models are three objects, which go in
the render cache or, for a model placed once, straight into `api.scene`.

```ts
import type { Model } from "@test-cabinet/simple-3d";

interface State {
  readonly icons: { readonly hook: ImageBitmap; readonly load: ImageBitmap };
  readonly score: number;
}

const templates = new Map<string, Model>();

async initialize(api) {
  await api.audio.load("music", "audio/theme.ogg");
  const [hook, load, crane] = await Promise.all([
    api.assets.loadImage("icons/hook.png"),
    api.assets.loadImage("icons/load.png"),
    api.assets.loadModel("models/crane.glb"),
  ]);
  templates.set("crane", crane);
  return [{ icons: { hook, load }, score: 0 }, null];
}
```

The state type declares each field as present, and the frame code loads no
placeholder and tests no field for readiness. A load that fails rejects
`engine.initialize` with the cause, so a build that cannot run says so at the
point it was assembled.

Subscribing to `engine.events` before calling `initialize` is what makes each
individual failure visible, since the rejection carries only the first one.

```ts
engine.events.on("asset:failed", (event) => {
  console.error(`${event.path}: ${event.reason}`);
});
```

A diagnostic source registered in `initialize` is handed the state current at
each read, so it reads the field off its argument.

```ts
async initialize(api) {
  api.diagnostics.register("score", (s) => s.score);
  return [{ icons: await loadIcons(api), score: 0 }, null];
}
```

## `dt` is seconds

`dt` is the elapsed time for the frame, in seconds. A 60 Hz display hands the
build roughly `0.0167`, and a wall clock clamps a long absence to its ceiling of
`0.1` seconds.

The step size varies frame to frame, and the clock behind it is chosen when the
engine is built. Every rate a build writes down is therefore per second, and
every use of it is multiplied by `dt`, which is what gives the same behavior at
every frame rate.

| Quantity | Unit | Applied as |
| --- | --- | --- |
| Velocity | World units per second | `position + velocity * dt` |
| Acceleration | World units per second squared | `velocity + accel * dt` |
| Angular velocity | Radians per second | `angle + rate * dt` |
| Decay | A per-second factor | `value * Math.pow(factor, dt)` |

Timers, cooldowns, and animation clocks count in seconds the same way.

```ts
update(state, api, dt) {
  const cooldown = Math.max(0, state.cooldown - dt);
  if (api.input.pressed("fire") && cooldown === 0) {
    return fire({ ...state, cooldown: 0.25 });   // seconds
  }
  return { ...state, cooldown };
}
```

## Pausing

A pause is a flag in the state, read at the top of `update`. The game keeps
rendering while it is paused, so the scene stays on screen and the pause screen
draws over it on the screen layer.

```ts
update(state, api, dt) {
  const paused = api.input.pressed("pause") ? !state.paused : state.paused;
  if (paused) return { ...state, paused };
  return step({ ...state, paused }, api, dt);
},

render(state, api) {
  show(state, api);
  if (state.paused) drawPauseOverlay(api.screen, api.viewport());
}
```

## Ending the game

A game that ends itself creates an `AbortController` in `initialize`, keeps it
in the state, and aborts it from `update`. `run` resolves once the signal
aborts, so the loop halts and the engine stays usable.

```ts
interface State {
  readonly lives: number;
  readonly ended: AbortController;
}

async initialize(api) {
  return [{ lives: 3, ended: new AbortController() }, null];
},

update(state, api, dt) {
  if (state.lives === 0) state.ended.abort();
  return state;
}
```

The controller is a handle the state carries rather than a field it changes, so
aborting it is a call on a value the view hands back as it is. The caller passes
that signal to `run` and waits on it.

```ts
const opening = await engine.initialize();
await engine.run({ signal: opening.ended.signal });
showResults(engine.state);
```

Ending the game is then the game's own state, and the same signal composes with
whatever else the page cancels on teardown. `engine.state` after `run` resolves
is the value the final frame left, which is what the results screen reads.

## A fixed step on top

A build that needs a fixed step of its own, for a deterministic structural
simulation or a lockstep replay, accumulates the delta it is given and keeps the
accumulator in its state.

```ts
const STEP = 1 / 120;      // seconds
const MAX_STEPS = 8;

update(state, api, dt) {
  let next = state;
  let accumulator = state.accumulator + dt;
  let steps = 0;
  while (accumulator >= STEP && steps < MAX_STEPS) {
    next = stepWorld(next, STEP);
    accumulator -= STEP;
    steps += 1;
  }
  return { ...next, accumulator: Math.min(accumulator, STEP) };
}
```

The iteration cap bounds the work a single frame can do, and it is the game's to
set, since a scripted clock may deliver a step of any size. Capping the leftover
accumulator alongside it keeps a long delta from spending the next several
frames catching up.

## Reading the loop back

`api.frame()` reports the frame counter, the accumulated simulated time in
milliseconds, and the milliseconds the most recent frame stepped by. It is
available to both `update` and `render`.

```ts
render(state, api) {
  const { count, timeMs, lastDeltaMs } = api.frame();
  drawHud(api.screen, count, timeMs / 1000, Math.round(1000 / lastDeltaMs));
}
```

Accumulated simulated time is the sum of the deltas the loop delivered, so a
clamped frame contributes only the time it delivered. A build that must track
wall time while the tab is hidden reads `Date.now()` for itself.
