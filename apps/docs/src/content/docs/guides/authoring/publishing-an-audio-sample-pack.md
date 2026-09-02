---
title: Publishing an Audio Sample Pack
---

## Overview

The `sfx-sample` tool mixes over a sample library and the `music` tool plays an
instrument bank. A run container is [isolated and
offline](/components/core/execution/), so that palette is baked into the
run-container image at build time and nothing is fetched at run time.

This guide covers the whole operator path: ingesting a clip into the Test
Cabinet object store, authoring a pack around it, publishing the normalized
bytes the pack needs, and building the image that bakes them. For the commands
alone, use the
[quickstart](/quickstarts/authoring/publish-an-audio-sample-pack/).

## The pieces

Four artifacts carry a palette. Three are committed, and the fourth is a private
[Cloudflare R2](https://developers.cloudflare.com/r2/) bucket holding the audio
bytes themselves.

### The clip registry

`containers/sample-packs/clips.toml` records one entry per clip. A clip's `id`
is the lowercase-hex sha256 of its original source bytes, which is also its key
in the object store. The registry holds intrinsic facts only: `license`,
`source_url` and `freesound_id` for provenance, and the detected `root_note`
where a recorded pitch is known. Presentation belongs to a pack, so the same
clip can be `trombone` in one bank and `low_brass` in another.

### Pack manifests

A pack at `containers/sample-packs/<pack>.toml` is a `name`, a `version`, a
`kind` of `sample-pack` or `instrument-bank`, a `[normalize]` profile, and a
list of `[[entry]]` blocks. Each entry names a `clip` id and supplies that
pack's presentation: `name`, `tags`, `description`, and, for a bank, `pitched`
and an optional `root_note` override. A test case pins a palette as
`name@version`, so any change to a pack's entries or profile is a new version.

### The object store

The bucket holds two kinds of object:

- `sources/<clip-id>` — the original bytes, uploaded once at ingest.
- `normalized/<clip-id>/<profile-id>.wav` — the output of one `[normalize]`
  profile applied to one clip.

A `profile-id` is the first 16 hex characters of the sha256 over the canonical
encoding of the profile,
`sample_rate|channels|loudness_lufs|true_peak_dbfs|trim_silence|max_duration_ms`.
Two packs that normalize identically share one normalized object, and a profile
change is a new `profile-id` rather than an overwrite.

### The object lock

`containers/sample-packs/objects.lock.json` maps each published key to its
`bucket`, `sha256` and `bytes`. It is the record of what actually exists in the
store, so a build resolves and verifies against it and fails fast on anything
missing instead of hitting a 404 mid-run.

Because both object keys are derived from clip identity and the normalize
profile, publishing is incremental. Adding or swapping one entry in a pack
publishes exactly the objects that entry needs; every other clip is already in
the lock and is left alone.

## The bucket and credentials

### The audio bucket

The audio bucket is private and distinct from the backend's public
[snapshot](/components/backend/snapshot/) bucket. The snapshot bucket is
public-read, so the site fetches it anonymously at build time; the audio objects
stay private. R2's public access is a per-bucket switch, so the two need
separate buckets, and they have different writer identities and different blast
radius. R2 charges no egress, so the per-build fetch is free.

### The two token roles

Each half uses its own bucket-scoped credential pair, so a read-only key can
live on CI and dev machines while the writer stays local:

- PUBLISH (read and write) uploads source and normalized objects. It is used by
  a local developer only.
- PRESIGN (read only) mints the short-lived download URLs the image build
  fetches objects with. It lives on CI and on dev machines.

A presigned URL moves the credential to build time, since something has to sign
the URL, and keeps every credential out of the image.

### One-time setup

1. Create a private R2 bucket, for example `test-cabinet-audio`, with public
   access off.
2. Create two R2 API tokens scoped to that bucket: one Object Read and Write for
   publishing, one Object Read-only for presigning. Cloudflare shows each token
   an Access Key ID and a Secret Access Key for the S3 API. The SigV4 flow uses
   that pair rather than the single opaque token value.

Read these from repo-root `.env` locally and from GitHub secrets and variables
in CI.

| Variable                                                           | Role                       | Where                        |
| ------------------------------------------------------------------ | -------------------------- | ---------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`                                            | derives the S3 endpoint    | every step                   |
| `CLOUDFLARE_AUDIO_R2_BUCKET`                                       | the private bucket name    | every step                   |
| `CLOUDFLARE_AUDIO_R2_PUBLISH_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | write                      | ingest + publish, local only |
| `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | read                       | image build, local + CI      |
| `FREESOUND_API_KEY`                                                | Freesound search and fetch | ingest only                  |

Publishing needs `ffmpeg` on `PATH` to normalize, and curating a bank uses it to
detect pitch. The image build needs neither `ffmpeg` nor a Freesound key.

### Freesound access

Freesound gates access in two tiers. A free API key lets you search, read
metadata, and download the preview transcodes at
`cdn.freesound.org/previews/…-hq.ogg`, while OAuth2, an interactive per-user
grant, is required only for the pristine original files. Ingest stays in the
token tier: every clip is normalized to PCM-16 WAV anyway, so an hq-ogg preview
run through that profile is indistinguishable from the original for a short
layer. CC0 governs reuse rights rather than access, so the token is a free
account gate orthogonal to the license.

### GitHub secrets for CI

The `Build containers` workflow presigns read-only downloads of the objects an
image bakes. Add, under the repository's Settings, Secrets and variables,
Actions:

- Secrets: `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID`,
  `CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY`.
- Variable: `CLOUDFLARE_AUDIO_R2_BUCKET`.

The publish credentials stay off CI.

## Ingesting a clip

Ingest is the only step that contacts Freesound, and it runs once per clip.

```sh
# One clip named by URL, printing its clip id:
node scripts/curate-instrument-bank.mjs --ingest <freesound-url> --publish
# A whole bank of instruments, searched CC0-only and pitch-detected:
node scripts/curate-instrument-bank.mjs --bank gm-lite
# Every clip the registry already pins whose source object is missing:
node scripts/curate-instrument-bank.mjs --seed-sources --publish
```

Ingest fetches the source, hashes the bytes to derive the clip id, checks the
license is CC0 or otherwise permissive, uploads the original bytes to
`sources/<clip-id>`, and records the clip in `clips.toml` and its object in
`objects.lock.json`. A clip already in the registry is left as it is, so
re-running ingest for an existing sound is a no-op. `--dry-run` searches,
detects pitch, and prints a table without writing or uploading.

`--seed-sources` seeds a store that does not yet hold the clips `clips.toml`
pins. It reads the registry as its work list rather than searching, so the clips
each pack references stay exactly as they are: for every clip the lock does not
record, it fetches the recorded `source_url`, verifies the bytes hash to that
clip id, uploads `sources/<clip-id>`, and records the object. A clip the lock
already records is skipped and fetched bytes are cached by clip id, so an
interrupted run resumes where it stopped, and `--force` re-fetches and re-uploads
regardless. Omitting `--publish` fetches and verifies every clip and reports the
uploads it would make, which needs no credentials.

A clip whose source fails to fetch, or whose bytes hash to a different value, is
an error naming the clip id and its `source_url`. The run continues through the
remaining clips and exits non-zero with a summary, so one dead source is reported
alongside every clip that succeeded. Once it has run, the store holds every
pinned source, and publishing a pack and building an image read from there.

## Authoring or editing a pack manifest

A pack is a list of clip ids plus the presentation this pack gives them. Add an
`[[entry]]` for each clip in the palette, bump `version`, and keep two rules in
mind:

- `name`, `tags` and `description` must be neutral and informational for a
  sample pack. The model browses the library by text alone, so describe what a
  clip is: its source, timbre, frequency, and decay. Composition reasoning is
  what an `sfx-sample` case measures, so the metadata leaves it to the model.
- A bank entry is named by its instrument, such as `grand_piano` or `violin`,
  because a `music` case measures composition rather than sample
  identification.

Validate a manifest, its clip references and its lock coverage without touching
the network:

```sh
node scripts/build-sample-pack.mjs gm-lite --check
```

## Publishing the objects a pack needs

```sh
node scripts/build-sample-pack.mjs gm-lite --publish
```

The script resolves the pack's `[normalize]` profile to a `profile-id`, then for
each entry checks whether `normalized/<clip-id>/<profile-id>.wav` is already in
the lock. For anything missing it downloads `sources/<clip-id>` from the store,
verifies it against the clip id, normalizes it to PCM-16 WAV with `ffmpeg`,
uploads the result, and records the key, digest and size in
`objects.lock.json`. A clip that is not in `clips.toml`, or whose source object
is not in the lock, is an error naming the clip and the ingest command to run.

Editing one entry therefore publishes one object. Changing the `[normalize]`
profile publishes the whole pack under a new `profile-id`, leaving the previous
objects addressable by the packs that still use them.

## Committing

```sh
git add containers/sample-packs/clips.toml \
        containers/sample-packs/gm-lite.toml \
        containers/sample-packs/objects.lock.json
```

Those three files are what let CI and another machine build the image. The
registry says what a clip is, the manifest says how a pack presents it, and the
lock says which bytes exist and what they hash to.

## Building the image

`./containers/build.sh`, and the `Build containers` CI workflow, run
`scripts/stage-audio-image.mjs` with the pack refs an image bakes. The stager
materializes, under `dist/audio-image/<hash>/`, the tree the image copies to
`/opt/audio`:

```
audio/
  clips/<clip-id>.<profile-id>.wav     shared across packs, deduped
  packs/<pack-name>/pack.toml          loader manifest
```

Each `pack.toml` entry points at its shared clip file, so a clip two packs use
is downloaded and baked once. Every object is fetched through a presigned GET
and verified against `objects.lock.json` before it lands. A missing lock entry,
a failed presign, or a digest mismatch is a hard error, and there is no path
from a build to Freesound.

```sh
./containers/build.sh                     # every run image
./containers/build.sh sfx-sample music    # only the audio images
```

`sfx-sample` reads its palette from `/opt/audio/packs/combat-core`, and `music`
and `full-stack-2d` read `/opt/audio/packs`, selecting the subdirectory named by
a case's `instrument_bank`. Adding a bank means curating and publishing it, then
adding its ref to `containers/build.sh`.

## Instrument banks

An instrument bank (`kind = "instrument-bank"`) carries two extra per-entry
fields the `music` sequencer needs:

- `root_note`, the MIDI note the clip was recorded at. The sequencer
  pitch-shifts the one recorded note across a track's notes relative to this, so
  a clip may be at any pitch as long as `root_note` records it accurately. It
  defaults to the registry's value and may be overridden per pack.
- `pitched`, `true` for a melodic instrument that is transposed per note and
  `false` for percussion, which plays at its native pitch.

`scripts/curate-instrument-bank.mjs --bank <name>` fills both: it searches
Freesound for a representative note per instrument, ingests the clip, and
detects the recorded pitch by autocorrelation. Extend the `BANKS` registry in
that script to add a bank.

## Troubleshooting

- A clip is not in the registry. The pack names a `clip` id with no entry in
  `clips.toml`. Ingest the sound with
  `node scripts/curate-instrument-bank.mjs --ingest <url> --publish`, which writes
  the registry entry and uploads the source, then re-run the publish.
- An object is not published. The lock has no entry for a key the build needs,
  usually because the pack changed after the last publish. Run
  `node scripts/build-sample-pack.mjs <pack> --publish` and commit the updated
  `objects.lock.json`.
- A digest mismatch. Downloaded bytes do not hash to the value in the lock,
  which means the object in the bucket was replaced out of band. Re-publish the
  affected object, or re-ingest the clip if its source object is the one that
  differs. Neither the stager nor the build repairs this by refetching from
  Freesound.
- A failed presign or upload. Check the pair in `.env` matches the role for the
  step, and that the bucket name and account id are correct. The first
  `--publish` is the real end-to-end test of the write credentials.

## See also

- [Publish an Audio Sample Pack](/quickstarts/authoring/publish-an-audio-sample-pack/)
  is the terse command refresher.
- [The audio binaries](/testing/asset-generation/audio-binaries/) covers how the
  tools use the pack.
- [`containers/sample-packs/README.md`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/sample-packs/README.md)
  gives the registry, manifest and lock formats in full.
