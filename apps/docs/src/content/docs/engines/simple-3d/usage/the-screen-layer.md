---
title: The Screen Layer
---

Everything a game draws in two dimensions goes inside `render(state, api)` and
reaches the canvas through `api.screen`: the score, the timer, a menu, a readout
pinned beside something in the world. The context arrives cleared and already
carrying the viewport transform, so drawing is in logical coordinates: `(0, 0)`
is the top-left of the design field and `(width, height)` is its bottom-right,
whatever size the canvas element happens to be. The engine composites the layer
over the 3D picture at the end of the frame, so wherever nothing was drawn the
scene shows through.

```ts
import * as THREE from "three";
import type { Game } from "@clockwyrks/simple-3d";

interface State {
  readonly score: number;
  readonly angle: number;
}

let crate: THREE.Mesh | undefined;

const game: Game<State, null> = {
  initialize(api) {
    crate = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial({ color: "#c8a165" }),
    );
    api.scene.add(crate);
    api.scene.add(new THREE.AmbientLight("#ffffff", 1));
    return [{ score: 0, angle: 0 }, null];
  },
  update(state, api, dt) {
    return { score: state.score + Math.floor(dt * 100), angle: state.angle + dt };
  },
  render(state, api) {
    if (crate) crate.rotation.y = state.angle;

    const { screen } = api;
    const vp = api.viewport();

    screen.fillStyle = "rgba(0, 0, 0, 0.5)";
    screen.fillRect(0, 0, vp.width, 48);

    screen.font = "16px monospace";
    screen.fillStyle = "#ffffff";
    screen.textAlign = "left";
    screen.textBaseline = "middle";
    screen.fillText(`SCORE ${state.score}`, 16, 24);
  },
};
```

`api.viewport()` reports the design size the engine was created with together
with the fit that size currently sits under. The letterbox bars and the device
pixel ratio are folded into the transform, so a build states every coordinate
and size on the layer in design units and leaves the element's own size to the
engine.

## Render only draws

`render` receives the state as a `DeepReadonly` view and returns nothing, so
the picture is a function of the state `update` returned and the compiler
refuses a render that assigns into it. A value the drawing depends on, such as
a highlighted menu entry or a blinking phase, is computed in `update` and
carried in the state.

`RenderApi` carries the scene, the camera, the screen layer's context, the
frame counter, the viewport, and the view. Input and audio are absent from it,
so a frame's response to the player is decided entirely by `update`.

## Every frame draws the whole layer

The engine clears the screen layer at the top of every frame, so `render`
starts from a transparent field and lays down everything the HUD should show.
The layer is the opposite of the scene: the scene is retained and updated in
place, while the layer is drawn afresh
each frame. Every frame is therefore a complete picture of the HUD, which
leaves a build free of dirty-rectangle bookkeeping and makes a single frame
enough to describe what the HUD showed at that instant.

Draw back to front: the panels, then the text over them, then anything that
sits on top of both.

```ts
import type { RenderApi } from "@clockwyrks/simple-3d";
import type { DeepReadonly } from "ts-essentials";

function render(state: DeepReadonly<Yard>, api: RenderApi): void {
  syncScene(api.scene, state);
  poseCamera(api.camera, state.camera);

  const { screen } = api;
  drawPanels(screen, api.viewport());
  drawBudget(screen, state.budget);
  drawTape(screen, state.tape);
  if (state.phase === "results") drawResults(screen, state.results);
}
```

## Context state

The transform is replaced at the top of every frame, so a `translate`, `rotate`,
or `scale` left behind at the end of `render` is discarded rather than
compounding into the next frame. Balance `save` and `restore` around a
transformed subtree anyway, so the rest of that same frame draws where it meant
to.

```ts
function render(state: DeepReadonly<Yard>, api: RenderApi): void {
  const { screen } = api;

  screen.save();
  screen.translate(state.compass.x, state.compass.y);
  screen.rotate(state.camera.yaw);
  screen.fillStyle = "#f5d76e";
  screen.fillRect(-2, -18, 4, 18);
  screen.restore();

  drawHud(screen, state);
}
```

Fill and stroke styles, the font, the alpha, and the line width carry across
draw calls within a frame. Set each one where the drawing that depends on it
happens, so a helper that changes a style leaves its caller drawing in the
color it asked for.

