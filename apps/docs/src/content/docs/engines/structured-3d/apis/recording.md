---
title: Recording
---

Scene recording captures what the rendering pipeline submitted to be drawn,
frame by frame: the scene the renderer drew, as its draws, its lights, and its
camera, and the operations the pipeline issued against the screen layer's 2D
context. A player rebuilds the scene from the recording, renders it through the
recorded camera, and re-issues the screen layer's operations over the picture.
The recorder is part of the engine, armed and disarmed through the
[`Engine`](/engines/structured-3d/apis/engine/) object.

The recorder walks the scene the
[pipeline](/engines/structured-3d/apis/rendering/) maintains, after the
pipeline has synced every world-space component's object, and wraps the context
the screen layer draws through. The built-in world-space components and an
`Object3DComponent`'s subtree are captured from the scene; the screen-space
components and a `DrawComponent`'s `DrawApi.ctx` all draw through the wrapped
context, so the whole picture is recorded.

## Engine members

```ts
recording(): boolean;
startRecording(): void;
stopRecording(): Recording;
```

| Member | Returns | Behavior |
| --- | --- | --- |
| `recording()` | `boolean` | Whether frames are being captured. |
| `startRecording()` | `void` | Arms the recorder. Capture begins at the next frame. |
| `stopRecording()` | `Recording` | Disarms the recorder and returns everything captured since `startRecording`. |

`startRecording` throws when the recorder is already armed, and `stopRecording`
throws when it is not. Both name the unbalanced call.

The design size and background a recording reports are fixed when the recorder
is armed, taken from the engine's own
[`EngineOptions`](/engines/structured-3d/apis/engine/) rather than read back from
the canvas when the recording is closed.

## Frame boundaries

Capture begins at the frame after `startRecording`, so a recorder armed from
inside a tick or a `DrawComponent`'s `draw` captures whole frames only. A frame
that opened while the recorder was armed and closes after `stopRecording` is
dropped.

A frame is bracketed around the engine's frame preparation and the pipeline's
drawing. The bracket opens before the engine syncs the two canvases and closes
after the scene has been captured and the pipeline's drawing on the screen
layer has ended, so the viewport fit, the camera update, every world-space
component's object as the pipeline synced it, the collision overlay, and every
screen-space component's operations are inside it, because the collision
overlay is a render switch the pipeline draws. The
[diagnostics](/engines/structured-3d/apis/diagnostics/) overlay, drawn on the
screen layer in device space after the bracket closes, is outside it.

The scene is captured under the render mode in force, so a recording taken
under `wireframe` or `unlit` carries the materials the mode substituted, and a
recording taken with the collision overlay on carries each collider's shape
among the frame's draws. The `normals` mode substitutes a material outside the
recorded kinds, which records as `opaque` naming its constructor.

Capture depends on nothing a renderer does. Under the `headless`
[backend](/engines/structured-3d/apis/rendering/) the recorder captures every
frame identically, so the recording a validator emits is the one the same
frames would have produced in a browser.

## `Recording`

```ts
interface Recording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  geometries: readonly RecordedGeometry[];
  materials: readonly RecordedMaterial[];
  images: readonly CapturedImage[];
  resources: readonly Resource[];
  ops: readonly DrawOp[];
  states: readonly DrawState[];
  draws: readonly RecordedDraw[];
  lights: readonly RecordedLight[];
  cameras: readonly RecordedCamera[];
  frames: readonly RecordedFrame[];
}
```

| Field | Meaning |
| --- | --- |
| `format` | The format version, equal to `RECORDING_FORMAT`. |
| `width` | The logical design width the frames were drawn in. |
| `height` | The logical design height the frames were drawn in. |
| `background` | The CSS color the canvas was cleared to each frame, or `null` for transparency. |
| `geometries` | Every distinct geometry a draw uses, by index. |
| `materials` | Every distinct material a draw uses, by index. |
| `images` | The material maps and the screen layer's bitmaps and pixel buffers, by index. |
| `resources` | The gradients and patterns the screen layer's context produced, by index. |
| `ops` | Every distinct screen layer operation the recording holds, by index. |
| `states` | Every distinct inherited screen layer state block, by index. |
| `draws` | Every distinct draw a frame submitted, by index. |
| `lights` | Every distinct light a frame carried, by index. |
| `cameras` | Every distinct camera a frame rendered through, by index. |
| `frames` | The frames captured, in order. |

