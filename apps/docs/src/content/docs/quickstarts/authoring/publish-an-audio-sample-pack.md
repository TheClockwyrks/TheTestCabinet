---
title: Publish an Audio Sample Pack
---

## Overview

Build an audio sample pack, the fixed palette an `sfx-sample` run mixes over or
the instrument bank a `music` run plays, from its committed manifest, upload it
to the private R2 bucket, and pin it so the run-container image bakes it in. The
audio files live outside this repo: the manifest lists each source's `url` and
`sha256`, the pack is a content-addressed tarball, and the image build pins it by
digest.
[Publishing an Audio Sample Pack](/guides/authoring/publishing-an-audio-sample-pack/)
is the full walkthrough, including the bucket and token setup.

## Prerequisites

- A source checkout with a working Node toolchain and `ffmpeg` on `PATH`.
  `ffmpeg` performs the normalization to PCM-16 WAV; without it the script writes
  an un-normalized skeleton and reports that it did so.
- `FREESOUND_API_KEY` in the repo-root `.env` when the manifest sources from
  Freesound. It is needed to curate; a rebuild reproduces from the cache without
  it.
- The R2 credentials in the repo-root `.env`. The publish pair writes and the
  presign pair reads at build time, listed in the guide's
  [environment table](/guides/authoring/publishing-an-audio-sample-pack/#r2-environment).

## Build and publish a pack

Author or update the manifest at `containers/sample-packs/<pack>.toml`. Packs are
immutable, so any content change is a new version.

```sh
# Parse and validate the manifest without touching the network.
node scripts/build-sample-pack.mjs combat-core --check

# Fetch (cached by sha256), verify, normalize, tar, upload to R2, and record the
# pin in containers/sample-packs/packs.lock.json.
node scripts/build-sample-pack.mjs combat-core --publish

# Commit the pin so CI and other machines build the image from this pack.
git add containers/sample-packs/packs.lock.json
```

Sources are cached by content hash under `dist/sample-packs/.cache/`, so a
rebuild reuses a clip it already has. Omitting `--publish` builds the pack and
prints its digest locally.

## Bake it into the image

`./containers/build.sh` and the `Build containers` CI workflow resolve the pin,
mint a short-lived presigned R2 URL, and pass it to the image build, where
`ADD --checksum` fetches and verifies the tarball. No build argument is passed by
hand and no credential enters an image layer. A missing pin or a failed presign
fails the build.

```sh
./containers/build.sh                     # every run image
./containers/build.sh sfx-sample music    # only the audio images
```

## Verify

```sh
cat containers/sample-packs/packs.lock.json
node scripts/presign-sample-pack.mjs combat-core@0.1.0
```

The lock file lists each published pack's bucket, object key and digest. The
presign command resolves a pinned pack to a download URL and its digest, and
needs the presign credentials in `.env`.

## Next steps

- [Author an Audio Test Case](/quickstarts/authoring/author-an-audio-test-case/)
  names a published pack through `[audio]`.
- [Audio binaries](/testing/asset-generation/audio-binaries/) describes how
  `sfx-sample` and `music` use the palette a run draws from.
