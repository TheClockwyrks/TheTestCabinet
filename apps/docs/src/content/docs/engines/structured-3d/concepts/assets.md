---
title: Assets
---

A game names a path and the engine decides the URL. Every path resolves under
one asset root, and the loaders hand back values the game can use directly
rather than bytes it has to decode for itself.

## One root

The root is an engine option, defaulting to `assets/`. Resolution is the
concatenation of the root and the path the game supplied, so a build states
where a file sits relative to the root and never constructs a URL. The rule is
enforced: a path with a leading slash, a `..` segment, or a URI scheme names a
location outside the root and is refused.

One root has two consequences. A build's asset requests all land inside the
run's produced tree, where they can be inspected alongside the code that asked
for them. And one option relocates every request at once, so the same game loads
its files from a served page, from a build output, or from a test process.

## Typed loaders over a generic one

A 3D game needs four kinds of file: images it draws on the screen layer,
textures its materials sample, models it places in the world, and audio it
plays. Each has its own loader, which fetches the file and decodes it into the
value the rest of the engine already takes: an `ImageBitmap` a sprite component
draws, a `THREE.Texture` a material declaration's `map` takes, a `Model` a model
component places, and an `AudioBuffer` a cue plays. Decoding therefore lives in
the engine, and the game receives something it can use on the next line.

A texture is the decoded image wrapped for three in the sRGB color space, which
is what a color map is, so a game sets it as a material's map and gets correct
color without touching color management. A model is a glTF 2.0 file, `.glb` or
`.gltf`, decoded with its node hierarchy, its meshes and their attributes, its
materials, its skins, and its animations. The files the asset-generation tools
produce load this way: the per-part `.glb` files the voxel binaries emit and
the whole-rig GLB the voxel exporter writes each arrive as one `Model`.

Beneath them sits a generic loader that resolves the path and returns the body.
That is what a game reaching for a fifth kind of file uses, such as level data,
a font, or a sprite atlas description. The four typed loaders are the paths
worth naming, and the generic one keeps the root rule and the events applying
to everything else.

## A model is a template

A loaded model is a template rather than a thing in the scene. Its `scene` is
the decoded node tree as the file describes it, and a game leaves it as loaded;
a `ModelComponent` clones the template on construction, so one `Model` loaded
once backs any number of components, each with its own copy to pose and
animate. A skinned mesh in a clone is bound to its own copy of the skeleton,
which is what lets two characters share one file and stand in two poses.

The template carries the two lists a component is driven through. `animations`
holds every clip the file names, which is what `play` accepts, and `nodes`
holds every node name in traversal order, which is what `node` hands back a
handle for. A game reads both off the model it loaded, so a joint the voxel
exporter named is found by name rather than by walking the tree.

A texture inside a model that the host cannot decode leaves that material's map
unset, and the load still resolves. The model is a value that arrived, with its
geometry and its hierarchy whole, so a load resolves to the same tree on a host
that decodes no images as it does in a browser.

## Resolving and loading are separate

Loading fetches. Resolving is the pure half: it computes the URL and touches
neither the network nor the event stream. A game that hands a URL to an element
rather than fetching it therefore announces no load, and the events stay a
record of what the engine itself did.

## Three loading moments

The same six members are reached from three places, and which one a build uses
says what the file's lifetime is.

The game instance's `initialize` loads what the whole game needs and holds the
results on the instance. The instance is the one framework object that outlives
a level transition, so a font, a shared model, or a UI atlas is fetched once for
the run.

A level's `load` loads what that level needs. It runs as part of opening the
level, and the engine awaits it, so the files belong to the world that is about
to be built and are fetched again when the level is opened again.

A tick loads through `world.assets` when a running world discovers it needs
something. The promise is in flight while frames continue, so the world keeps
simulating and the value is installed when it arrives.

## A level's load precedes its actors

A level's `load` is awaited before the world is built, which is before the game
mode, the game state, or any actor exists. An actor constructed for that level
therefore reads its image, its texture, or its model as a plain value and hands
it straight to a sprite, mesh, or model component.

This is the same guarantee at the level scope that the instance's `initialize`
gives at the game scope. A build states what a level needs beside the level's
own definition, and every actor the level declares starts play with those files
already decoded.

A load that fails rejects, carrying the cause. A level that treats a missing
file as fatal lets the rejection escape; a level with a fallback catches the
rejection and installs the fallback. The decision is made once, while the level
loads, rather than on every frame.

## Loads are observed as they happen

Each load announces its outcome as an
[event](/engines/structured-3d/apis/assets/): `asset:loaded` with the path and
the URL it resolved to, or `asset:failed` with the same pair and the reason it
failed. A refused path reports an empty URL, which is the unambiguous signature
of a path the engine rejected rather than a file that resolved and was missing.

Subscribing establishes which files a build asked for and which of them arrived.
That separates a build whose asset never arrived from a build whose drawing is
wrong: an empty world attributed to a named file that was asked for and did not
arrive is a different report from an empty world with every file present.

Subscription precedes initialization, because the engine exists before any game
code runs. A caller creates the engine, subscribes to `asset:failed`, and then
calls `engine.initialize()`, so the failures it sees are the game's own. The
broadcaster lives on the engine, so that one subscription also covers the loads
every later level performs. A path an event carries names a file in the produced
tree, so a reader of the events finds it on disk without reproducing the
engine's resolution.
