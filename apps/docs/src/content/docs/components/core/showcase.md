---
title: Run Showcase
---

A run showcase is the model's own presentation of the game it built: a
player-facing description and a short, ordered carousel of media. The model
writes it into its repository during the run, record assembly captures it onto
the [run record](/components/core/run-records/#showcase), and the run's Play
page renders it around the playable build. A run whose tree holds no readable
showcase, including every run recorded before the field existed, simply has
none, and the Play page shows the plain playable embed.

The showcase is instructed through the case's prompt and specs rather than
declared by any manifest key. It is a convention over the produced tree, so the
same capture applies to every test type that asks for one.

## The produced files

The model writes a `showcase/` directory at the root of its repository:

- `showcase/showcase.md` — the description: player-facing markdown in the style
  of a store page. It may reference images in the same directory by bare
  relative path (`![Title](title.png)`).
- `showcase/showcase.toml` — the carousel: repeated `[[media]]` tables, each
  naming a `file` in `showcase/` itself, with no subdirectories, and a short
  caption `name`. Table order is carousel order.
- The media files themselves, beside those two.

A media file's kind is inferred from its extension, by the same rule as a
declared proof:

| Extension | Kind |
| --- | --- |
| `.png` | `image` |
| `.json.gz` | `replay`: a gzipped engine draw-command [recording](/components/core/engines/#recording) |
| `.webm` | `video` |

Prompts steer the model toward replays for moving footage. The engine records
them itself through its recording bracket, they are far smaller than video, and
the player scrubs them. Video is supported through the whole pipeline but
discouraged in prompts.

## Capture

At record-assembly time the showcase is read from the produced tree's
`showcase/` directory and written onto the record: the description text and the
ordered media entries, each with its file name, caption, and kind.

Capture is bounded:

- The description is capped at 64 KiB, truncated on a character boundary with a
  truncation marker.
- The carousel is capped at 10 entries; excess entries are dropped with a
  warning.
- A media entry whose file is missing, or larger than 25 MiB, is dropped with a
  warning.
- A showcase that cannot be parsed records no showcase, with a warning.

A showcase problem never fails a run and never degrades its status. The
showcase is presentation, so the worst a malformed one costs is itself.

## Serving and publishing

The showcase's bytes travel the same path as the run's proof, asset, and
validation media:

- The [driver](/components/driver/overview/#artifacts) uploads every file in
  `implementation/showcase/` except `showcase.toml` to the backend store when
  the run finishes. The description text rides the record itself, but an image
  the description references must be served per run even when the carousel does
  not list it, which is why the upload takes the directory rather than the
  carousel.
- The backend and the [artifact service](/components/artifacts/overview/#routes)
  serve each stored file at `GET /runs/{id}/showcase/{file}`.
- The [public snapshot](/components/backend/snapshot/#run-media) publishes each
  stored file under `media/runs/<run-id>/showcase/<file>` and names it on the
  per-run document as `showcaseMedia`. The builder derives the file set from
  the store listing and from the record itself: the carousel entries plus the
  image references extracted from the description. A name the ephemeral store
  no longer holds is fetched through the artifact service, so a
  description-only image survives a store loss the same way a carousel entry
  does.

## Rendering

On the consoles and the public gallery, a playable run's detail page lands on
its Play tab, and the tab renders the showcase when the record carries one: the
description with its image references resolved to the served files, and the
carousel with a viewer per kind. Its replays play in the same scrubbing player
as validation replays. A record with no showcase renders the plain playable
embed.
