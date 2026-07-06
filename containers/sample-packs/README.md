# Sample packs & instrument banks

This directory holds the **committed manifests** for the audio palettes the
[`sfx-sample`](../../apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md)
tool mixes over (its **sample library**) and the `music` tool plays (its
**instrument bank**). One `<pack>.toml` per pack.

The audio files themselves are **not committed to this repo**. A manifest lists, for
each entry, a stable `name`, `tags`, `description`, a permissive `license`, a source
`url`, and a `sha256` content hash. The pack is a **separately-versioned,
content-addressed artifact** (an object-storage tarball / OCI artifact) assembled from
the manifest by [`scripts/build-sample-pack.mjs`](../../scripts/build-sample-pack.mjs),
and the `sfx-sample` / `music` image build **pins a pack version by digest** and bakes
it in. Because a run container is [isolated and
offline](../../apps/docs/src/content/docs/components/core/execution.md), the palette
must be present in the image — nothing is fetched at run time.

See the sample-library sections of
[`containers/README.md`](../README.md#the-sample-library-and-instrument-bank) and the
[audio-binaries doc](../../apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md#the-sample-library).

## Manifests here

- **`combat-core.toml`** — the **real** combat-SFX sample pack for `sfx-sample`
  (`kind = "sample-pack"`, mono), sourced from **Freesound CC0** clips (see
  [Freesound sources](#freesound-sources) below). Its entries are deliberately
  **elemental** — a sub-bass body, a dry metal impact, a debris tail, a mechanical
  reload click, an air whoosh, an electric arc, a diesel idle — **layers, not finished
  effects**. A single clip is never the briefed sound; the model must select, layer,
  time, pitch, and process several (plus synth glue) into a specific weapon, vehicle,
  or explosion. That composition is what the case measures, so the palette must *not*
  ship ready-made gunshots/explosions (which would collapse the task to "place one
  clip"). Its `url`/`sha256` values are **real** — `node scripts/build-sample-pack.mjs
  combat-core` builds it (with `FREESOUND_API_KEY` set).
- **`gm-lite.toml`** — the **real** general-MIDI-flavoured instrument bank for `music`
  (`kind = "instrument-bank"`, stereo, entries under `[[instrument]]`), sourced from
  **Freesound CC0** single notes by
  [`scripts/curate-instrument-bank.mjs`](../../scripts/curate-instrument-bank.mjs). Each
  melodic entry records the MIDI note it was recorded at (`root_note`, detected by that
  script) so the sequencer pitch-shifts it correctly across a track's notes; percussion
  entries are `pitched = false` (played native). Unlike the elemental sfx library, a bank
  entry is **named by its instrument** (`grand_piano`, `violin`) — a `music` case measures
  composition, not identification, so a real instrument name is correct here.
- **`sfx-core.toml`** — an EXAMPLE general-purpose game-SFX sample pack for
  `sfx-sample` (`kind = "sample-pack"`, mono), kept as a format reference.

The `sfx-core` EXAMPLE manifest ships **placeholder `url`/`sha256` values** and must have
real CC0 / permissively-licensed sources dropped in before a real build (it parses and
validates as-is, so `--check` works; a real fetch fails on the placeholders by design).

## Freesound sources

`combat-core` sources its clips from [Freesound](https://freesound.org) filtered to the
**CC0** license. Freesound gates access in two tiers: a free **API key** (token) lets
you search, read metadata, and download the **preview** transcodes
(`cdn.freesound.org/previews/…-hq.ogg`), while **OAuth2** (an interactive per-user grant)
is required only for the pristine **original** files. We stay entirely in the token tier:
the pack normalizes every source to 44.1 kHz mono PCM-16 anyway, so an hq-ogg preview run
through that is indistinguishable from the original for a short SFX layer — and it needs
no OAuth2. (CC0 governs *reuse rights*, not *access*: the token is a HuggingFace-style
free-account gate, orthogonal to the license.)

So each `combat-core` entry's `url` is a preview-CDN URL and its `sha256` is that
preview's content hash. `build-sample-pack.mjs` sends `FREESOUND_API_KEY` (from the
environment) as a `Token` header when fetching a `*.freesound.org` URL — the preview CDN
currently serves those without auth once the URL is known, but the header is harmless and
future-proofs the fetch. Set it before a real build:

```sh
export FREESOUND_API_KEY=<your key from https://freesound.org/apiv2/apply>
node scripts/build-sample-pack.mjs combat-core
```

Because Freesound serves **per-file** previews (not bundles), the existing per-entry
`url` + `sha256` manifest schema fits directly — no archive-extraction step is needed.
Each entry also records a `freesound_id` for provenance (CC0 waives attribution; it is
kept for traceability). To add or refresh clips, curate CC0 sounds via the API, add
`[[sample]]` blocks, and rebuild (any content change is a new pack `version`).

## Manifest format

```toml
name = "sfx-core"          # pack name (part of the pinned ref `name@version`)
version = "0.1.0"          # bump for any content change — packs are immutable
kind = "sample-pack"       # or "instrument-bank"

[normalize]                # how every source is normalized into the baked pack
sample_rate = 44100
channels = 1               # 1 (mono) or 2 (stereo)
loudness_lufs = -23.0
true_peak_dbfs = -1.0
trim_silence = true
max_duration_ms = 5000     # clip ceiling is 5000ms

[[sample]]                 # or [[instrument]] — both are accepted and merged
name = "impact_wood_heavy" # the name the model addresses with `list-samples` / a track
tags = ["impact", "wood"]
description = "…"          # NEUTRAL + informational only (see below)
license = "CC0-1.0"        # MUST be CC0 or otherwise permissive (NC/ND is rejected)
url = "https://…"          # source download
sha256 = "…"               # 64-hex content hash, verified on fetch
# Instrument-bank only (ignored by sfx-sample); optional, shown with defaults:
root_note = 60             # the MIDI note the sample was recorded at (music transposes
                           #   relative to it — the sample may be at ANY accurate pitch)
pitched = true             # false = percussion: played at native pitch, never transposed
```

### `name` / `tags` / `description` must be neutral

The model browses the library through the `name`, `tags`, and `description` alone (it
cannot audition audio), so these must convey **what each clip is** — its source, timbre,
frequency character, and duration/decay. They must **not** give any usage, layering,
timing, pitching, or role guidance. Describe the sound, not what to do with it: *"a dry,
deep sub-bass rumble with a soft onset and no sharp transient"* — **not** *"the low body
under an explosion; layer beneath a sharper crack and pitch to size the blast."* Whether
and how to combine the clips is exactly the composition skill an `sfx-sample` case
measures; a description that hands the model that reasoning defeats the test (the same
reason a case brief does not tell a model how to structure its solution). Avoid
role-labelling tags (`body`, `tail`, `glue`, `sweetener`) for the same reason; prefer
neutral classifiers (`metal`, `impact`, `sub-bass`, `sustained`).

## Building & publishing a pack

The pack tarballs live in a **private [Cloudflare R2](https://developers.cloudflare.com/r2/)
bucket** (zero egress, not publicly listable) — separate from the backend's *public*
snapshot bucket, since these are private and written by a different principal. Freesound
(and any other source) is fetched **once**, by a developer, at curation time; nothing
downloads a source at image-build or run time. The flow has two halves:

### Publish (a developer, locally — CI never writes)

1. **Author / update the manifest** here. Any content change is a **new `version`** —
   packs are immutable and versioned with the image; never edit a baked pack in place.
2. **Build + publish** (needs `ffmpeg` on `PATH` for real normalization; without it the
   script still produces the layout + a stable digest but writes an un-normalized
   skeleton copy and says so):

   ```sh
   # FREESOUND_API_KEY + the CLOUDFLARE_AUDIO_R2_PUBLISH_* creds come from repo-root .env
   node scripts/build-sample-pack.mjs combat-core --publish
   ```

   It fetches each `url` (**caching each by `sha256`** under `dist/sample-packs/.cache/`
   so a rebuild never re-fetches a clip it already has), **verifies each `sha256`**,
   normalizes to PCM-16 `.wav`, writes the loader-facing layout (`pack.toml` +
   `<name>.wav` beside it — exactly what `crates/audio-core/src/sample.rs` reads), tars
   it deterministically, then **uploads the tarball to R2** and records its pin in
   [`packs.lock.json`](packs.lock.json):

   ```json
   { "combat-core@0.1.0": { "bucket": "test-cabinet-audio",
       "key": "combat-core/0.1.0/combat-core-0.1.0.tar", "sha256": "sha256:<digest>" } }
   ```

   (Omit `--publish` to build + print the digest without uploading — the manual-pin
   escape hatch.)
3. **Commit `packs.lock.json`.** That pin is the source of truth the image build reads;
   committing it is what lets CI and other machines build the pack.

### Build the image (local `./build.sh` and CI — read-only)

`containers/build.sh` builds the `sfx-sample`/`music` images by resolving the pack's pin,
**minting a short-lived presigned R2 GET URL** for it (via
`scripts/presign-sample-pack.mjs`, using the read-only `CLOUDFLARE_AUDIO_R2_PRESIGN_*`
creds), and passing the pack ref, that URL, and the digest as build args. The Dockerfile's
`ADD --checksum` fetches + verifies the tarball and unpacks it to the path the loader
expects — **no credential ever enters an image layer**, and there are no build args to
pass by hand. A pack that is not pinned (or that cannot be presigned) is a **build
error**, not a silent skip — an audio image is never shipped with an empty palette.
Updating a palette is therefore a **new pack version → `--publish` → commit the pin →
image rebuild**.

### R2 environment

Read from repo-root `.env` locally, and from GitHub secrets/vars in CI (the container
build workflow needs only the read-only PRESIGN pair):

| Variable | Role | Where |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | derives the S3 endpoint | publish + presign |
| `CLOUDFLARE_AUDIO_R2_BUCKET` | the private bucket | publish + presign |
| `CLOUDFLARE_AUDIO_R2_PUBLISH_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | **write** | local publish only |
| `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | **read** | local + CI image build |

## On-disk layout the loader expects

`crates/audio-core/src/sample.rs` (`load_pack`) reads, from the baked pack directory:

- the **first `*.toml`** as the manifest — `sample_rate` plus `[[sample]]` entries
  (`name`, `tags`, `duration_ms`, `description`, optional `file` defaulting to
  `<name>.wav`); and
- each sample's audio at `<file>` beside it, decoded as **PCM-16 WAV**.

`build-sample-pack.mjs` writes exactly this (`pack.toml` + `<name>.wav`). The loader
**degrades gracefully**: an absent/invalid pack directory yields an empty library, so a
run without a baked pack still works.
