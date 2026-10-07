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

A 2D game needs two kinds of file: images it draws and audio it plays. Each has
its own loader, which fetches the file and decodes it into the value the rest of
the engine already takes, an `ImageBitmap` a sprite component draws and an
`AudioBuffer` a cue plays. Decoding therefore lives in the engine, and the game
receives something it can use on the next line.

Beneath them sits a generic loader that resolves the path and returns the body.
That is what a game reaching for a third kind of file uses, such as level data,
a font, or a sprite atlas description. The two typed loaders are the paths worth
naming, and the generic one keeps the root rule and the events applying to
everything else.

## Resolving and loading are separate

Loading fetches. Resolving is the pure half: it computes the URL and touches
neither the network nor the event stream. A game that hands a URL to an element
rather than fetching it therefore announces no load, and the events stay a
record of what the engine itself did.

## Three loading moments

The same four members are reached from three places, and which one a build uses
says what the file's lifetime is.

The game instance's `initialize` loads what the whole game needs and holds the
results on the instance. The instance is the one framework object that outlives
a level transition, so a font, a shared sprite sheet, or a UI atlas is fetched
once for the run.

A level's `load` loads what that level needs. It runs as part of opening the
level, and the engine awaits it, so the files belong to the world that is about
to be built and are fetched again when the level is opened again.

A tick loads through `world.assets` when a running world discovers it needs
something. The promise is in flight while frames continue, so the world keeps
simulating and the value is installed when it arrives.

## A level's load precedes its actors

A level's `load` is awaited before the world is built, which is before the game
mode, the game state, or any actor exists. An actor constructed for that level
therefore reads its image as a plain value and hands it straight to a sprite
component, with no placeholder, no null check on every frame, and no code that
swaps a texture in later.

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
[event](/engines/structured-2d/apis/assets/): `asset:loaded` with the path and
the URL it resolved to, or `asset:failed` with the same pair and the reason it
failed. A refused path reports an empty URL, which is the unambiguous signature
of a path the engine rejected rather than a file that resolved and was missing.

Subscribing establishes which files a build asked for and which of them arrived.
That separates a build whose asset never arrived from a build whose drawing is
wrong: a blank playfield attributed to a named file that was asked for and did
not arrive is a different report from a blank playfield with every file present.

Subscription precedes initialization, because the engine exists before any game
code runs. A caller creates the engine, subscribes to `asset:failed`, and then
calls `engine.initialize()`, so the failures it sees are the game's own. The
broadcaster lives on the engine, so that one subscription also covers the loads
every later level performs. A path an event carries names a file in the produced
tree, so a reader of the events finds it on disk without reproducing the
engine's resolution.
