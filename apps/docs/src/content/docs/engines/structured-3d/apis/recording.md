---
title: Recording
---

Scene recording captures what the rendering pipeline submitted to be drawn,
frame by frame: the scene the pipeline submitted to the renderer, as its draws,
its lights, its scene settings, and its camera, and the operations the pipeline
issued against the screen layer's 2D context. A player rebuilds the scene from
the recording, renders it through the recorded camera, and re-issues the screen
layer's operations over the picture. The recorder is part of the engine, armed
and disarmed through the [`Engine`](/engines/structured-3d/apis/engine/) object.

The recorder walks the scene the
[pipeline](/engines/structured-3d/apis/rendering/) maintains, after the
pipeline has synced every world-space component's object, and wraps the context
the screen layer draws through. The built-in world-space components and an
`Object3DComponent`'s subtree are captured from the scene; the screen-space
components and a `DrawComponent`'s `DrawApi.ctx` all draw through the wrapped
context, so the whole picture is recorded.

A recording is an archive. A small JSON document holds tables of references and
scalars, two binary buffers hold the matrices and the embedded geometry the
frames name by span, and every asset the build loaded travels once, byte for
byte, under the hash of its bytes.

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
| `stopRecording()` | `Recording` | Disarms the recorder and returns everything captured since `startRecording`: the document, the buffers, the embedded maps, and the referenced assets. |

`startRecording` throws when the recorder is already armed, and `stopRecording`
throws when it is not. Both name the unbalanced call.

The design size and background a recording reports are fixed when the recorder
is armed, from the engine's own
[`EngineOptions`](/engines/structured-3d/apis/engine/).

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
screen-space component's operations are inside it. The collision overlay is
inside it because it is a render switch the pipeline draws as the last part of
the world pass. The
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

## The archive

The on-disk form of a recording is a zip archive with the extension `.replay`.
A suite writes it to
`$TCAB_VALIDATION_MEDIA_DIR/<staged path>/<output id>.replay`, the runner moves
it to the flat `<verdict>__<output>.replay`, and the backend serves it as
`application/octet-stream`.

