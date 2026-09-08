---
title: Publishing an Audio Sample Pack
---

## Overview

The `sfx-sample` tool mixes over a sample library and the `music` tool plays an
instrument bank. A test case declares the packs it draws from in `[audio] packs`,
and a run container is given those packs, staged into `/opt/audio` when the
container starts.

This guide covers the whole operator path: ingesting a clip into the Test
Cabinet object store, authoring a pack around it, publishing the normalized bytes
the pack needs, and publishing the audio store a run stages out of. For the
commands alone, use the
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
store, so staging resolves and verifies against it and fails fast on anything
missing instead of hitting a 404 part-way through.

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
radius. R2 charges no egress, so the fetch is free.

### The two token roles

Each half uses its own bucket-scoped credential pair, so a read-only key can
live on CI and dev machines while the writer stays local:

- PUBLISH (read and write) uploads source and normalized objects. It is used by
  a local developer only.
- PRESIGN (read only) mints the short-lived download URLs that stage the audio
  store. It lives on CI and on dev machines.

A presigned URL moves the credential to staging time, since something has to sign
the URL, and keeps every credential out of the published store.

### One-time setup

1. Create a private R2 bucket, for example `test-cabinet-audio`, with public
   access off.
2. Create two R2 API tokens scoped to that bucket: one Object Read and Write for
   publishing, one Object Read-only for presigning. Cloudflare shows each token
   an Access Key ID and a Secret Access Key for the S3 API. The SigV4 flow uses
   that pair rather than the single opaque token value.

Read these from repo-root `.env` locally and from GitHub secrets and variables
in CI.

| Variable                                                           | Role                                        | Where                        |
| ------------------------------------------------------------------ | ------------------------------------------- | ---------------------------- |
| `CLOUDFLARE_AUDIO_R2_S3_URL`                                       | the S3 endpoint                             | every step                   |
| `CLOUDFLARE_ACCOUNT_ID`                                            | derives that endpoint when the URL is unset | every step                   |
| `CLOUDFLARE_AUDIO_R2_BUCKET`                                       | the private bucket name                     | every step                   |
| `CLOUDFLARE_AUDIO_R2_PUBLISH_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | write                                       | ingest + publish, local only |
| `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | read                                        | store staging, local + CI    |
| `FREESOUND_API_KEY`                                                | Freesound search and fetch                  | ingest only                  |

Publishing needs `ffmpeg` on `PATH` to normalize, and curating a bank uses it to
detect pitch. Staging the store needs neither `ffmpeg` nor a Freesound key.

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

The `Build containers` workflow presigns read-only downloads of the objects the
audio-store image carries. Add, under the repository's Settings, Secrets and
variables, Actions:

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
alongside every clip that succeeded. Once it has run, the object store holds
every pinned source, and publishing a pack and staging the audio store read from
there.

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

Those three files are what let CI and another machine stage the store. The
registry says what a clip is, the manifest says how a pack presents it, and the
lock says which bytes exist and what they hash to.

## Publishing the store a run stages out of

Every published pack lives in the audio store, and a run container is given the
subset its test case declares. `scripts/stage-audio-store.mjs` materializes that
store under `dist/audio-store/tree`:

```
objects.lock.json                     the published objects, copied in as-is
clips/<clip-id>.<profile-id>.wav      shared across packs, deduped
packs/<name>@<version>/pack.toml      loader manifest
```

Each `pack.toml` entry points at its shared clip file, so a clip two packs use is
downloaded once. Every object is fetched through a presigned GET and verified
against `objects.lock.json` before it lands. A missing lock entry, a failed
presign, or a digest mismatch is a hard error, and there is no path from staging
to Freesound.

The lock is copied into the store beside the tree it describes, so the same check
runs wherever the store ends up. [Staging a
run](/components/core/execution/#staged-audio) verifies every clip it copies into
a container against it.

`./containers/build.sh audio-store`, and the `Build containers` CI workflow, run
the stager and build the data-only `audio-store` image over its output. Run the
stager on its own to materialize the tree without building.

```sh
node scripts/stage-audio-store.mjs                 # every published pack
node scripts/stage-audio-store.mjs gm-lite@0.1.0   # only the refs you name

PUSH=1 IMAGE_REGISTRY=ghcr.io/theclockwyrks ./containers/build.sh audio-store
```

The `audio-store` image is what carries the store to a machine with no checkout
and no credentials. The driver image copies it in at `/opt/tcab-audio`, and a
local checkout fetches it with `scripts/fetch-audio-store.sh`, which pulls the
published image and extracts the tree. The `Build containers` CI workflow
publishes it on every push to `master`.

A newly published pack version is reachable by a run as soon as a test case names
it in `[audio] packs`. Run images are not rebuilt for it.

### Trying it before any image is pushed

Publishing the image is a release step, not a step between changing audio and
hearing it. Both consumers can take the bytes straight from the object store:

```sh
# a local stack: builds the store from this checkout and hands the driver
# image build that ref, pulling nothing
make -C deployments/local audio-store
make -C deployments/local local-rebuild

# a host-side `tcab run` / `tcab validate`
scripts/fetch-audio-store.sh --stage
```

Both need only the read-scoped `CLOUDFLARE_AUDIO_R2_PRESIGN` pair the stager
already uses, and both verify every clip against `objects.lock.json` exactly as
the published image's build does.

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
- An object is not published. The lock has no entry for a key staging needs,
  usually because the pack changed after the last publish. Run
  `node scripts/build-sample-pack.mjs <pack> --publish` and commit the updated
  `objects.lock.json`.
- A digest mismatch. Downloaded bytes do not hash to the value in the lock,
  which means the object in the bucket was replaced out of band. Re-publish the
  affected object, or re-ingest the clip if its source object is the one that
  differs. Staging never repairs this by refetching from Freesound.
- A failed presign or upload. Check the pair in `.env` matches the role for the
  step, and that the bucket name and account id are correct. The first
  `--publish` is the real end-to-end test of the write credentials.

## See also

- [Publish an Audio Sample Pack](/quickstarts/authoring/publish-an-audio-sample-pack/)
  is the terse command refresher.
- [The audio binaries](/testing/asset-generation/audio-binaries/) covers how the
  tools use the pack.
- [Authoring an Audio Test Case](/guides/authoring/authoring-an-audio-test-case/)
  names a published pack from a case's `[audio] packs`.
- [`containers/sample-packs/README.md`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/sample-packs/README.md)
  gives the registry, manifest and lock formats in full.
