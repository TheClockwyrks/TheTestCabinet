---
title: Publishing an Audio Sample Pack
---

## Overview

The `sfx-sample` tool mixes over a sample library and the `music` tool plays an
instrument bank. A run container is [isolated and
offline](/components/core/execution/), so that palette is baked into the
run-container image at build time and nothing is fetched at run time.

This guide turns a committed pack manifest into a published, pinned pack the
image builds against. For the commands alone, use the
[quickstart](/quickstarts/authoring/publish-an-audio-sample-pack/).

## Pack distribution

The audio files themselves live outside this repo. What
`containers/sample-packs/` holds is a per-pack manifest, `<pack>.toml`, listing
each entry's `name`, `tags`, `description`, permissive `license`, source `url`,
and `sha256`. The pack is a content-addressed tarball assembled from that
manifest, published to object storage, and pinned by digest in the image build.
Three pieces:

1. The manifest, committed, human-readable, and versioned. A source is fetched
   once, at curation time, by a developer.
2. The tarball, the normalized pack of `pack.toml` plus `<name>.wav`, living in
   a private [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket. It
   is fetched at image-build time.
3. The pin, `containers/sample-packs/packs.lock.json`, committed, mapping
   `<name>@<version>` to the tarball's bucket, key, and digest. This is the
   source of truth the image build reads.

### The pack bucket

The pack bucket is private and distinct from the backend's public
[snapshot](/components/backend/snapshot/) bucket. The snapshot bucket is
public-read, so the site fetches it anonymously at build time; the packs stay
private. R2's public access is a per-bucket switch, so the two need separate
buckets, and they have different writer identities and different blast radius.
R2 charges no egress, so the per-build fetch is free.

### The two token roles

Each half uses its own bucket-scoped credential pair, so a read-only key can
live on CI and dev machines while the writer stays local:

- PUBLISH (read and write) uploads a built tarball. It is used by a local
  developer only.
- PRESIGN (read only) mints the short-lived download URL the image build fetches
  the pack from. It lives on CI and on dev machines.

A presigned URL moves the credential to build time, since something has to sign
the URL, and keeps every credential out of the image. The URL is anonymous once
minted, so Docker's `ADD` fetches it with no secret in any layer.

## One-time setup

### The R2 bucket and tokens

1. Create a private R2 bucket, for example `test-cabinet-audio`, with public
   access off.
2. Create two R2 API tokens scoped to that bucket: one Object Read and Write for
   publishing, one Object Read-only for presigning. Cloudflare shows each token
   an Access Key ID and a Secret Access Key for the S3 API. The SigV4 flow uses
   that pair rather than the single opaque token value.

### R2 environment

Read from repo-root `.env` locally and from GitHub secrets and variables in CI.
The image build needs only the read-only PRESIGN pair.

| Variable | Role | Where |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | derives the S3 endpoint | publish + presign |
| `CLOUDFLARE_AUDIO_R2_BUCKET` | the private bucket name | publish + presign |
| `CLOUDFLARE_AUDIO_R2_PUBLISH_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | write | local publish only |
| `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | read | local + CI image build |

### GitHub secrets for CI

The `Build containers` workflow presigns a read-only download of the pack. Add,
under the repository's Settings, Secrets and variables, Actions:

- Secrets: `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID`,
  `CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY`.
- Variable: `CLOUDFLARE_AUDIO_R2_BUCKET`.

The publish credentials stay off CI.

## Authoring or updating a manifest

A manifest lives at `containers/sample-packs/<pack>.toml`. Each `[[sample]]`, or
`[[instrument]]` for a bank, needs a `name`, `tags`, `description`, a CC0 or
otherwise permissive `license`, a source `url`, and the source's `sha256`. NC
and ND licenses are rejected. The format and the on-disk layout the loader
expects are documented in
[`containers/sample-packs/README.md`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/sample-packs/README.md).

Two rules matter:

- Any content change is a new `version`. Packs are immutable and versioned with
  the image. The version is part of the pinned ref, such as `combat-core@0.1.0`,
  and part of the object key, so bumping it is what makes a new pack.
- `name`, `tags`, and `description` must be neutral and informational. The model
  browses the library by text alone, so describe what a clip is: its source,
  timbre, frequency, and decay. Composition reasoning is exactly what an
  `sfx-sample` case measures, so the metadata leaves it to the model.

Validate a manifest without touching the network:

```sh
node scripts/build-sample-pack.mjs <pack> --check
```

## Publishing

```sh
node scripts/build-sample-pack.mjs combat-core --publish
git add containers/sample-packs/packs.lock.json
```

The script:

1. Fetches each source, caching it by `sha256` under
   `dist/sample-packs/.cache/`, overridable with `TCAB_SAMPLE_SRC_CACHE`. The
   cache is keyed by content hash, so it can never serve stale bytes. Delete the
   cache directory to force a clean re-fetch.
2. Verifies each source against its declared `sha256`. A mismatch aborts.
3. Normalizes to PCM-16 WAV via `ffmpeg`, applying the manifest's sample rate,
   channels, loudness, and trim. Without `ffmpeg` it writes an un-normalized
   skeleton and says so.
4. Writes the loader-facing layout, tars it deterministically, and prints the
   digest.
5. Uploads the tarball to R2 at the versioned key
   `<name>/<version>/<name>-<version>.tar` and records the pin in
   `packs.lock.json`.

Commit `packs.lock.json`. That pin is what lets CI and other machines build the
pack. Omit `--publish` to build and print the digest without uploading.

Fetching from Freesound needs `FREESOUND_API_KEY` in the environment.

## Building the image

`./containers/build.sh`, and the `Build containers` CI workflow, build the
`sfx-sample` and `music` images by resolving each pack's pin, minting a
short-lived presigned R2 GET URL with `scripts/presign-sample-pack.mjs`, and
passing the pack ref, that URL, and the digest to the build. The Dockerfile's
`ADD --checksum` fetches and verifies the tarball and unpacks it to the path the
loader reads. There are no build args to pass by hand.

An audio image whose pack is not pinned, or whose presign fails, is a build
error rather than a silent skip, so a missing or broken pack surfaces
immediately.

Updating a palette is therefore a new pack version, a `--publish`, a committed
pin, and an image rebuild.

## Instrument banks

An instrument bank (`kind = "instrument-bank"`, entries under `[[instrument]]`)
is built and published exactly like a sample pack, with two extra per-entry
fields the `music` sequencer needs:

- `root_note`, the MIDI note the sample was recorded at. The sequencer
  pitch-shifts the one recorded note across a track's notes relative to this, so
  the sample may be at any pitch as long as `root_note` records it accurately.
- `pitched`, `true` for a melodic instrument that is transposed per note and
  `false` for percussion, which plays at its native pitch.

`scripts/curate-instrument-bank.mjs` assembles a bank: it searches Freesound
(CC0 only) for a representative note per instrument, downloads its preview, and
detects the recorded pitch by autocorrelation to fill `root_note`. Re-run it to
refresh or extend a bank, then publish as above:

```sh
# Search and detect, printing a table without writing:
node scripts/curate-instrument-bank.mjs --bank gm-lite --dry-run
# Write containers/sample-packs/gm-lite.toml, then publish it:
node scripts/curate-instrument-bank.mjs --bank gm-lite
node scripts/build-sample-pack.mjs gm-lite --publish
```

A bank entry is named by its instrument, such as `grand_piano` or `violin`,
because a `music` case measures composition rather than sample identification.

The `music` image bakes every instrument bank as a per-name subdirectory, and a
case's `instrument_bank` selects which one it plays. Adding a bank therefore
means extending the `BANKS` registry in `curate-instrument-bank.mjs`, curating
and publishing it, and adding its build args and per-name subdirectory to
`containers/music/Dockerfile` and `build_music_image` in
`containers/build.sh`.

## Troubleshooting

- `ffmpeg not found`: the pack builds un-normalized, as a raw skeleton copy.
  Install `ffmpeg` and rebuild for a real PCM-16 pack.
- `sha256 mismatch`: the source changed at its URL, or the manifest's hash is
  wrong. Re-curate the clip and update the manifest.
- A failed presign or upload: check the R2 credentials in `.env` for the right
  pair for the role, and that the bucket name and account id are correct. The
  first `--publish` is the real end-to-end test of the credentials.

## See also

- [Publish an Audio Sample Pack](/quickstarts/authoring/publish-an-audio-sample-pack/)
  is the terse command refresher.
- [The audio binaries](/testing/asset-generation/audio-binaries/) covers how the
  tools use the pack.
- [`containers/sample-packs/README.md`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/sample-packs/README.md)
  gives the manifest format and on-disk layout in full.