| Entry | Compression | Holds |
| --- | --- | --- |
| `recording.json` | Deflated | The [`RecordingDocument`](#recordingdocument): tables of references and scalars, and the frames. |
| `frames.bin` | Stored | One little-endian Float32 buffer holding every matrix the scene half carries per frame: draw world matrices, skinned bind matrices, bone matrices, instance matrices, instance colors, and morph influences. |
| `geometry.bin` | Stored | One little-endian buffer holding the attributes of every embedded geometry. |
| `maps/<n>.png` | Stored | An embedded material image, one the build made itself rather than loaded through the asset loader, by index. |
| `assets/<sha256>` | Stored | A referenced asset file, byte for byte, named by the SHA-256 of its bytes. |

```ts
interface Recording {
  document: RecordingDocument;
  frames: Uint8Array;
  geometry: Uint8Array;
  maps: readonly Uint8Array[];
  assets: readonly { sha256: string; bytes: Uint8Array }[];
}

function packRecording(recording: Recording): Uint8Array;
```

| Field | Meaning |
| --- | --- |
| `document` | The document `recording.json` holds. |
| `frames` | The bytes of `frames.bin`. |
| `geometry` | The bytes of `geometry.bin`. |
| `maps` | The PNG bytes of each `maps/<n>.png`, by index. |
| `assets` | Each referenced asset's bytes under its hash, one entry per `assets/<sha256>`. |

`stopRecording` returns a `Recording`, and `packRecording` builds the archive
from it. A suite writes `packRecording(engine.stopRecording())` to the
`.replay` path, and a player reads the archive back into the same five parts.

### `Span`

```ts
interface Span {
  offset: number;
  length: number;
}
```

| Field | Meaning |
| --- | --- |
| `offset` | The byte offset into the buffer the span belongs to. |
| `length` | The byte length. |

A span names a run of bytes in `frames.bin` or `geometry.bin`; which buffer is
fixed by the field that carries it. Spans are shared on the bytes they name, so
two equal byte runs are one span and a still object's world matrix costs one
span for the whole recording. Every span sits inside its buffer, and a player
refuses one that runs past the end.

## `RecordingDocument`

```ts
interface RecordingDocument {
  format: number;
  width: number;
  height: number;
  background: string | null;
  assets: readonly RecordedAsset[];
  geometries: readonly RecordedGeometry[];
  textures: readonly RecordedTexture[];
  materials: readonly RecordedMaterial[];
  scenes: readonly RecordedScene[];
  images: readonly CapturedImage[];
  resources: readonly Resource[];
  ops: readonly DrawOp[];
  states: readonly DrawState[];
  draws: readonly RecordedDraw[];
  lights: readonly RecordedLight[];
  cameras: readonly RecordedCamera[];
  frames: readonly RecordedFrame[];
  ended?: { count: number; reason: "geometry" | "maps" | "frames" | "assets" };
}
```

| Field | Meaning |
| --- | --- |
| `format` | The format version, equal to `RECORDING_FORMAT`. |
| `width` | The logical design width the frames were drawn in. |
| `height` | The logical design height the frames were drawn in. |
| `background` | The CSS color the canvas was cleared to each frame, or `null` for transparency. |
| `assets` | Every asset file a geometry or texture references, by index. |
| `geometries` | Every distinct embedded geometry a draw uses, by index. |
| `textures` | Every distinct texture a material or scene entry uses, by index. |
| `materials` | Every distinct material a draw uses, by index. |
| `scenes` | Every distinct scene setting a frame carried, by index. |
| `images` | The screen layer's bitmaps and pixel buffers, by index. |
| `resources` | The gradients and patterns the screen layer's context produced, by index. |
| `ops` | Every distinct screen layer operation the recording holds, by index. |
| `states` | Every distinct inherited screen layer state block, by index. |
| `draws` | Every distinct draw a frame submitted, by index. |
| `lights` | Every distinct light a frame carried, by index. |
| `cameras` | Every distinct camera a frame rendered through, by index. |
| `frames` | The frames captured, in order. |
| `ended` | Present when a budget ended the recording: the engine frame counter of the first frame the recording holds no part of, and the budget it hit. |

The twelve tables belong to the whole recording rather than to any one frame.
Each holds every distinct entry once, and a frame names the entries it needs by
index, so a geometry first drawn on the first frame and still drawn a thousand
frames later resolves when that later frame is drawn by itself. The tables are
settled when the recording is closed, from the frames it holds. Every entry is
one some frame names, and a screen layer wiped part-way through a frame takes
the entries of the operations it erased with it.

`RECORDING_FORMAT` is the integer this engine writes. There is one recording
format and it is version `1`; a player reads the field first so it can refuse a
document stating anything else, which is a document no recorder wrote.

## `RecordedAsset` and references

```ts
interface RecordedAsset {
  path: string;
  sha256: string;
  bytes: number;
  kind: "model" | "texture";
}

type GeometryRef =
  | { embedded: number }
  | { asset: number; mesh: number; primitive: number };

type ImageRef =
  | { asset: number }
  | { asset: number; image: number }
  | { map: number };
```

| Field | Meaning |
| --- | --- |
| `path` | The resolved path the [asset loader](/engines/structured-3d/apis/assets/) fetched. |
| `sha256` | The SHA-256 of the file's bytes, hex encoded, naming its `assets/<sha256>` entry. |
| `bytes` | The file's byte length. |
| `kind` | `model` for a file `loadModel` decoded, `texture` for one `loadTexture` decoded. |

The asset loader keeps a registry of every file it resolved, whichever of
`InitApi.assets`, `LoadApi.assets`, or `world.assets` it was reached through:
the resolved path, the SHA-256 of the body bytes, the body bytes, and the
identity of every three object it decoded from the file. A model contributes
each primitive's `BufferGeometry`, by glTF mesh index and primitive index, and
each of its textures' source images, by glTF image index. A texture contributes
the image the file decoded to. A `ModelComponent`'s clone shares geometries and
texture images with its template, so a placed copy's geometry is found in the
registry by identity, and a `MaterialSpec.map` that `loadTexture` decoded is
found the same way.

| Reference | Meaning |
| --- | --- |
| `{ embedded: n }` | `geometries[n]`, a geometry carried in `geometry.bin`. |
| `{ asset: n, mesh: m, primitive: p }` | The geometry of primitive `p` of mesh `m` in the model `assets[n]` holds. |
| `{ asset: n, image: i }` | Image `i` of the model `assets[n]` holds. |
| `{ asset: n }` | The image the texture file `assets[n]` decodes to. |
| `{ map: n }` | `maps/<n>.png`, an image carried in the archive. |

A geometry or image the registry knows is referenced. A player decodes a
referenced model with the same glTF decoder the engine uses and takes the named
primitive's geometry or the named image, and decodes a referenced texture file
to its image; decoded assets are cached for the whole recording. A geometry or
image the registry does not know, whether procedural, derived, or built by
hand, is embedded: the geometry in `geometry.bin`, the image as a `maps/<n>.png`
entry. The mesh the pipeline builds from a `MeshGeometry` is procedural, so
every built-in kind and a `custom` geometry the game built are embedded.

A `.gltf` file that names external buffers or images is recorded together with
each file the decoder fetched through it, every one an asset entry of kind
`model`. A player resolves a URI the file names relative to the model's `path`
and finds it in the `assets` table by that path, so the decoder reads every
sibling from the archive.

An asset enters the table and the archive when the first frame references it.
Its bytes are counted against the referenced-asset [budget](#budgets) at that
moment, and the file travels once however many geometries, images, and frames
name it.

## `RecordedFrame`

```ts
interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  scene: number;
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
| `scene` | Index into `scenes` of the background, fog, and environment this frame was rendered under. |
| `camera` | Index into `cameras` of the camera this frame was rendered through. |
| `lights` | Indices into `lights` of the lights lit in this frame. |
| `draws` | Indices into `draws` of the objects this frame submitted, in scene traversal order. |
| `screen` | The screen layer's part of the frame, as the 2D format records a frame. |
| `truncated` | Present and `true` when something in this frame's scene was left out of the recording. |

`count`, `timeMs`, and `deltaMs` are the figures
[`FrameInfo`](/engines/structured-3d/apis/engine/) carries for the same frame.

`truncated` on a frame is the scene's flag, written when the walk met a
[coverage gap](#coverage-gaps); the screen layer's own flag sits on `screen`.

## Scene capture

After the pipeline has synced every world-space component's object, the engine
updates the scene's world matrices and walks `engine.scene` in traversal order.
It records every object that is a `Mesh`, `InstancedMesh`, `SkinnedMesh`,
`Line`, `LineSegments`, `LineLoop`, `Points`, or `Sprite`, that is visible with
every ancestor visible, and whose layers intersect the camera's. Frustum
culling is the renderer's own optimization and changes no picture, so the
recorder ignores it and a culled object is recorded like any other. Any other
renderable object is left out and the frame is marked `truncated`.

The walk reads the scene as the pipeline left it, so a draw carries the
object's world matrix and material as they stood after the sync: a
`MeshComponent`'s mesh at its component's world transform, a `ModelComponent`'s
clone after its mixer advanced, a billboard turned to the camera, and an
`Object3DComponent`'s subtree as the game left it. A `Sprite` in that subtree
is three's world-space sprite and is recorded as a draw; a `SpriteComponent`
draws on the screen layer and is recorded among the screen operations. The
scene's background, fog, and environment, the camera, and the lights are read
at the same moment, after the world's camera followed its target, was clamped
to its bounds, and had its aspect held at the design aspect. Capture happens
whether or not a renderer exists, so a recording taken under `headless` matches
one taken under `webgl` frame for frame.

### The scene is a projection

The scene half of a frame is a projection of the three scene onto the tables
this page defines: the eight renderable classes, the geometry attributes
`RecordedGeometry` lists, the material kinds and texture slots
`RecordedMaterial` lists, the five light kinds, the two camera classes, and a
scene's background, fog, and environment. A player rebuilds what those tables
carry and three sorts and shades the result by its own rules. The render mode
in force is part of the projection, because the walk sees the materials the
mode substituted, and the collision overlay is part of it, because its shapes
sit in the scene when it draws.

What lies outside the tables is dropped, and a player reports it: shadows, a
`MeshComponent`'s `castShadow` and `receiveShadow` included, materials outside
the named kinds, which travel as `opaque` and draw as `basic`, lights outside
the five kinds, renderables outside the eight classes, and post-processing. A
frame that lost an object carries the `truncated` flag, and an `opaque`
material is reported per entry, so every gap between the recording and the
original picture is named where it occurred.

## `RecordedDraw`

```ts
interface RecordedDraw {
  geometry?: GeometryRef;
  material: number;
  matrix: Span;
  renderOrder: number;
  instances?: Span;
  instanceColors?: Span;
  bones?: Span;
  bind?: Span;
  morph?: Span;
  center?: [number, number];
}
```

| Field | Meaning |
| --- | --- |
| `geometry` | The geometry drawn, embedded or referenced. Absent for a sprite. |
| `material` | Index into `materials` of the material drawn with. |
| `matrix` | The object's world matrix in `frames.bin`, sixteen Float32 column-major. |
| `renderOrder` | The object's `renderOrder`, a `world` component's `layer`. |
| `instances` | An `InstancedMesh`'s instance matrices in `frames.bin`, sixteen Float32 per instance, in instance order. |
| `instanceColors` | An `InstancedMesh`'s instance colors in `frames.bin`, three Float32 per instance, when it carries them. |
| `bones` | A `SkinnedMesh`'s skeleton bone matrices for this frame in `frames.bin`, sixteen Float32 per bone, in bone order. |
| `bind` | A `SkinnedMesh`'s `bindMatrix` in `frames.bin`, sixteen Float32. |
| `morph` | The object's `morphTargetInfluences` in `frames.bin`, one Float32 per morph target, in target order. |
| `center` | A `Sprite`'s `center`. |

Draws are listed in scene traversal order and carry `renderOrder`. A player
hands them to three as objects, and three sorts opaque and transparent draws
the way the original renderer did, so a draw's place in the picture comes from
the same rule that placed it originally.

An `InstancedMesh` records one draw carrying `instances`, with as many
matrices as its `count`, and `instanceColors` when it has an instance color
attribute. A `SkinnedMesh` records its rest geometry once, and each draw of it
carries the skeleton's bone matrices for that frame and its `bindMatrix`, so a
player reproduces the pose by feeding the same matrices to the same skinning the
renderer performs. A `ModelComponent`'s skinned clone therefore costs a bone
span per frame its mixer moves it, over a geometry referenced from its model
once. An object with morph targets carries its influences in `morph`, over the
targets its geometry's `morphs` lists.

A `Sprite` records with no geometry, its `center`, and a material of kind
`sprite`. A mesh whose `material` is an array is left out and the frame is
marked `truncated`.

A draw is keyed on its recorded fields and held once, so an object that sits
still under one material costs one entry however many frames draw it. The
matrices behind a moving object are what grow: each new pose is a new span in
`frames.bin`, and the draw naming it is a new entry.

## `RecordedGeometry`

```ts
interface RecordedGeometry {
  mode: "triangles" | "lines" | "line-strip" | "line-loop" | "points";
  count: number;
  range: [number, number];
  positions: Span;
  normals?: Span;
  colors?: Span;
  uvs?: Span;
  indices?: Span;
  skinIndices?: Span;
  skinWeights?: Span;
  morphs?: readonly { positions: Span; normals?: Span }[];
}
```

| Field | Meaning |
| --- | --- |
| `mode` | How the vertices are assembled: `triangles` for a mesh, `lines` for `LineSegments`, `line-strip` for `Line`, `line-loop` for `LineLoop`, `points` for `Points`. |
| `count` | The number of vertices. |
| `range` | The geometry's draw range as `[start, count]`, with an unbounded count written as `-1`. |
| `positions` | The `position` attribute, Float32, three per vertex. |
| `normals` | The `normal` attribute, Float32, three per vertex. |
| `colors` | The `color` attribute, Float32, three per vertex. |
| `uvs` | The `uv` attribute, Float32, two per vertex. |
| `indices` | The index buffer, Uint32. |
| `skinIndices` | The `skinIndex` attribute, Uint16, four per vertex. |
| `skinWeights` | The `skinWeight` attribute, Float32, four per vertex. |
| `morphs` | One entry per morph target, in target order: the target's position attribute and, when present, its normal attribute. |

Every span names bytes in `geometry.bin`, little-endian, carried as uploaded
with no rounding. Each attribute has the fixed element type and width listed,
so every span decodes into one array type: a narrower typed array is widened
before encoding, and a `Uint8` or `Uint16` index buffer decodes as `Uint32`. A
`Float32` index buffer, or an attribute at another item size, is a gap the
format does not carry, so the geometry is left out and the frame is marked
`truncated`. An attribute the geometry does not carry is omitted.

The recorder keeps a cache keyed on the geometry object's identity together
with the identity and `version` of each attribute and of the index, and the
draw range. A hit reuses the entry. A miss encodes the bytes, and the entry is
shared on those bytes, so two identical procedural geometries, two
`MeshComponent`s declaring the same `box` for one, are one entry however many
objects draw them.

A fresh attribute installed with `setAttribute` or `setIndex` is a new identity
and is captured, as is an attribute whose `version` advanced through
`needsUpdate`. A geometry a build rewrites every frame therefore costs one
entry per distinct content drawn, and one that shares its bytes across rewrites
costs one. A `MeshComponent` whose `geometry` field is reassigned is rebuilt by
the pipeline and costs an entry per distinct content the rebuilds produce. A
`SkinnedMesh` records its rest geometry once; the bone and bind matrices travel
with the draw.

## `RecordedMaterial`

```ts
interface RecordedMaterial {
  kind: "basic" | "lambert" | "phong" | "standard" | "line" | "points" | "sprite" | "opaque";
  name?: string;
  color: string;
  opacity: number;
  transparent: boolean;
  side?: "front" | "back" | "double";
  wireframe?: boolean;
  vertexColors?: boolean;
  flatShading?: boolean;
  depthTest: boolean;
  depthWrite: boolean;
  alphaTest?: number;
  blending?: "normal" | "additive" | "subtractive" | "multiply";
  emissive?: string;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  shininess?: number;
  specular?: string;
  map?: number;
  alphaMap?: number;
  emissiveMap?: number;
  normalMap?: number;
  normalScale?: [number, number];
  roughnessMap?: number;
  metalnessMap?: number;
  aoMap?: number;
  aoMapIntensity?: number;
  size?: number;
  sizeAttenuation?: boolean;
  linewidth?: number;
  rotation?: number;
}
```

| Field | Meaning |
| --- | --- |
| `kind` | The material class: `basic`, `lambert`, `phong`, `standard`, `line`, `points`, `sprite`, or `opaque` for a class outside those. |
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
| `alphaTest` | The alpha below which a fragment is discarded. |
| `blending` | The blend mode: `normal` for `NormalBlending`, `additive` for `AdditiveBlending`, `subtractive` for `SubtractiveBlending`, `multiply` for `MultiplyBlending`. |
| `emissive` | The emissive color as `#rrggbb`, for a lit kind. |
| `emissiveIntensity` | The emissive intensity, for a lit kind. |
| `metalness` | A `standard` material's metalness. |
| `roughness` | A `standard` material's roughness. |
| `shininess` | A `phong` material's shininess. |
| `specular` | A `phong` material's specular color as `#rrggbb`. |
| `map` | Index into `textures` of the color map. |
| `alphaMap` | Index into `textures` of the alpha map. |
| `emissiveMap` | Index into `textures` of the emissive map, for a lit kind. |
| `normalMap` | Index into `textures` of the normal map, for a lit kind. |
| `normalScale` | The normal map's scale as `[x, y]`. |
| `roughnessMap` | Index into `textures` of a `standard` material's roughness map. |
| `metalnessMap` | Index into `textures` of a `standard` material's metalness map. |
| `aoMap` | Index into `textures` of the ambient occlusion map, for a lit kind. |
| `aoMapIntensity` | The ambient occlusion map's intensity. |
| `size` | A `points` material's point size. |
| `sizeAttenuation` | Whether a `points` or `sprite` material scales with distance. |
| `linewidth` | A `line` material's line width. |
| `rotation` | A `sprite` material's rotation, in radians. |

`MeshBasicMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial`,
`MeshStandardMaterial`, `LineBasicMaterial`, `PointsMaterial`, and
`SpriteMaterial` record as the kind that names them, and a subclass of one of
those records as the kind of the class it extends, so a `MeshPhysicalMaterial`
records as `standard` with its standard fields. A field a kind does not carry
is omitted. The material the pipeline builds from a `MaterialSpec` records as
the kind the spec's `kind` names, with the component's `opacity` already
multiplied in.

The fields `color`, `opacity`, `transparent`, `depthTest`, and `depthWrite`
belong to every kind; `side`, `wireframe`, `vertexColors`, `flatShading`,
`alphaTest`, and `blending` belong to every kind but `sprite`. A `sprite`
material carries `map`, `color`, `opacity`, `transparent`, `rotation`,
`sizeAttenuation`, `depthTest`, and `depthWrite`.
The lit kinds, `lambert`, `phong`, and `standard`, carry `emissive`,
`emissiveIntensity`, and the `emissiveMap`, `normalMap`, and `aoMap` slots;
`standard` adds `metalness`, `roughness`, `roughnessMap`, and `metalnessMap`,
and `phong` adds `shininess` and `specular`.

A material class outside those, a `ShaderMaterial` for one, records as `opaque`
with its constructor name in `name` and whatever of `color`, `opacity`,
`transparent`, and `side` it carries, the rest at their `MeshBasicMaterial`
defaults. A player draws it as `basic` and reports it. The `normals` render
mode substitutes such a material for every surface, so a frame captured under
it draws with one `opaque` entry per distinct substitution and reports each.

Each texture slot names an entry of `textures`, captured under the rules given
below. A material is keyed on its recorded fields, so two materials that draw
the same way are one entry. A slot whose texture image the recorder could not
encode is left off the material and the frame is marked `truncated`.

## `RecordedTexture`

```ts
interface RecordedTexture {
  image: ImageRef;
  repeat: [number, number];
  offset: [number, number];
  rotation: number;
  wrapS: "clamp" | "repeat" | "mirror";
  wrapT: "clamp" | "repeat" | "mirror";
  flipY: boolean;
  colorSpace: "srgb" | "linear";
}
```

| Field | Meaning |
| --- | --- |
| `image` | The texture's source image, referenced or embedded. |
| `repeat` | The texture's `repeat` as `[x, y]`. |
| `offset` | The texture's `offset` as `[x, y]`. |
| `rotation` | The texture's `rotation`, in radians. |
| `wrapS`, `wrapT` | The wrap mode on each axis: `clamp` for `ClampToEdgeWrapping`, `repeat` for `RepeatWrapping`, `mirror` for `MirroredRepeatWrapping`. |
| `flipY` | Whether the image is flipped on upload. |
| `colorSpace` | Whether the image is sampled as sRGB or linear. |

A texture whose image the asset registry knows references it, so a texture
`loadTexture` decoded, whether handed to a `MaterialSpec.map` or set on a
material in an `Object3DComponent`'s subtree, and a material map a model
carries both travel as their file. Any other image is embedded as PNG under
`maps/<n>.png`: a canvas the build draws into, a `DataTexture`, an
`ImageBitmap` the build made itself. An embedded image is keyed on its source's
identity together with the texture's `version`, and entries are shared on
their PNG bytes, so a canvas texture the build repaints costs one map per
distinct content and a fixed one costs a single map.

A texture is keyed on its recorded fields and held once. Two textures over one
image with the same transform and wrap settings are one entry.

## `RecordedScene`

```ts
interface RecordedScene {
  background: { color: string } | { texture: number } | null;
  fog:
    | { kind: "linear"; color: string; near: number; far: number }
    | { kind: "exponential"; color: string; density: number }
    | null;
  environment: number | null;
}
```

| Field | Meaning |
| --- | --- |
| `background` | The scene's `background`: a color as `#rrggbb`, an index into `textures`, or `null` for none. |
| `fog` | The scene's `fog`: a `Fog` with its `near` and `far`, a `FogExp2` with its `density`, or `null` for none. |
| `environment` | Index into `textures` of the scene's `environment`, or `null` for none. |

A scene entry is keyed on its recorded fields and held once, so a fixed
background and fog cost one entry for the whole recording. The engine's own
[`background`](/engines/structured-3d/apis/engine/) is the color the whole
canvas is cleared to and travels on the document; `engine.scene`'s
`background` paints inside the viewport alone and travels here.

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
| `kind` | The light class: `ambient` for `AmbientLight`, `hemisphere` for `HemisphereLight`, `directional` for `DirectionalLight`, `point` for `PointLight`, `spot` for `SpotLight`. |
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
directions are in world space, so a `LightComponent`'s light is carried at its
component's world position, pointing along its world forward axis, and a
player places each light directly and needs none of the hierarchy the light
hung under. Any light of another class is left out and the frame is marked
`truncated`.

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
camera's aspect is the design aspect, `width / height`, and is supplied by the
player from the recording's design size rather than carried. A camera is keyed
on its recorded fields and held once, so a fixed camera costs one entry however
many frames render through it. Its `matrix` travels inline in the document as
a `Mat4` rather than as a span into `frames.bin`, so a moving camera costs one
entry per distinct pose.

## Budgets

Four budgets bound the archive, each counted over the bytes it will hold.

| Budget | Counted over | Limit |
| --- | --- | --- |
| `geometry` | The attribute bytes of every embedded geometry, `geometry.bin`. | 16 MB |
| `maps` | The PNG bytes of every embedded map, `maps/<n>.png` together. | 16 MB |
| `frames` | The matrix and influence bytes of every frame, `frames.bin`. | 64 MB |
| `assets` | The bytes of every referenced asset, `assets/<sha256>` together. | 128 MB |

A budget overrun ends the recording. When a frame would take the recording past
any budget, that frame is not recorded and no later frame is either, so every
frame a recording holds is whole. The document carries `ended` naming the
engine frame counter of the first frame not held and the budget it hit. The
recorder stays armed until `stopRecording`, which returns the frames it held
and the `ended` mark, and a player shows where and why a recording ended.

The screen layer keeps the 2D contract's own 16 MB image budget, counted over
its bitmaps and pixel buffers alone, with the `$opaque` degradation that
contract gives a capture past it. That budget degrades operations inside a
frame rather than ending the recording, because the shared 2D wrapper owns the
screen layer.

## Coverage gaps

A coverage gap flags the frame. A renderable outside the eight recorded
classes, a light outside the five kinds, a mesh with a material array, a
geometry attribute outside the listed types and widths, and a texture image the
recorder could not encode are each left out, and the frame's `truncated` flag
is set. An `opaque` material is drawn as `basic` and reported per entry. The
player reports each flag beside everything else it could not reproduce, the
treatment the 2D screen contract gives an `$opaque` value.

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
player refuses a frame carrying a longer stack and reports it beside everything
else it could not reproduce.

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
| `kind` | How the value is rebuilt: `bitmap` as an image a context draws, `pixels` as `ImageData`. |
| `width` | The captured width in pixels. |
| `height` | The captured height in pixels. |
| `src` | A `data:image/png;base64,…` URL holding a `bitmap` entry's pixels. |
| `data` | A `pixels` entry's RGBA bytes, base64 encoded, four bytes per pixel in row order. |

`images` is the screen layer's table, written by the shared 2D wrapper, so its
bitmaps travel as PNG data URLs and its `ImageData` as raw bytes inside
`recording.json`. Material images travel through `textures` instead, as asset
references and `maps/<n>.png` entries.

A `bitmap` entry rebuilds where a `CanvasImageSource` is expected, for
`drawImage` and `createPattern`. A `pixels` entry rebuilds as the `ImageData` a
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
identity alone, so a `SpriteComponent`'s bitmap is carried once.

A mutable source is captured at every use and entries are shared on the bytes
they hold. An `HTMLCanvasElement`, `OffscreenCanvas`, `HTMLVideoElement`,
`VideoFrame`, or `ImageData` therefore costs one entry however many times it is
drawn while its content stands, and one entry per distinct content it is drawn
under. Capturing at every use is what lets an `ImageData` mutated between two
`putImageData` calls in the same frame replay as two different pictures.

Capture stops once the table holds 16 MB of image bytes, counted over the bytes
the recording carries. Images already captured keep resolving, and a further
new capture records `{ $opaque: "<TypeName>" }`, the same degradation a player
already reports.

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

Every number inside `recording.json` is written to at most nine significant
digits: every number inside a `DrawValue`, a `DrawState`, a resource recipe, a
transform, or a dash array, and every position, direction, scalar, and camera
matrix a light, camera, material, texture, or scene entry carries. Nine
significant digits over a design space of a thousand-odd units resolves to
about a millionth of a pixel, so the digits past that describe the arithmetic
that produced a coordinate rather than the picture it draws.

The buffers are outside the rounding. Everything in `frames.bin` and
`geometry.bin` is Float32 or an unsigned integer as uploaded, so a draw's world
matrix, an instance matrix, a bone matrix, and an embedded geometry's
attributes are the values the renderer was handed.

The frame metadata is carried as the engine reported it. `count`, `timeMs`,
`deltaMs`, and `surface` are the axis a reviewer scrubs on and the surface a
frame was drawn into, and both are compared against figures a check asserts.

## Drawing a frame

A player opens a recording once: it unzips the archive, parses
`recording.json`, and holds `frames.bin`, `geometry.bin`, and each `maps/<n>.png`
and `assets/<sha256>` entry as bytes. A referenced asset is decoded on the
first frame that needs it, with the same glTF decoder and image decoder the
engine uses, and the decoded result is cached for the rest of the recording.
An embedded geometry and an embedded map are likewise built from their bytes
on first use and cached.

Every frame is then drawn from itself alone:

1. Fit a viewport from `frame.surface` and the recording's design size, clear
   the whole canvas to `background`, and apply the letterboxed viewport and
   scissor.
2. Apply `scenes[frame.scene]`: the background, the fog, and the environment,
   resolving each texture index through `textures`.
3. Build the camera from `cameras[frame.camera]`: decompose `matrix` into
   position, rotation, and scale, apply the projection fields, set a
   perspective camera's aspect to `width / height`, and update the projection
   matrix.
4. Add each light of `frame.lights` at its recorded position, pointing a
   directional or spot light along its recorded direction.
5. For each entry of `frame.draws`, resolve the geometry through its
   `GeometryRef` and the material through `materials`, build the object of the
   geometry's `mode`, or a `Sprite` at its `center`, read `matrix` from
   `frames.bin` and set it directly with `matrixAutoUpdate` off, set
   `renderOrder`, and apply `instances`, `instanceColors`, `bones`, `bind`, and
   `morph` from their spans where present.
6. Render the scene through the camera.
7. Draw `frame.screen` over the picture: blank the screen context, then for
   each entry of `screen.stack`, outermost first, apply that state and `save`
   the context, then apply `states[screen.state]`, then issue each of
   `screen.ops` in order, resolving it through `ops`.

A decoded geometry, texture, material, and asset are reused across frames of
the same recording, so seeking costs the draw and not the decode. The picture a
player draws is unshadowed, because the format carries no shadow settings, and
an `opaque` material draws as `basic` and is reported.

Applying a screen state means its `properties`, then each of its `clip`
segments under the transform that segment carries, then `beginPath`, then each
of its `path` segments under the transform that segment carries, then the
state's own `transform`, then its `lineDash`.

A `$img` resolves against the decoded image table. A `$res` is built on demand:
issue `make` against the context being drawn into, because a gradient and a
pattern are bound to the context that created them, then apply each entry of
`then` to what came back. A built resource is reused for the rest of that frame.

A player performs an assignment only to a property the subject carries and will
take: one found by walking the subject and its prototypes as far as (and not
including) `Object.prototype`, holding either a setter or a writable value. Any
other name is skipped and reported. `__proto__` is skipped this way: a build
that assigns `ctx.__proto__ = null` records an ordinary assignment, and
performing it would sever the prototype every canvas method lives on.

A `bitmap` entry that fails to decode resolves to nothing; an operation naming
it is skipped and reported the way an operation carrying an `$opaque` value is.
A `$res` whose recipe fails to build, or which builds to `null`, is reported the
same way. A `pixels` entry is rebuilt from its own bytes, with no decoder in the
way, and fails in three ways of its own: `data` that is not base64, a byte
count that disagrees with `width × height × 4`, and a host with no `ImageData`
to hold the result. Each is refused and reported like a bitmap that would not
decode.

The scene half fails the same way. An asset whose bytes hash to something other
than its `sha256`, or which the decoder refuses, resolves to nothing, and every
draw and texture naming it is skipped and reported. A span that runs past its
buffer, an embedded attribute whose byte length disagrees with `count` and its
width, and a draw span whose length disagrees with its matrix count are each
refused, and the draw naming one is skipped and reported. A map that fails to
decode leaves its texture unset, and a material naming it draws without that
slot and is reported.

Every reference a frame carries, including every reference in its inherited
screen state and in its save stack, resolves from the recording's own tables
and buffers. Seeking to a frame therefore costs what drawing it costs.

### The reach of frame independence

A frame carries its scene entry, its camera, its lights, and every draw as
submitted, and the screen layer's part carries the whole of the state it opened
with, so a player lands on any frame and draws it from the recording alone. The
scene half reproduces what the tables carry and reports what they drop, as
given under [the scene is a projection](#the-scene-is-a-projection). Two
properties of the screen layer's canvas bound how exactly the layer reproduces
what was on screen at that moment.

`putImageData` writes through the clip. Pixels it wrote under a clip belong to
no frame's state and no later frame's clipped clear reaches them, so a replay
drawn from a single frame is cleaner than the original was.

A clip whose edge falls between device pixels is antialiased, and a boundary
pixel is covered partly by what the frame paints and partly by what is already
there. The original shows the frame before it through that coverage and a seek
shows the picture beneath. Frame independence holds for clips on whole device
pixels, and in every other respect of the screen layer.

## Exports

`Recording`, `RecordingDocument`, `Span`, `RecordedAsset`, `GeometryRef`,
`ImageRef`, `RecordedFrame`, `ScreenFrame`, `RecordedDraw`,
`RecordedGeometry`, `RecordedMaterial`, `RecordedTexture`, `RecordedScene`,
`RecordedLight`, `RecordedCamera`, `DrawState`, `PathSegment`, `DrawOp`,
`DrawValue`, `CapturedImage`, `Resource`, and `ResourceOp` are exported as
types from `@test-cabinet/structured-3d`, together with the [`Vec3` and
`Mat4`](/engines/structured-3d/apis/math/) they use. `packRecording` is
exported as a function and `RECORDING_FORMAT` as a value from the same entry
point.