The nine tables belong to the whole recording rather than to any one frame.
Each holds every distinct entry once, and a frame names the entries it needs by
index, so a geometry uploaded on the first frame and still drawn a thousand
frames later resolves when that later frame is drawn by itself. The tables are
settled when the recording is closed, from the frames it holds. Every entry is
one some frame names, and a screen layer wiped part-way through a frame takes
the entries of the operations it erased with it.

`RECORDING_FORMAT` is the integer this engine writes, version `1`. A player
reads the field first and refuses a document stating anything else.

## `RecordedFrame`

```ts
interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  camera: number;
  lights: readonly number[];
  draws: readonly number[];
  screen: ScreenFrame;
  truncated?: boolean;
}
```

| Field | Meaning |
| --- | --- |
| `count` | The engine's frame counter at this frame. |
| `timeMs` | Accumulated simulated time through this frame, in milliseconds. |
| `deltaMs` | What this frame was worth, in milliseconds. |
| `surface` | The canvas backing store this frame was drawn into, in device pixels. |
| `camera` | Index into `cameras` of the camera this frame was rendered through. |
| `lights` | Indices into `lights` of the lights lit in this frame. |
| `draws` | Indices into `draws` of the objects this frame submitted, in scene traversal order. |
| `screen` | The screen layer's part of the frame, as the 2D format records a frame. |
| `truncated` | Present and `true` when something in this frame's scene was left out of the recording. |

`count`, `timeMs`, and `deltaMs` are the figures
[`FrameInfo`](/engines/structured-3d/apis/engine/) carries for the same frame.

`truncated` on a frame is the scene's flag. It is written when a renderable
object of a kind the format does not carry, a light of a kind it does not
carry, a material map the recorder could not capture, or a geometry past the
attribute budget was left out of this frame, and a single flag stands for
however many. The screen layer's own flag sits on `screen`. A player reports
either flag beside everything else it could not reproduce, which is what lets a
reviewer tell a picture the format could not carry from one it carried.

## Scene capture

After the pipeline has synced every world-space component's object, the
engine updates the scene's world matrices and walks `engine.scene` in
traversal order. It records every object
that is a `Mesh`, `InstancedMesh`, `SkinnedMesh`, `Line`, `LineSegments`,
`LineLoop`, or `Points`, that is visible with every ancestor visible, and whose
layers intersect the camera's. Frustum culling is the renderer's own
optimization and changes no picture, so the recorder ignores it and a culled
object is recorded like any other. Any other renderable object is left out and
the frame is marked `truncated`.

The walk reads the scene as the pipeline left it, so a draw carries the
object's world matrix and material as they stood after the sync: a
`MeshComponent`'s mesh at its component's world transform, a `ModelComponent`'s
clone after its mixer advanced, a billboard turned to the camera, and an
`Object3DComponent`'s subtree as the game left it. The camera is read at the
same moment, after the world's camera followed its target, was clamped to its
bounds, and had its aspect held at the design aspect. Capture happens whether
or not a renderer exists, so a recording taken under `headless` matches one
taken under `webgl` frame for frame.

## `RecordedDraw`

```ts
interface RecordedDraw {
  geometry: number;
  material: number;
  matrix: Mat4;
  renderOrder: number;
  instances?: readonly number[];
  bones?: readonly number[];
  bind?: Mat4;
}
```

| Field | Meaning |
| --- | --- |
| `geometry` | Index into `geometries` of the geometry drawn. |
| `material` | Index into `materials` of the material drawn with. |
| `matrix` | The object's world matrix, sixteen numbers column-major. |
| `renderOrder` | The object's `renderOrder`. |
| `instances` | An `InstancedMesh`'s instance matrices, sixteen numbers per instance, in instance order. |
| `bones` | A `SkinnedMesh`'s skeleton bone matrices for this frame, sixteen numbers per bone, in bone order. |
| `bind` | A `SkinnedMesh`'s `bindMatrix`. |

Draws are listed in scene traversal order and carry `renderOrder`. A player
hands them to three as objects, and three sorts opaque and transparent draws
the way the original renderer did, so a draw's place in the picture comes from
the same rule that placed it originally.

An `InstancedMesh` records one draw carrying `instances`, with as many
matrices as its `count`. A `SkinnedMesh` records its rest geometry once, and
each draw of it carries the skeleton's bone matrices for that frame and its
`bindMatrix`, so a player reproduces the pose by feeding the same matrices to
the same skinning the renderer performs. A mesh whose `material` is an array is
left out and the frame is marked `truncated`.

A draw is keyed on its recorded fields and held once, so an object that sits
still under one material costs one entry however many frames draw it.

## `RecordedGeometry`

