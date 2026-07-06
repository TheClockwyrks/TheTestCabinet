---
title: Publishing an Audio Sample Pack
---

The [`sfx-sample`](/testing/asset-generation/audio-binaries/) tool mixes over a **sample
library** and the `music` tool plays an **instrument bank** — the fixed audio palette each
ships with, exactly as `draw` ships with its drawing logic. Because a run container is
[isolated and offline](/components/core/execution/), that palette must be **baked into the
run-container image at build time**; nothing is fetched at run time.

This guide covers turning a committed pack *manifest* into a published, pinned pack the
image builds against. If you just need the commands, use the
[quickstart](/quickstarts/publish-an-audio-sample-pack/).

## How it fits together

The audio files themselves are **not committed to the repo**. What lives in
`containers/sample-packs/` is a per-pack **manifest** (`<pack>.toml`) listing each entry's
`name`, `tags`, `description`, permissive `license`, source `url`, and `sha256`. The pack
is a **content-addressed tarball** assembled from the manifest, published to object
storage, and pinned by digest in the image build. So there are three moving pieces:

1. **The manifest** — committed, human-readable, versioned. A source is fetched **once**,
   at curation time, by a developer.
2. **The tarball** — the normalized pack (`pack.toml` + `<name>.wav`), living in a
   **private [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket**. Fetched only
   at *image-build* time, never per-run.
3. **The pin** — [`packs.lock.json`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/sample-packs/packs.lock.json),
   committed, mapping `<name>@<version>` to the tarball's bucket/key/digest. This is the
   source of truth the image build reads.

### Why a separate, private bucket

The pack bucket is **private** and **distinct from the backend's public
[snapshot](/components/backend/snapshot/) bucket**. The snapshot bucket is public-read (the
site fetches it anonymously at build time); the packs must stay private. Since R2's public
access is a per-bucket switch, they cannot share one bucket. They also have different
writer identities (the backend writes the snapshot; a developer publishes packs) and
different blast radius, so keeping them apart is deliberate. R2 has **zero egress fees**,
so the per-build fetch costs nothing.

### The two token roles

Each half uses its own bucket-scoped credential pair, so a read-only key can live on CI and
dev machines while the writer stays local:

- **PUBLISH** (read + write) — uploads a built tarball. **Local developer only**; CI never
  writes.
- **PRESIGN** (read only) — mints the short-lived download URL the image build fetches the
  pack from. Lives on CI *and* dev machines.

A presigned URL moves the credential to *build time* (something has to sign the URL); it
does not put a credential into the image. The URL itself is anonymous once minted, so
Docker's `ADD` fetches it with no secret in any layer.

## One-time setup

### The R2 bucket and tokens

1. Create a **private** R2 bucket (e.g. `test-cabinet-audio`) with public access **off**.
2. Create two R2 API tokens scoped to that bucket: one **Object Read & Write** (publish),
   one **Object Read-only** (presign). Cloudflare shows each token an **Access Key ID** and
   a **Secret Access Key** for the S3 API — the S3/SigV4 flow uses that *pair*, not the
   single opaque token value.

### R2 environment

Read from repo-root `.env` locally, and from GitHub secrets/variables in CI. The image
build needs only the read-only PRESIGN pair.

| Variable | Role | Where |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | derives the S3 endpoint | publish + presign |
| `CLOUDFLARE_AUDIO_R2_BUCKET` | the private bucket name | publish + presign |
| `CLOUDFLARE_AUDIO_R2_PUBLISH_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | **write** | local publish only |
| `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | **read** | local + CI image build |

### GitHub secrets for CI

The `Build containers` workflow presigns a read-only download of the pack. Add, under the
repository's **Settings → Secrets and variables → Actions**:

- **Secrets:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID`,
  `CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY`.
- **Variable:** `CLOUDFLARE_AUDIO_R2_BUCKET`.

The publish (write) credentials are **never** given to CI.

## Authoring or updating a manifest

A manifest lives at `containers/sample-packs/<pack>.toml`. Each `[[sample]]` (or
`[[instrument]]`) entry needs a `name`, `tags`, `description`, a **CC0 or otherwise
permissive** `license` (NC/ND is rejected), a source `url`, and the source's `sha256`. The
format and the on-disk layout the loader (`crates/audio-core/src/sample.rs`) expects are
documented in
[`containers/sample-packs/README.md`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/sample-packs/README.md).

Two rules matter:

- **Any content change is a new `version`.** Packs are immutable and versioned with the
  image; never edit a published pack in place. The version is part of the pinned ref
  (`combat-core@0.1.0`) and the object key, so bumping it is what makes a new pack.
- **`name` / `tags` / `description` must be neutral and informational.** The model browses
  the library by text alone (it cannot audition audio), so describe *what a clip is*
  (source, timbre, frequency, decay) — never how to use, layer, pitch, or combine it. That
  composition reasoning is exactly what an `sfx-sample` case measures. See the
  [README's rule](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/sample-packs/README.md#name--tags--description-must-be-neutral).

## Publishing

```sh
node scripts/build-sample-pack.mjs combat-core --publish
git add containers/sample-packs/packs.lock.json
```

The script:

1. **Fetches** each source, **caching it by `sha256`** under `dist/sample-packs/.cache/`
   (override with `TCAB_SAMPLE_SRC_CACHE`). A rebuild re-reads a cached clip instead of
   re-hitting Freesound; because the cache is keyed by content hash, it can never serve
   stale bytes. Delete the cache dir to force a clean re-fetch.
2. **Verifies** each source against its declared `sha256` (a mismatch aborts).
3. **Normalizes** to PCM-16 WAV via `ffmpeg` (sample rate, channels, loudness, trim). With
   no `ffmpeg` it writes an un-normalized skeleton and says so loudly.
4. Writes the loader-facing layout, **tars it deterministically**, and prints the digest.
5. **Uploads** the tarball to R2 at a versioned key
   (`<name>/<version>/<name>-<version>.tar`) and records the pin in `packs.lock.json`.

Then **commit `packs.lock.json`** — that pin is what lets CI and other machines build the
pack. (Omit `--publish` to build + print the digest without uploading, e.g. to pin by hand.)

## Building the image

`./containers/build.sh` (and the `Build containers` CI workflow) build the `sfx-sample` /
`music` images by resolving the pack's pin, minting a short-lived presigned R2 GET URL for
it (via `scripts/presign-sample-pack.mjs`), and passing the pack ref, that URL, and the
digest to the build. The Dockerfile's `ADD --checksum` fetches and verifies the tarball and
unpacks it to the path the loader reads. There are no build args to pass by hand.

An audio image whose pack is **not pinned** (or whose presign fails) is a **build error**,
not a silent skip — a missing or broken pack surfaces immediately rather than shipping an
image with an empty palette.

Updating a palette is therefore: **new pack version → `--publish` → commit the pin → image
rebuild.**

## The instrument bank (`music`) is deferred

Only the real `combat-core` sample pack (for `sfx-sample`) ships today. The example
`gm-lite` instrument bank and `sfx-core` pack carry **placeholder** sources and cannot be
published as-is; the `music` image is not built until a real, permissively-licensed
instrument bank is authored and published the same way. See the
[README's manifest notes](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/sample-packs/README.md#manifests-here).

## Troubleshooting

- **`ffmpeg not found`** — the pack builds but is un-normalized (a raw skeleton copy).
  Install `ffmpeg` and rebuild for a real PCM-16 pack.
- **`sha256 mismatch`** — the source changed at its URL, or the manifest's hash is wrong.
  Re-curate the clip and update the manifest.
- **presign / upload fails** — check the R2 credentials in `.env` (the right *pair* for the
  role) and that the bucket name and account id are correct. The first `--publish` is the
  real end-to-end test of the credentials.

## See also

- [Publish an Audio Sample Pack](/quickstarts/publish-an-audio-sample-pack/) — the terse
  command refresher.
- [Audio binaries](/testing/asset-generation/audio-binaries/) — how the tools use the pack.
- [`containers/sample-packs/README.md`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/sample-packs/README.md)
  — the manifest format and on-disk layout in full.
