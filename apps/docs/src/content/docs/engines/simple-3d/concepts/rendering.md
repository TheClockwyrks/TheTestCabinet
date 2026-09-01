---
title: Rendering
---

The engine owns the renderer, the scene object, the camera, and the screen
layer. A game states what should be on screen by populating the scene, posing
the camera, and drawing its readouts on the screen layer from `render`, and the
engine renders the scene through the camera and composites the screen layer
over it once per frame. A build writes simulation and a picture, and leaves the
renderer, the fit, and the compositing to engine code.

## The picture is a retained scene

The scene is one `THREE.Scene` the engine creates empty at construction, with
no lights and no background, and keeps for its life. It is retained: what
`render` adds on one frame is still there on the next. A game builds its
objects once and updates them from the state each frame, adding an object when
the state gains a thing and removing it when the state loses one, and the
lights and the static geometry it placed during initialization stay where they
were put.

Reading the scene therefore answers what is drawn. The objects in the scene,
their world positions, their visibility, their geometry, and their materials
are the picture, and `engine.scene` hands out the live object from
construction onward. A case checks that a crate is on screen by finding the
crate's mesh in the scene, in the same object model the renderer draws from,
with no pixels involved.

Because the scene is retained, changing the picture is mutating an object. A
game hides a mesh by clearing its `visible`, moves it by writing its
`position`, and recolors it by writing its material, and every one of those is
readable back afterwards. The objects a game placed are its own, so it disposes
the geometries and materials it stops using.

## Three objects stay out of the state

The state carries the simulation alone. The engine hands every reader a
`DeepReadonly<S>` view of it, and a three object is mutated in place, so a
three object held in the state would be a value the type system says is frozen
and the renderer says is live. Keeping the two apart is what lets a validator
step the simulation with no scene involved in the result, and what lets the
scene be read as the picture without reading the simulation.

A game therefore keeps the objects it created in a render-side cache: a
module-level `Map` keyed by the ids the state carries, or the scene itself
under `object.name`, found with `scene.getObjectByName`. The state names
things, and the cache holds the object each name draws as. A model loaded
through the asset loader arrives as a template, and a game places it by
cloning the template with `cloneModel` and adding the clone to the scene, so
one template yields as many placed copies as the state calls for.

## Two surfaces, one canvas

Every frame the engine draws two things onto the canvas handed to
`createEngine`. The scene is the 3D picture, rendered through a
`WebGLRenderer` over the canvas. The screen layer is a 2D canvas the engine
owns, sized to the same backing store, whose 2D context the game draws on in
logical coordinates.

The screen layer exists because a 3D game has the same readouts a 2D game has.
A score, a menu, a timer, and a prompt are text and rectangles placed in the
design field, and a 2D context draws them in one call each where a scene would
need geometry, a texture, and a camera-facing quad. Every rule the 2D engines
state for their context applies to the screen layer verbatim: it is cleared at
the top of every frame, its transform is replaced with the viewport's each
frame, it draws in logical coordinates, and the letterbox bars are folded in.

The two surfaces divide the picture by kind rather than by depth. The scene
holds everything with a position in the world, and the screen layer holds
everything with a position on the stage. A label anchored to a world point
crosses from one to the other through the
[view](/engines/simple-3d/concepts/camera-and-view/), which projects the point
onto the logical field the screen layer draws in.

## Compositing

At the end of every frame the screen layer is uploaded as a texture and drawn
over the 3D picture as a full-canvas quad with alpha blending. Wherever the
screen layer is transparent the scene shows through, and wherever the game
drew, the drawing sits on top, so a HUD covers the world exactly as it would on
a 2D canvas laid over it.

The order fixes what is on top of what. The scene is rendered first, the
diagnostics overlay is drawn on the screen layer after the game's own drawing,
and the composite comes last, so every screen draw is over every scene draw
and the overlay is over both. The two canvases share one backing store size and
one fit, so the composite is a pixel-for-pixel lift with nothing resampled.

## The camera is engine-owned and game-posed

The engine creates one camera at construction, a perspective or an
orthographic one as the `projection` option selects, and renders the scene
through it for its life. `render` poses it by writing its position, its
orientation, and its projection fields, and the engine holds a perspective
camera's aspect at the design aspect and updates its projection matrix before
rendering, so a write from `render` is that frame's picture.

Holding the camera in the engine is what lets the engine answer questions
about it. The [view](/engines/simple-3d/concepts/camera-and-view/) reads the
camera after each render, the listener for positional audio stands where the
camera stands, and the recorder writes the camera each frame rendered through,
none of which the engine could do for a camera the game held privately.

## The whole picture, every frame

Each frame the engine clears the whole canvas to the background color, or to
transparency when the game gave none, applies the letterboxed
[viewport](/engines/simple-3d/concepts/viewport/) and scissor, and renders the
scene through the camera. The clear precedes the scissor, so the letterbox bars
carry the background color, and the scene's own background paints inside the
viewport alone. Nothing of the previous frame's pixels is carried over, so a
mesh whose `visible` is cleared leaves the picture at once and an object
removed from the scene leaves it the same frame.

The screen layer is cleared the same way at the top of every frame, so it holds
only what this frame's render drew on it. The scene's persistence is in its
objects rather than in its pixels: what persists from frame to frame is what
the game left in the scene, and each frame's picture is drawn whole from that.

## Shadows

Shadows are one option. `shadows` enables the renderer's shadow maps with PCF
soft filtering, and which lights cast and which objects cast and receive is the
game's, through `castShadow` on a light and a mesh and `receiveShadow` on a
mesh, as three reads them. A build states once whether it wants shadows at all,
and its scene objects state the rest.

## The headless backend

Under the `headless` backend no renderer exists, and everything else about the
frame is unchanged. The scene is maintained, world matrices are updated every
frame, the camera is posed and read into the view, the screen layer draws
through its 2D context, and the recorder captures every frame. No pixels of the
3D picture are produced, and the frame metrics report zero draw calls and zero
triangles.

This is the backend a validator selects. A validator runs the build in process
over a canvas with no `webgl2` context behind it, hands the engine a
`@napi-rs/canvas` canvas as the screen layer, and steps the game with a
scripted clock. It then reads the scene for what the build placed, the view for
where a world point lands on the stage, the screen layer's pixels or recorded
operations for the HUD, and the recording for what was submitted to be drawn,
which together cover what a case asserts about a picture. The rendered pixels
of the world pass are the one thing the backend withholds, and a claim about
them is a browser check outside the in-process suite.

Keeping capture independent of the renderer is what makes the two backends
agree. The recorder reads the scene object rather than the renderer's output,
so the recording a validator emits under `headless` matches the one the same
frames produce under `webgl`, frame for frame.

## The render and the update

Drawing belongs to `render`, and reading input and playing cues belong to
`update`. Each api carries only its own half, so a frame's audible and
observable behavior comes from `update` and its picture from `render`.

The separation gives a build one place to look for each. A validator that
steps the simulation and then reads the scene knows the scene came from the
state `update` left behind, and a case that asserts on a cue knows the cue came
from `update`. The [view](/engines/simple-3d/concepts/camera-and-view/) is the
one thing both share, read-only in each, so `update` picks against the camera
the player is looking through without holding the camera itself.

## Disposal

`engine.destroy()` halts the loop, drops every listener, stops every loop the
audio bus is running, and disposes the renderer. The scene and the objects the
game placed in it stay as they stand, so a caller that reads the scene after
destroying the engine still finds what the last frame left, and the objects
remain the game's to dispose.