```ts
interface RecordedGeometry {
  mode: "triangles" | "lines" | "line-strip" | "line-loop" | "points";
  count: number;
  positions: string;
  normals?: string;
  colors?: string;
  uvs?: string;
  indices?: string;
  skinIndices?: string;
  skinWeights?: string;
}
```

| Field | Meaning |
| --- | --- |
| `mode` | How the vertices are assembled: `triangles` for a mesh, `lines` for `LineSegments`, `line-strip` for `Line`, `line-loop` for `LineLoop`, `points` for `Points`. |
| `count` | The number of vertices. |
| `positions` | The `position` attribute, base64 Float32, three per vertex. |
| `normals` | The `normal` attribute, base64 Float32, three per vertex. |
| `colors` | The `color` attribute, base64 Float32, three per vertex. |
| `uvs` | The `uv` attribute, base64 Float32, two per vertex. |
| `indices` | The index buffer, base64 Uint32. |
| `skinIndices` | The `skinIndex` attribute, base64 Uint16, four per vertex. |
| `skinWeights` | The `skinWeight` attribute, base64 Float32, four per vertex. |

Attribute bytes are carried exactly: each string is the base64 of the typed
array's bytes, little-endian, with no rounding. A `Uint16` index buffer is
widened to `Uint32` before encoding, so `indices` decodes into one array type.
An attribute the geometry does not carry is omitted.

A geometry is keyed on its identity together with the `version` of each of its
attributes, and encoded once per distinct content, so a static mesh costs one
entry however many frames draw it and a geometry whose attribute a build
rewrites costs one entry per version drawn.

Geometry capture stops once a recording holds 64 MB of attribute bytes,
counted over the bytes the recording carries. Geometries already captured keep
resolving, and a draw needing a further new geometry is left out with the
frame marked `truncated`.

## `RecordedMaterial`

```ts
interface RecordedMaterial {
  kind: "basic" | "lambert" | "phong" | "standard" | "line" | "points" | "opaque";
  name?: string;
  color: string;
  opacity: number;
  transparent: boolean;
  side: "front" | "back" | "double";
  wireframe: boolean;
  vertexColors: boolean;
  flatShading: boolean;
  depthTest: boolean;
  depthWrite: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  shininess?: number;
  specular?: string;
  map?: number;
  size?: number;
  linewidth?: number;
}
```

| Field | Meaning |
| --- | --- |
| `kind` | The material class: `basic`, `lambert`, `phong`, `standard`, `line`, `points`, or `opaque` for a class outside those. |
| `name` | An `opaque` material's constructor name. |
| `color` | The base color as `#rrggbb`. |
| `opacity` | The opacity in `0..1`. |
| `transparent` | Whether the material is drawn in the transparent pass. |
| `side` | Which faces are drawn. |
| `wireframe` | Whether the geometry is drawn as edges. |
| `vertexColors` | Whether the geometry's `color` attribute modulates the color. |
| `flatShading` | Whether faces are shaded flat. |
| `depthTest` | Whether the depth buffer is tested. |
| `depthWrite` | Whether the depth buffer is written. |
| `emissive` | The emissive color as `#rrggbb`, for a lit kind. |
| `emissiveIntensity` | The emissive intensity, for a lit kind. |
| `metalness` | A `standard` material's metalness. |
| `roughness` | A `standard` material's roughness. |
| `shininess` | A `phong` material's shininess. |
| `specular` | A `phong` material's specular color as `#rrggbb`. |
| `map` | Index into `images` of the color map. |
| `size` | A `points` material's point size. |
| `linewidth` | A `line` material's line width. |

`MeshBasicMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial`,
`MeshStandardMaterial`, `LineBasicMaterial`, and `PointsMaterial` record as the
kind that names them, and a subclass of one of those records as the kind of the
class it extends, so a `MeshPhysicalMaterial` records as `standard` with its
standard fields. A field a kind does not carry is omitted.

A material class outside those, a `ShaderMaterial` for one, records as `opaque`
with its constructor name in `name` and whatever of `color`, `opacity`,
`transparent`, and `side` it carries, the rest at their `MeshBasicMaterial`
defaults. A player draws it as `basic` and reports it.

A material is keyed on its recorded fields, so two materials that draw the same
way are one entry. A material's `map` is captured as a `CapturedImage` under
the rules and budget given below, and `map` names the entry. A map the recorder
could not capture is left off the material and the frame is marked
`truncated`.

## `RecordedLight`