## Text

Font sizes are logical units like every other measurement, so text scales with
the rest of the picture as the window changes size. Set the font, the fill, and
the alignment together, and place the text at a coordinate in the design field.

```ts
function drawBudget(screen: CanvasRenderingContext2D, budget: number): void {
  screen.font = "16px monospace";
  screen.fillStyle = "#ffffff";
  screen.textAlign = "center";
  screen.textBaseline = "middle";
  screen.fillText(`BUDGET ${budget}`, 640, 28);
}
```

Debug text belongs on the overlay instead, which the engine draws on the screen
layer over the finished picture in device pixels and a reviewer toggles on
demand.

## A menu over the scene

The scene keeps rendering behind whatever the layer draws, so a title screen or
a pause menu is a translucent fill over the design field followed by its
entries. The selected entry comes from the state, where `update` moved it in
response to the menu actions.

```ts
function drawMenu(
  screen: CanvasRenderingContext2D,
  vp: Viewport,
  items: readonly string[],
  selected: number,
): void {
  screen.fillStyle = "rgba(0, 0, 0, 0.6)";
  screen.fillRect(0, 0, vp.width, vp.height);

  screen.font = "24px monospace";
  screen.textAlign = "center";
  screen.textBaseline = "middle";
  items.forEach((item, i) => {
    screen.fillStyle = i === selected ? "#f5d76e" : "#ffffff";
    screen.fillText(item, vp.width / 2, vp.height / 2 + i * 40);
  });
}
```

A fully opaque fill hides the scene for the frame it is drawn on. The scene is
still rendered underneath, so a menu that covers the field costs the same frame
as one that lets the world show through.

## Anchoring a readout to a world point

`api.view().project(point)` gives the logical stage point a world point draws
at, in the same coordinates the screen layer draws in, so a label, a health
bar, or a marker follows an object in the world by drawing at the projected
point. `visible` reports whether the point lies inside the camera's frustum,
which is what decides whether to draw the label at all.

```ts
function drawHookLabel(
  screen: CanvasRenderingContext2D,
  api: RenderApi,
  hook: Vec3,
): void {
  const label = api.view().project({ x: hook.x, y: hook.y + 1, z: hook.z });
  if (!label.visible) return;
  screen.font = "12px monospace";
  screen.fillStyle = "#ffffff";
  screen.textAlign = "center";
  screen.textBaseline = "bottom";
  screen.fillText("hook", label.x, label.y);
}
```

`view()` answers from the camera as it stood at the previous frame's render,
because the engine reads the camera after `render` returns. A label drawn from
`render` therefore sits where the previous frame's camera placed the point,
which coincides with this frame's whenever the camera is still. The
[camera page](/engines/simple-3d/usage/the-camera-and-pointer/) covers posing
the camera and projecting through it.

## Reading the pointer

A pointer event reports a position in CSS pixels relative to the browser
viewport. The engine maps it into the game's own logical coordinates before the
game sees it, with the device pixel ratio, the letterbox bars, and the scale
all applied inside the engine, so `update` reads positions on the same axes the
screen layer draws on, through [`UpdateApi.input`](/engines/simple-3d/apis/input/).
A menu hit-test is therefore a comparison between the pointer and the
rectangles the layer drew.

```ts
function update(state: DeepReadonly<Yard>, api: UpdateApi, dt: number): Yard {
  const pointer = api.input.pointer();
  const hovered = state.menu.items.findIndex((_, i) =>
    Math.abs(pointer.y - (360 + i * 40)) < 20,
  );
  const selected = hovered >= 0 ? hovered : state.menu.selected;
  return step({ ...state, menu: { ...state.menu, selected } }, dt);
}
```

A point inside a letterbox bar maps outside `0..width` or `0..height`, so a
game either clamps it or treats it as a miss. A pointer over the world rather
than over the HUD becomes a world-space ray through `api.view().ray(x, y)`,
which is how a scene object under the pointer is picked; the
[camera page](/engines/simple-3d/usage/the-camera-and-pointer/) shows it.

The pointer suits aiming and direct manipulation, where the position itself is
the input. Everything else a case checks belongs behind a registered action,
which a validator drives by name.
