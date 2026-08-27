---
title: Authoring a Case Showcase
---

## Overview

A case showcase is the short media carousel a variant presents on the catalog
and case pages, so a visitor sees what the case plays like without opening a
run. The [showcase format](/components/core/showcase/) says how a showcase is
declared, validated, and served; this page says what its media must show and
how to capture that media from the variant's reference implementation. It
applies to every variant that declares a showcase, on every test type.

## What the media must show

A showcase presents the case; it does not prove properties of it. Its media
answers "what is this game like to play", and every entry earns its place by
answering that.

- The leading entry shows sustained, real play: a stretch of a match, a board
  solved from empty to done, a session long enough for the game's rhythm to
  read. On the catalog this entry is the preview stage, so it is the one most
  visitors ever see.
- The case's mechanics appear inside that play. A signature mechanic — spin, a
  moving obstacle, a mid-air collision — is shown by a clip in which it arises
  during the game, at the pace the game gives it.
- Stills follow the play, they never lead it. One or two frames from the same
  session — the field mid-match, the HUD mid-score — round out the carousel.

The [validation baseline](/components/core/validation/) already holds one clip
per scripted review item, each a few seconds of a single mechanic driven to an
assertion. That material serves the reviewer's side-by-side comparison, and it
is the wrong shape for a showcase: a visitor shown a two-second paddle block
learns what the validator checked, not what the game is.

## Capture honestly

Showcase media comes from the variant's reference implementation, and what it
shows must be something the game actually did. Driving the game is expected —
a scripted player, a staged solve path, a chosen seed — but every outcome on
screen arises from the game's own rules under that input. Arranging the input
is authoring; posing the outcome through the debug surface is fabrication.

## Capturing gameplay from a reference implementation

For an engine-format case, capture in process with the case's own validator
harness: stage the validator project into the reference workspace, create a
harness, and drive a real session with the same key-input path a player uses,
recording it with the engine's recorder. Carom v3.0.0 is the worked example —
its capture drivers, staging steps, and environment knobs live at
`test-cases/end-to-end/easy/carom/v3.0.0/showcase/capture/` and adapt readily
to other cases:

- A scripted player drives one side with real key edges against the game's own
  opponent. Where the player needs to be good, plan its inputs through the
  build's exported rules (simulate candidate returns through the game's own
  physics and AI) rather than by relaxing the game.
- Capture is deterministic: a fixed seed replays the identical session. Audition
  several takes with the recorder off — varying the seed and the player's shot
  rotation — judge them on points landed, action cadence, the longest lull, and
  a clean ending, then re-run the winning take under the recorder.
- End the clip on a settled beat, such as the hold after a point, rather than
  mid-flight.

For a case driven in a browser — the [none engine](/engines/none/), or a case
whose play is pointer-driven — drive the served reference build with Playwright
and record the screen. Refract v1.0.0's solve video was captured this way; a
`.webm` clip is transcoded to `.mp4` at publish, so record `.webm` freely.

## Practical bounds

The catalog's preview stage fetches and plays the leading entry the moment a
visitor selects the case, so its weight is a page cost, not an archive cost.

- Aim for a clip of roughly twenty to forty seconds.
- Keep a replay recording near 60 fps after thinning. The validator harness caps
  written replays at 300 frames; the capture drivers make that cap an
  environment override, and a cap near 1500 frames holds a clip of this length
  at full smoothness.
- Keep each compressed file around a megabyte or two. The hard cap is far
  higher, but a multi-megabyte first entry is a slow stage.
- Write the still from the same take the clip came from.

## Wiring it up

Declare the showcase on the variant (`showcase = "showcase/<variant>"`), write
`showcase.md` and `showcase.toml`, and place the media files flat in the
directory, as the [showcase format](/components/core/showcase/#the-case-showcase)
specifies. Resolution hard-fails on a missing or malformed entry, so
`tcab capture-baselines <slug> --dry-run` doubles as a cheap validity check. A
backend that already ingested the version needs a re-ingest and snapshot
refresh before the new media appears.