```ts
type RecordedLight =
  | { kind: "ambient"; color: string; intensity: number }
  | {
      kind: "hemisphere";
      color: string;
      groundColor: string;
      intensity: number;
      position: Vec3;
    }
  | {
      kind: "directional";
      color: string;
      intensity: number;
      position: Vec3;
      direction: Vec3;
    }
  | {
      kind: "point";
      color: string;
      intensity: number;
      position: Vec3;
      distance: number;
      decay: number;
    }
  | {
      kind: "spot";
      color: string;
      intensity: number;
      position: Vec3;
      direction: Vec3;
      distance: number;
      decay: number;
      angle: number;
      penumbra: number;
    };
```

| Field | Meaning |
| --- | --- |
| `kind` | The light class: `AmbientLight`, `HemisphereLight`, `DirectionalLight`, `PointLight`, or `SpotLight`. |
| `color` | The light's color as `#rrggbb`; a hemisphere light's sky color. |
| `groundColor` | A hemisphere light's ground color as `#rrggbb`. |
| `intensity` | The light's intensity. |
| `position` | The light's world position. |
| `direction` | The unit vector from the light's world position toward its target's world position. |
| `distance` | A point or spot light's range, `0` for unbounded. |
| `decay` | A point or spot light's falloff exponent. |
| `angle` | A spot light's cone half-angle, in radians. |
| `penumbra` | A spot light's penumbra fraction. |

A light is recorded when it is visible with every ancestor visible and its
layers intersect the camera's, the same rule a draw follows. Positions and
directions are in world space, so a player places each light directly and
needs none of the hierarchy the light hung under. Any light of another class is
left out and the frame is marked `truncated`.

A light is keyed on its recorded fields and held once, so a fixed lighting rig
costs one entry per light for the whole recording.

## `RecordedCamera`

```ts
interface RecordedCamera {
  projection: "perspective" | "orthographic";
  matrix: Mat4;
  fov?: number;
  near: number;
  far: number;
  zoom: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}
```

| Field | Meaning |
| --- | --- |
| `projection` | Which camera class the frame was rendered through. |
| `matrix` | The camera's world matrix, sixteen numbers column-major. |
| `fov` | A perspective camera's vertical field of view, in degrees. |
| `near` | The near plane. |
| `far` | The far plane. |
| `zoom` | The camera's zoom. |
| `left`, `right`, `top`, `bottom` | An orthographic camera's extents. |

The camera is the world's camera as it stood when the frame was rendered,
after it followed its target and was clamped to its bounds. A perspective
camera's aspect is the design aspect, `width / height`, and is
supplied by the player from the recording's design size rather than carried. A
camera is keyed on its recorded fields and held once, so a fixed camera costs
one entry however many frames render through it.

## `ScreenFrame`

```ts
interface ScreenFrame {
  state: number;
  stack: readonly number[];
  ops: readonly number[];
  truncated?: boolean;
}
```

| Field | Meaning |
| --- | --- |
| `state` | Index into `states` of the context state the screen layer inherited this frame, before its own operations. |
| `stack` | Indices into `states` of the states the context had saved when this frame opened, outermost first. |
| `ops` | Indices into `ops` of the operations the screen layer issued this frame, in the order they were issued. |
| `truncated` | Present and `true` when the save stack, a clip region, or the current path this frame inherited was cut down to its bound. |

`ScreenFrame` is the 2D format's frame without its metadata, and the screen
layer is recorded by the same wrapper the 2D engines record their context
with. Everything below about states, operations, values, images, and resources
is the 2D contract applied to the screen layer's context.

A build is free to call `save` on one frame and `restore` on the next, so the
stack of saved states survives a frame boundary along with the state on top of
it. `stack` carries those states, and a player pushes them before applying the
frame's own state, which is what makes a `restore` among the frame's operations
return to the state the original returned to.

`stack` holds at most 64 entries. A build that saves more often than it restores
runs deeper than that, and the entries kept are the innermost ones, because a
`restore` pops the innermost first. The bound is part of the format, so a
player refuses a document carrying a longer stack.

The clip region and the current path are shadowed and bounded at 1024 path
operations each, because neither has a frame boundary to bound it. The current
path keeps the operations it already holds and refuses each further one, so a
frame inherits the prefix of the path the build built.

A `clip` call costs the whole of the path in force plus the call itself, and it
is carried whole or not at all, because half a clip path is a region the build
never had. It is refused when the region it would leave behind runs past 1024
operations, and refused when the path it would take is itself a prefix. A
refused clip leaves the region in force as it stands, so a frame inherits a
region wider than the one the build was drawing under.

