---
title: Showcases
---

A showcase is a curated presentation of a game: a player-facing description plus
a short, ordered carousel of media. Two showcases exist, and they share one
on-disk format:

- The run showcase is the model's own presentation of the game it built. The
  model writes it into its repository during the run, and record assembly
  captures it onto the [run record](/components/core/run-records/#showcase).
- The case showcase is the authored presentation of a test-case variant,
  committed with the version and captured from the [reference
  implementation](/components/core/results/#reference-implementations).

## The showcase directory

Either showcase is a directory holding exactly three things, with no
subdirectories:

- `showcase.md`, the description: player-facing markdown in the style of a store
  page. It may reference images in the same directory by bare relative path
  (`![Title](title.png)`).
- `showcase.toml`, the carousel: repeated `[[media]]` tables, each naming a
  `file` in the directory itself and a short caption `name`. Table order is
  carousel order. Unknown keys are tolerated.
- The media files themselves, beside those two.

A media file's kind is inferred from its extension, by the same rule as a
declared proof:

| Extension  | Kind                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------- |
| `.png`     | `image`                                                                                  |
| `.json.gz` | `replay`: a gzipped engine draw-command [recording](/components/core/engines/#recording) |
| `.webm`    | `video`                                                                                  |

Replays are the preferred moving footage. The engine records them itself through
its recording bracket, and they are far smaller than video. Video is supported
through the whole pipeline but discouraged.

Shared bounds apply to both showcases: the description is capped at 64 KiB, the
carousel at 10 entries, and each media file at 25 MiB.

## The run showcase

The model writes a `showcase/` directory at the root of its repository. It is
instructed through the case's prompt and specs rather than declared by any
manifest key, so it is a convention over the produced tree and the same capture
applies to every test type that asks for one. A run whose tree holds no readable
showcase has none.

### Capture

At record-assembly time the showcase is read from the produced tree's `showcase/`
directory and written onto the record: the description text and the ordered media
entries, each with its file name, caption, and kind.

The showcase is model-written, so capture degrades leniently:

- A description over the cap is truncated on a character boundary with a
  truncation marker.
- Carousel entries beyond the cap are dropped with a warning.
- A media entry whose file is missing, or over the file cap, is dropped with a
  warning.
- A showcase that cannot be parsed records no showcase, with a warning.

A showcase problem never fails a run and never degrades its status.

### Serving and publishing

The showcase's bytes travel the same path as the run's proof, asset, and
validation media:

- The [driver](/components/driver/overview/#artifacts) uploads every file in
  `implementation/showcase/` except `showcase.toml` to the backend store when the
  run finishes. The upload takes the directory rather than the carousel because
  an image the description references must be served per run even when the
  carousel does not list it.
- The backend and the [artifact service](/components/artifacts/overview/#routes)
  serve each stored file at `GET /runs/{id}/showcase/{file}`.
- The [public snapshot](/components/backend/snapshot/#run-media) publishes each
  stored file under `media/runs/<run-id>/showcase/<file>` and names it on the
  per-run document as `showcaseMedia`. The builder derives the file set from the
  store listing and from the record itself, meaning the carousel entries plus the
  image references extracted from the description. A name the ephemeral store no
  longer holds is fetched through the artifact service, so a description-only
  image survives a store loss the same way a carousel entry does.

The consoles and the public gallery present a run's showcase when the record
carries one, with the description's image references resolved to the served
files.

## The case showcase

A test-case variant declares its showcase with one manifest key, a directory
relative to the version folder:

```toml
# variants/base.toml
showcase = "showcase/base"
```

The directory takes the shared format above. Its media is captured from the
variant's reference implementation, so like the reference implementation it is
authored answer-key material: it is never seeded into a run, and resolving it
costs a run nothing. A variant that omits the key has no showcase.

The media presents the case rather than proving properties of it. The leading
entry shows sustained, real play, with the case's mechanics arising inside that
play, and stills follow the play. What the media must show and how to capture it
are stated in [Authoring a Case
Showcase](/guides/authoring/authoring-a-case-showcase/).

### Validation

The case showcase is authored and committed rather than model-written, so every
problem hard-fails version resolution instead of degrading. Resolution requires:

- `showcase.md` present, non-empty, and within the description cap.
- `showcase.toml` parseable, with 1–10 `[[media]]` entries.
- Every entry's `file` a plain file name: no path separators and no `..`.
- Every named file present in the directory, within the file cap, and of a
  recognized media kind.

### Flow

The showcase travels the definition pipeline the way specs do:

- Ingest inlines the description into the stored manifest and records each media
  entry with the store-relative key its bytes live at inside the copied version
  tree.
- The backend serves each media file at
  `GET /test-cases/{slug}/versions/{version}/showcase/{variant}/{file}`. Only a
  file the variant's stored carousel lists resolves, and `showcase.toml` is never
  served.
- The resolved version carries each variant's `showcase`, meaning the description
  plus the carousel, and the catalog listing carries each case's showcase
  preview: the latest visible version's first variant, in manifest order, that
  declares one. See the [backend API](/components/backend/api/#get-test-cases).
- The [public snapshot](/components/backend/snapshot/#case-media) publishes each
  media file content-addressed under
  `media/cases/<slug>/<version>/showcase/<variant>/<digest>-<file>` and names it
  on the case document's variant. A `.webm` clip is transcoded to `.mp4` for
  universal playback, with the entry's `file` kept as authored, exactly as run
  media is.
