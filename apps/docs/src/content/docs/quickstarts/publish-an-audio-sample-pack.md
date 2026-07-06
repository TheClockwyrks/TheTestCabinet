---
title: Publish an Audio Sample Pack
---

Build an [audio sample pack](/testing/asset-generation/audio-binaries/#the-sample-library)
(the fixed palette an `sfx-sample` run mixes over, or a `music` instrument bank) from its
committed manifest, upload it to the private R2 bucket, and pin it so the run-container
image bakes it in. The audio files are **not committed** to the repo — the manifest lists
each source's `url` + `sha256`, the pack is a content-addressed tarball, and the image
build pins it by digest.

For the full walkthrough and the *why* — the private bucket, the two token roles, and the
presign-at-build-time flow — see [Publishing an Audio Sample
Pack](/guides/publishing-an-audio-sample-pack/).

## Prerequisites

- A source checkout with a working Node toolchain, and **`ffmpeg` on `PATH`** (real
  normalization to PCM-16 WAV; without it the script writes an un-normalized skeleton and
  says so).
- `FREESOUND_API_KEY` in repo-root `.env` if the manifest sources from Freesound (needed
  only to *curate*; the build reproduces from cache without it).
- The R2 credentials in repo-root `.env` (the **PUBLISH** pair writes; the **PRESIGN** pair
  reads at build time). See the guide's
  [environment table](/guides/publishing-an-audio-sample-pack/#r2-environment).

## Build & publish a pack

```sh
# 1. Author / update the manifest. ANY content change is a NEW version (packs are
#    immutable): containers/sample-packs/<pack>.toml  (e.g. combat-core.toml)

# 2. Build + publish: fetch (cached by sha256), verify, normalize, tar, upload to R2,
#    and record the pin in containers/sample-packs/packs.lock.json.
node scripts/build-sample-pack.mjs combat-core --publish

# 3. Commit the pin so CI and other machines can build the image from this pack.
git add containers/sample-packs/packs.lock.json
```

Sources are cached by content hash under `dist/sample-packs/.cache/`, so a rebuild never
re-fetches a clip it already has. Omit `--publish` to build + print the digest without
uploading.

## Bake it into the image

`./containers/build.sh` (and the `Build containers` CI workflow) resolve the pin, mint a
short-lived presigned R2 URL, and pass it to the `sfx-sample` / `music` build — the
Dockerfile's `ADD --checksum` fetches and verifies the tarball. No build args to pass by
hand; no credential enters an image layer.

```sh
./containers/build.sh          # builds every run image, including sfx-sample from the pin
```

An audio image whose pack is **not pinned** fails the build (rather than silently
skipping), so a missing pin surfaces immediately.

## Verify

```sh
# The pin is present and well-formed.
node -e 'console.log(require("./containers/sample-packs/packs.lock.json")["combat-core@0.1.0"])'

# Optional: confirm the presigned URL resolves (needs the PRESIGN creds in .env).
node scripts/presign-sample-pack.mjs combat-core@0.1.0
```

## Next steps

- [Publishing an Audio Sample Pack](/guides/publishing-an-audio-sample-pack/) — the full
  guide, with the bucket/token setup, CI secrets, and the design reasoning.
- [Audio binaries](/testing/asset-generation/audio-binaries/) — how `sfx-sample` / `music`
  use the pack a run mixes over.