`truncated` is written on a screen frame that inherited a save stack, a clip
region, or a current path the recorder had cut down, and a single flag stands
for however many of the three. A clip region counts whether it belongs to the
frame's own state or to a state on its stack.

## `DrawState`

```ts
interface DrawState {
  properties: Readonly<Record<string, DrawValue>>;
  transform: readonly number[] | null;
  lineDash: readonly number[] | null;
  clip: readonly PathSegment[];
  path: readonly PathSegment[];
}

interface PathSegment {
  transform: readonly number[] | null;
  ops: readonly DrawOp[];
}
```

| Field | Meaning |
| --- | --- |
| `properties` | The style properties in force at the top of the frame, by name. |
| `transform` | The transform as `[a, b, c, d, e, f]`, or `null` when the context reported none. |
| `lineDash` | The dash pattern, or `null` when the context reported none. |
| `clip` | The clip region in force, as the segments that built it, in the order they were applied. |
| `path` | The current path, as the segments holding the path operations issued since the last `beginPath`. |

`properties` covers the canvas state that survives a frame boundary: the alpha,
the composite operation, the filter, the image smoothing, the stroke and fill
styles, the shadow, the line settings, and the text settings. A property the
context does not carry, or refuses to report, is omitted, so the same recorder
runs over a browser context and over the native canvas a validator supplies as
the screen layer.

A style property holding a gradient or a pattern records as a `$res`, which
resolves from the shared table, so a fill inherited from an earlier frame paints
the same way when the frame is drawn by itself.

### The clip region and the current path

A canvas reports every part of its state except the clip and the current path,
so the recorder shadows both. It keeps the path operations issued since the last
`beginPath` as the current path, and a `clip` call moves that path, together
with the `clip` call itself, onto the clip region already in force. Clips
intersect, so the region in force is every segment of `clip` applied in turn.

A `PathSegment` carries the transform that was in force when its operations were
issued, because a path is given in user space. Both `clip` and `path` are split
into one segment per transform, and a player replays each segment under the
transform that segment carries before setting the state's own.

The current path survives a frame boundary, and `beginPath` and `reset` clear
it, so a build is free to open a path on one frame and fill it on the next.
Applying an inherited clip is what makes carrying the path unavoidable:
replaying a clip segment's path operations leaves the clip outline current, so a
state that stopped at the clip would leave a bare `fill` among the frame's
operations filling that outline. Applying a state therefore issues `beginPath`
after the clip segments and before the path segments.

The clip travels with the rest of the state through `save` and `restore`, and
`reset` clears it. The current path sits outside the saved state and survives
both, so a stack entry carries an empty `path` and the path in force is carried
by the state a frame opens with.

### A canvas reset

Writing the screen canvas's `width` or `height` resets its context: the
transform returns to the identity, the style properties return to their
defaults, the clip region is discarded, and the save stack is emptied. The
engine synchronizes the screen layer's backing store to the stage canvas's from
inside the frame bracket, so a recording has to survive one, and
`ctx.canvas.width = ctx.canvas.width` is the ordinary way a build wipes
the layer.

The recorder detects a reset by watching the element. It installs its own
`width` and `height` accessors on the screen canvas, each forwarding to the
accessor it inherits and telling the recorder after the write, so a reset that
leaves the size exactly where it was is seen. The accessors go on only where
the canvas inherits an accessor pair, and the fallback is the backing store
size, read before each shadowed operation and before each state snapshot: a
size that differs from the one last seen is a context that was reset between
the two.

A reset clears the save stack, the clip, and the current path. The transform,
the properties, and the dash are read back from the context itself and correct
themselves. A reset inside a frame also discards the screen layer operations
that frame had already recorded, because the wipe erased the pixels they drew,
and the frame's inherited state is taken again against the context the reset
left. The frame's scene is unaffected, because the scene is captured from the
scene object rather than from the layer.

## `DrawOp`

```ts
type DrawOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };
```

| Field | Meaning |
| --- | --- |
| `method` | The method called. |
| `args` | The call's arguments, encoded as `DrawValue`. |
| `property` | The property assigned. |
| `value` | The value assigned, encoded as `DrawValue`. |

Every entry of `ops` is an operation the screen layer's context itself
performed on itself. The call that produced a gradient or a pattern, and every
operation performed on that value afterwards, belong to its `Resource` recipe
instead, so a player issues each operation against the context it is drawing
into and has nothing else to dispatch on.

A `set` records the value the build supplied rather than the value the context
normalized it to, so a color written as `#fff` records as `#fff` and the
recording states what the build did.

