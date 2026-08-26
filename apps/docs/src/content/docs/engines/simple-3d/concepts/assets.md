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

A 3D game needs four kinds of file: meshes it draws, textures it maps onto
them, materials that bind a set of textures into one surface, and audio it
plays. Each has its own loader, which fetches the file and decodes it into the
value the rest of the engine already takes: a handle a draw call accepts, or an
`AudioBuffer` a cue plays. Decoding therefore lives in the engine, and the game
receives something it can use on the next line. There is no image loader,
because a texture is the 3D engine's image.

The typed loaders line up with what the asset-generation tools produce: a glTF
binary from the meshed model kinds, a material document with its PBR maps from
the material kind, a clip from the audio kinds. A case whose build generates
its own assets during the run loads each produced file by the same paths.

Beneath them sits a generic loader that resolves the path and returns the body.
That is what a game reaching for a further kind of file uses, such as level
data, a voxel rig, or a font. The typed loaders are the paths worth naming, and
the generic one keeps the root rule and the events applying to everything else.

## Handles

A mesh, a texture, or a material loads to a handle: an engine-owned, immutable
value the game holds in its [state](/engines/simple-3d/apis/game/) and hands
back to a draw call. A handle's identity is the load that produced it, and its
readable fields are the facts a game plans around: a mesh's bounds and the
names of its nodes and clips, a texture's decoded size, a material's loaded
maps. Nothing is cached across calls, so a game loads once during
initialization and keeps the handle, exactly as a 2D game keeps its
`ImageBitmap`.

A material is one load however many textures its document names. The document
names each map by a path relative to its own directory, so a material and its
textures travel as one folder, and the loader fetches every map inside the one
call. A map that fails fails the whole load, naming the map, because a material
missing one of its textures is not the surface the document describes.

## Resolving and loading are separate

Loading fetches. Resolving is the pure half: it computes the URL and touches
neither the network nor the event stream. A game that hands a URL to an element
rather than fetching it therefore announces no load, and the events stay a record
of what the engine itself did.

## Loading happens during initialization

A game loads what it needs inside its own `initialize` and stores the results in
its state. The engine awaits initialization before the first frame, so every
field of the state is present by the time an update or a render can observe it
and a frame reads a mesh as a value it already holds.

A load that fails rejects, carrying the cause. A game that treats a missing file
as fatal lets the rejection escape, and initialization fails with it; a game with
a fallback catches the rejection and stores the fallback. The decision is made
once, during initialization, rather than on every frame.

## Loads are observed as they happen

Each load announces its outcome as an [event](/engines/simple-3d/apis/game/):
`asset:loaded` with the path and the URL it resolved to, or `asset:failed` with
the same pair and the reason it failed. A refused path reports an empty URL,
which is the unambiguous signature of a path the engine rejected rather than a
file that resolved and was missing. A material load is one event either way,
with a failed map named in the reason.

These events are what separate a build whose asset never arrived from a build
whose drawing is wrong. A blank scene attributed to a named file that was asked
for and did not arrive is a different report from a blank scene with every file
present.

Subscription precedes initialization, because the engine exists before any game
code runs. A caller creates the engine, subscribes to `asset:failed`, and then
calls `engine.initialize()`, so the failures it sees are the game's own. That
ordering is what makes a record unnecessary: the observer is already listening
when the loads happen, and the engine's memory stays flat for a run of any
length.
