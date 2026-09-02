---
title: Publish an Audio Sample Pack
---

## Overview

Assemble the fixed palette an `sfx-sample` run mixes over or the instrument bank
a `music` run plays. A clip is ingested into the Test Cabinet object store once,
a pack manifest collects clip ids and gives each one this pack's presentation, a
publish uploads the normalized bytes that pack's profile needs, and the image
build stages the objects it bakes.
[Publishing an Audio Sample Pack](/guides/authoring/publishing-an-audio-sample-pack/)
is the full walkthrough, including the bucket, token and Freesound setup.

## Prerequisites

- A source checkout with a working Node toolchain, and `ffmpeg` on `PATH` to
  normalize at publish time and to detect pitch when curating a bank.
- The R2 credentials in the repo-root `.env`. Ingest and publish use the write
  pair, the image build uses the read-only presign pair, and both need
  `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AUDIO_R2_BUCKET`. The guide's
  [environment table](/guides/authoring/publishing-an-audio-sample-pack/#one-time-setup)
  lists them.
- `FREESOUND_API_KEY` in the repo-root `.env` for ingest. No other step contacts
  Freesound.

## Ingest a clip

```sh
# Fetch, verify, upload sources/<clip-id>, and record the clip in clips.toml.
node scripts/curate-instrument-bank.mjs --ingest <freesound-url> --publish

# Or curate a whole instrument bank: CC0 search, pitch detection, ingest.
node scripts/curate-instrument-bank.mjs --bank gm-lite
```

A clip's id is the sha256 of its original bytes. Ingest runs once per clip; a
clip already in `containers/sample-packs/clips.toml` is left alone.

## Author the pack and publish its objects

Add or edit `[[entry]]` blocks in `containers/sample-packs/<pack>.toml`, each
naming a `clip` id plus this pack's `name`, `tags` and `description`. Bump
`version`, since a test case pins a palette as `name@version`.

```sh
# Parse and validate the manifest, its clip ids and its lock coverage offline.
node scripts/build-sample-pack.mjs gm-lite --check

# Normalize and upload only what is missing, recording objects.lock.json.
node scripts/build-sample-pack.mjs gm-lite --publish

# Commit the registry, the manifest, and the lock.
git add containers/sample-packs/clips.toml \
        containers/sample-packs/gm-lite.toml \
        containers/sample-packs/objects.lock.json
```

Publishing is per clip and per normalize profile, so editing one entry uploads
one object and leaves the rest of the pack untouched.

## Bake it into the image

`./containers/build.sh` and the `Build containers` CI workflow run
`scripts/stage-audio-image.mjs`, which downloads each object through a presigned
GET, verifies it against `objects.lock.json`, and lays out a shared clip tree the
Dockerfile copies to `/opt/audio`. A missing lock entry, a failed presign, or a
digest mismatch fails the build, and a build never contacts Freesound.

```sh
./containers/build.sh                     # every run image
./containers/build.sh sfx-sample music    # only the audio images
```

## Verify

```sh
cat containers/sample-packs/objects.lock.json
node scripts/stage-audio-image.mjs gm-lite@0.1.0
```

The lock lists every published key with its bucket, digest and size. The stager
materializes the tree an image bakes under `dist/audio-image/<hash>/`, and needs
the presign credentials in `.env`.

## Next steps

- [Author an Audio Test Case](/quickstarts/authoring/author-an-audio-test-case/)
  names a published pack through `[audio]`.
- [Audio binaries](/testing/asset-generation/audio-binaries/) describes how
  `sfx-sample` and `music` use the palette a run draws from.