A call's arguments are resolved before the call is issued, because a call can
change what its own argument holds. `ctx.drawImage(ctx.canvas, …)` is the
ordinary trails blit, and a source read after the blit is the surface the blit
left behind, which replays as the picture composited on top of itself.

## `DrawValue`

```ts
type DrawValue =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue[]
  | { readonly $res: number }
  | { readonly $img: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue };
```

| Form | Meaning |
| --- | --- |
| `null`, `boolean`, `number`, `string` | The value itself. |
| Array | Each entry encoded in turn. |
| `{ $res: n }` | `resources[n]`, a value the context produced. |
| `{ $img: n }` | `images[n]`, a bitmap or pixel buffer. |
| `{ $opaque: "Name" }` | A value the recorder could not carry, named by its constructor. |
| `{ $opaque: "truncated" }` | The remainder of a container the expansion bound fell inside. |
| Object | A plain object, encoded field by field. |

A player draws an operation whose arguments resolve and reports one carrying an
`$opaque` value rather than substituting something else.

Encoding a value always terminates in one of these forms. A cyclic object and an
object whose getter throws each record as `{ $opaque: … }`, so a build draws the
same pixels whether or not anything is being captured.

Two bounds keep the encoding finite. The value an operation carries sits at
depth zero, and an array or plain object reached at depth 32 records as
`{ $opaque: … }` rather than being expanded, so a container wrapped in 32 others
is a marker. One encoded value also expands into at most 65,536 values, counted
over every value the walk reaches. A structure whose nodes are shared resolves
once and is charged again wherever it is reached, because the document writes
the sharing out in full.

A container the expansion bound falls inside stops there and carries its
remainder as a single `{ $opaque: "truncated" }`: the last element of an array,
and the field named `$rest` of an object. Both bounds are part of the format
rather than a choice a recorder makes, so every recorder writing this format
answers the same input with the same document.

## `CapturedImage`

```ts
type CapturedImage =
  | { kind: "bitmap"; width: number; height: number; src: string }
  | { kind: "pixels"; width: number; height: number; data: string };
```

| Field | Meaning |
| --- | --- |
| `kind` | How the value is rebuilt: `bitmap` as an image a context draws or a texture samples, `pixels` as `ImageData`. |
| `width` | The captured width in pixels. |
| `height` | The captured height in pixels. |
| `src` | A `data:image/png;base64,…` URL holding a `bitmap` entry's pixels. |
| `data` | A `pixels` entry's RGBA bytes, base64 encoded, four bytes per pixel in row order. |

A `bitmap` entry rebuilds where a `CanvasImageSource` is expected, for
`drawImage` and `createPattern`, and as the image of a `THREE.Texture` where a
material's `map` names it. A `pixels` entry rebuilds as the `ImageData` a
`putImageData` writes, by decoding `data` straight into the buffer, which is
exact by construction and needs no image decoder.

A `pixels` entry carries its bytes because the canvas round trip a PNG needs is
lossy. Drawing an image into a canvas premultiplies each color channel by the
pixel's alpha, and reading the pixels back un-premultiplies them, so a partially
transparent pixel is quantized to eight bits twice and comes back a different
color. `ImageData` is the one kind of image a check compares byte for byte, so
it is carried byte for byte.

A fixed source is keyed on its identity and encoded once, so the common sprite
case is carried a single time however many frames draw it. An `HTMLImageElement`
or `SVGImageElement` is keyed together with the file it points at and the size
it was captured at, so re-pointing one at another file captures the new content.
An `<img>` is captured at its natural size; an `<image>` in an SVG document
reports no natural size and is captured at its layout size, so a drawing that
resizes one captures it again. An `ImageBitmap` is immutable and is keyed on
identity alone.

A mutable source is captured at every use and entries are shared on the bytes
they hold. An `HTMLCanvasElement`, `OffscreenCanvas`, `HTMLVideoElement`,
`VideoFrame`, or `ImageData` therefore costs one entry however many times it is
drawn while its content stands, and one entry per distinct content it is drawn
under. Capturing at every use is what lets an `ImageData` mutated between two
`putImageData` calls in the same frame replay as two different pictures.

A material's `map` is captured through the same table. The texture's source
image is captured as a `bitmap` entry under the keying rules above, so a
texture `loadTexture` decoded is keyed on its `ImageBitmap` and carried once,
and a texture over a canvas is captured at every draw and shared on its bytes.

