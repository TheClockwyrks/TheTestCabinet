---
title: Assets
---

A game names a path and the engine decides the URL. Every path resolves under one
asset root, and the loaders hand back values the game can use directly rather
than bytes it has to decode for itself.

## One root

The root is an engine option, defaulting to `assets/`. Resolution is the
concatenation of the root and the path the game supplied, so a build states where
a file sits relative to the root and never constructs a URL. The rule is
enforced: a path with a leading slash, a `..` segment, or a URI scheme names a
location outside the root and is refused.

One root has two consequences. A build's asset requests all land inside the run's
produced tree, where they can be inspected alongside the code that asked for
them. And one option relocates every request at once, so the same game loads its
files from a served page, from a build output, or from a test process.

## Typed loaders over a generic one

A 3D game needs four kinds of file: images it draws on the screen layer,
textures its materials sample, models it places in the scene, and audio it
plays. Each has its own loader, which fetches the file and decodes it into the
value the rest of the engine already takes: an `ImageBitmap` the screen layer
draws, a `THREE.Texture` a material takes as its map, a `Model` whose scene is
cloned into the engine's, and an `AudioBuffer` a cue plays. Decoding therefore
lives in the engine, and the game receives something it can use on the next
line.

A texture is a decoded image wrapped for three, in the sRGB color space, so a
produced color map reads as it was authored. A model is glTF 2.0, `.glb` or
`.gltf`, decoded to its node hierarchy, its meshes with their attributes, its
materials, its skins, and its animations, which is the format the voxel
binaries emit per part and the voxel-to-glTF exporter writes for a whole rig. A
texture inside a model the host cannot decode leaves that material's map unset
and the model still arrives, because a rig with one bare material is a rig a
game can place and a check can inspect, where a rejected load is nothing at
all.

Beneath them sits a generic loader that resolves the path and returns the body.
That is what a game reaching for a fifth kind of file uses, such as level data, a
font, or a sprite atlas description. The four typed loaders are the paths worth
naming, and the generic one keeps the root rule and the events applying to
everything else.

## Models are templates

A loaded model is a template rather than a thing in the scene. Its `scene` is
the node tree as the file described it, beside the clips the file carries and
the name of every node in traversal order, and it stays as loaded for the life
of the game. A game places the model by cloning it with `cloneModel` and adding
the clone to the engine's scene, and places it again by cloning it again.

Cloning is what lets one file stand for many objects. Each clone is posed,
animated, and removed on its own, and a skinned mesh in a clone stays bound to
its own skeleton rather than the template's, so two crew members cloned from
one rig walk out of step. The template itself stays at its rest pose, so a
clone taken on the nine-hundredth frame starts from the same rest pose as one
taken during initialization.

The node names are what a game reaches a rig's joints by. The voxel exporter
names the parts it emits, a clone keeps those names, and `getObjectByName` on
the clone finds the joint the game drives, the same way the scene itself is
searched.

## Resolving and loading are separate

Loading fetches. Resolving is the pure half: it computes the URL and touches
neither the network nor the event stream. A game that hands a URL to an element
rather than fetching it therefore announces no load, and the events stay a record
of what the engine itself did.

## Loading happens during initialization

A game loads what it needs inside its own `initialize` and keeps each result
where it is read from. A decoded image or an audio buffer is a plain value the
[state](/engines/simple-3d/apis/game/) carries. A texture or a model is a three
object, which the state never carries, so it goes in the render-side cache
beside the objects the game builds, or a clone of it goes straight into the
scene the engine hands `initialize`. The engine awaits initialization before
the first frame, so every field of the state is present by the time an update
or a render can observe it, and a frame reads an image as a value it already
holds and finds a placed model already in the scene.

A load that fails rejects, carrying the cause. A game that treats a missing file
as fatal lets the rejection escape, and initialization fails with it; a game with
a fallback catches the rejection and stores the fallback. The decision is made
once, during initialization, rather than on every frame.

## Loads are observed as they happen

Each load announces its outcome as an [event](/engines/simple-3d/apis/game/):
`asset:loaded` with the path and the URL it resolved to, or `asset:failed` with
the same pair and the reason it failed. A refused path reports an empty URL,
which is the unambiguous signature of a path the engine rejected rather than a
file that resolved and was missing.

These events are what separate a build whose asset never arrived from a build
whose drawing is wrong. An empty scene attributed to a named model that was
asked for and did not arrive is a different report from an empty scene with
every file present.

Subscription precedes initialization, because the engine exists before any game
code runs. A caller creates the engine, subscribes to `asset:failed`, and then
calls `engine.initialize()`, so the failures it sees are the game's own. That
ordering is what makes a record unnecessary: the observer is already listening
when the loads happen, and the engine's memory stays flat for a run of any
length.