Capture stops once the recording holds 16 MB of image bytes, counted over the
bytes the recording carries, material maps and screen layer sources together.
Images already captured keep resolving. A further new capture on the screen
layer records `{ $opaque: "<TypeName>" }`, the same degradation a player
already reports, and a further new material map is left off its material with
the frame marked `truncated`.

## `Resource`

```ts
interface Resource {
  make: { method: string; args: readonly DrawValue[] };
  then: readonly ResourceOp[];
}

type ResourceOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };
```

| Field | Meaning |
| --- | --- |
| `make` | The context call that created the value, with its arguments encoded as `DrawValue`. |
| `then` | The calls and assignments made on the value before this use, in order. |

Exactly four context methods produce a resource: `createLinearGradient`,
`createRadialGradient`, `createConicGradient`, and `createPattern`. A producing
call belongs to the recipe of the value it made rather than to the frame, so
`ops` holds no producing call. A `createPattern` that answers `null` produces
neither a resource nor an operation, and the `null` travels as itself.

A resource is captured at the moment the value is used, as an argument or as an
assigned value, and holds the creating call plus the mutations applied up to
that point. Two uses of the same value with the same history name the same
resource, and a value that is created and never used is left out.

A style property holds a live reference to the value assigned to it, so a
gradient given another color stop after it was assigned to `fillStyle` paints
under that stop without ever being assigned again. A produced value is
therefore resolved as of the paint rather than as of the assignment.

Six calls paint through the style properties: `fill`, `stroke`, `fillRect`,
`strokeRect`, `fillText`, and `strokeText`. Before recording one of them, the
recorder compares each style property holding a produced value against the
encoding it last emitted for that property. A recipe that has grown since then
means the property paints something else now, so the recorder records a
corrective `set` for that property first and the operations that follow state
what the context is about to paint.

The record of what was last emitted travels with the state. A `save` copies it
onto the save stack and a `restore` puts back the copy taken at the matching
`save`, so a paint after a restore is measured against the encoding that was in
force when that state was saved, which is what a `restore` returns the player's
context to. A `reset` or a canvas reset empties the record along with the rest
of the state, and an assignment of a value the context did not produce drops the
entry for that property.

The recorder collects a produced value's recipe from the moment the context
creates it, whether or not the recorder is armed, so a build that creates its
gradients once at startup and fills with them for the rest of its life records
every fill under the stops that fill had. A recipe holds at most 1024 mutation
steps, past which the value records as `{ $opaque: … }`.

A recipe's arguments are as of the producing call. `createPattern` copies its
source when it is called, so a pattern made from a scratch canvas holds the
picture that canvas carried at that moment and keeps it when the canvas is
repainted afterwards.

Encoding therefore runs in two stages. A value is resolved into a portable form
when it is observed, at a producing call, at a mutation step, or at an
assignment: a host object becomes captured bytes, a nested recipe, or an opaque
marker, and every number is rounded. That portable form is interned into the
running recording's tables at the moment of use, so only the table indices are
deferred and a pattern's source appears in `make.args` as a `$img` naming the
bytes the pattern was made from.

### Everything else a context call returns

A recipe is re-issued against the context a player is drawing into, which is
faithful only for a value whose content is independent of context state. The
rest of what a context call returns is therefore carried as data:

| Returned value | Recorded as |
| --- | --- |
| `DOMMatrix`, `DOMMatrixReadOnly` | `{ a, b, c, d, e, f }`. |
| `ImageData` | A `CapturedImage` of kind `pixels`, referenced as a `$img`. |
| An array or a plain object | Its fields, encoded one by one. |
| Anything else | `{ $opaque: … }`. |

A matrix records as the `DOMMatrix2DInit` that `setTransform` accepts, so a
build that reads its transform, changes it, and later puts the original back
replays under the transform it drew with. Encoding an array or a plain object
field by field is what keeps the answers to `getLineDash` and
`getContextAttributes` out of the resource table.

## Numbers

Every number inside a `DrawValue`, a `DrawState`, a resource recipe, a
transform, or a dash array is written to at most nine significant digits, and so
is every matrix, position, direction, and scalar a draw, light, camera, or
material carries. Nine significant digits over a design space of a thousand-odd
units resolves to about a millionth of a pixel, so the digits past that
describe the arithmetic that produced a coordinate rather than the picture it
draws.

Attribute bytes are outside the rounding. A geometry's positions, normals,
colors, uvs, indices, and skin attributes are carried as the bytes the build
uploaded, so a decoded geometry is the geometry the renderer drew.

The frame metadata is exact. `count`, `timeMs`, `deltaMs`, and `surface` are the
axis a reviewer scrubs on and the surface a frame was drawn into, and both are
compared against figures a check asserts.

## Drawing a frame

Every frame is drawn from itself alone:

1. Fit a viewport from `frame.surface` and the recording's design size, clear
   the whole canvas to `background`, and apply the letterboxed viewport and
   scissor.
2. Build the camera from `cameras[frame.camera]`: decompose `matrix` into
   position, rotation, and scale, apply the projection fields, set a
   perspective camera's aspect to `width / height`, and update the projection
   matrix.
3. Add each light of `frame.lights` at its recorded position, pointing a
   directional or spot light along its recorded direction.
4. For each entry of `frame.draws`, build the object of the geometry's `mode`
   from the decoded geometry and material, set its world matrix directly with
   `matrixAutoUpdate` off, set `renderOrder`, and apply `instances`, `bones`,
   and `bind` where present.
5. Render the scene through the camera.
6. Draw `frame.screen` over the picture: blank the screen context, then for
   each entry of `screen.stack`, outermost first, apply that state and `save`
   the context, then apply `states[screen.state]`, then issue each of
   `screen.ops` in order, resolving it through `ops`.

A decoded geometry and material are reused across frames of the same recording,
so seeking costs the draw and not the decode. The picture a player draws is
unshadowed, because the format carries no shadow settings, and an `opaque`
material draws as `basic` and is reported.

Applying a screen state means its `properties`, then each of its `clip`
segments under the transform that segment carries, then `beginPath`, then each
of its `path` segments under the transform that segment carries, then the
state's own `transform`, then its `lineDash`.

A `$img` resolves against the decoded image table, whether a material's `map`
or a screen operation's argument names it. A `$res` is built on demand: issue
`make` against the context being drawn into, because a gradient and a pattern
are bound to the context that created them, then apply each entry of `then` to
what came back. A built resource is reused for the rest of that frame.

A player performs an assignment only to a property the subject carries and will
take: one found by walking the subject and its prototypes as far as (and not
including) `Object.prototype`, holding either a setter or a writable value. Any
other name is skipped and reported. `__proto__` is skipped this way: a build
that assigns `ctx.__proto__ = null` records an ordinary assignment, and
performing it would sever the prototype every canvas method lives on.

A `bitmap` entry that fails to decode resolves to nothing; an operation naming
it is skipped and reported the way an operation carrying an `$opaque` value is,
and a material naming it draws without its map and is reported. A `$res` whose
recipe fails to build, or which builds to `null`, is reported the same way. A
`pixels` entry is rebuilt from its own bytes, with no decoder in the way, and
fails in three ways of its own: `data` that is not base64, a byte count that
disagrees with `width × height × 4`, and a host with no `ImageData` to hold the
result. Each is refused and reported like a bitmap that would not decode. A
geometry attribute whose byte count disagrees with `count` and its width is
refused the same way, and the draw naming it is skipped and reported.

Every reference a frame carries, including every reference in its inherited
screen state and in its save stack, resolves from the recording's own tables.
Seeking to a frame therefore costs what drawing it costs.

### The reach of frame independence

A frame carries its camera, its lights, and every draw as submitted, and the
screen layer's part carries the whole of the state it opened with, so a player
lands on any frame and draws it from the recording alone. The scene is exact:
a frame's draws describe the same objects under the same matrices the renderer
was handed, and three sorts and shades them by the same rules. Two properties of
the screen layer's canvas bound how exactly the layer reproduces what was on
screen at that moment.

`putImageData` writes through the clip. Pixels it wrote under a clip belong to
no frame's state and no later frame's clipped clear reaches them, so a replay
drawn from a single frame is cleaner than the original was.

A clip whose edge falls between device pixels is antialiased, and a boundary
pixel is covered partly by what the frame paints and partly by what is already
there. The original shows the frame before it through that coverage and a seek
shows the picture beneath. Frame independence is exact for clips on whole device
pixels, and exact in every other respect.

## Exports

`Recording`, `RecordedFrame`, `ScreenFrame`, `RecordedDraw`,
`RecordedGeometry`, `RecordedMaterial`, `RecordedLight`, `RecordedCamera`,
`DrawState`, `PathSegment`, `DrawOp`, `DrawValue`, `CapturedImage`, `Resource`,
and `ResourceOp` are exported as types from `@test-cabinet/structured-3d`,
together with the [`Vec3` and `Mat4`](/engines/structured-3d/apis/math/) they
use, and `RECORDING_FORMAT` is exported as a value from the same entry point.
