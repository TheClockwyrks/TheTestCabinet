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
- **`sfx-core.toml`** — an EXAMPLE general-purpose game-SFX sample pack for
  `sfx-sample` (`kind = "sample-pack"`, mono), kept as a format reference.
- **`gm-lite.toml`** — an EXAMPLE general-MIDI-flavoured instrument bank for `music`
  (`kind = "instrument-bank"`, stereo, entries under `[[instrument]]`).

The two EXAMPLE manifests ship **placeholder `url`/`sha256` values** and must have real
CC0 / permissively-licensed sources dropped in before a real build (they parse and
validate as-is, so `--check` works; a real fetch fails on the placeholders by design).

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

## Building a pack (pin-by-digest + rebuild flow)

1. **Author / update the manifest** here. Any content change is a **new `version`** —
   packs are immutable and versioned with the image; never edit a baked pack in place.
2. **Build the pack** (needs `ffmpeg` on `PATH` for real normalization; without it the
   script still produces the layout + a stable digest but writes an un-normalized
   skeleton copy and says so):

   ```sh
   node scripts/build-sample-pack.mjs sfx-core
   ```

   It fetches each `url`, **verifies each `sha256`**, normalizes to PCM-16 `.wav`,
   writes the loader-facing layout (`pack.toml` + `<name>.wav` beside it — exactly what
   `crates/audio-core/src/sample.rs` reads), tars it deterministically, and prints:

   ```
   pack digest: sha256:<digest>
   ```

3. **Publish** the resulting `dist/sample-packs/<name>-<version>.tar` to the object
   store / registry.
4. **Pin it in the image build.** The `sfx-sample` and `music` Dockerfiles take the
   pack ref, its digest, and its URL as build args and pin by digest:

   ```sh
   docker build -f containers/sfx-sample/Dockerfile \
     --build-arg SAMPLE_PACK=sfx-core@0.1.0 \
     --build-arg SAMPLE_PACK_SHA256=sha256:<digest> \
     --build-arg SAMPLE_PACK_URL=<url of sfx-core-0.1.0.tar> .
   ```

   The Dockerfile fetches the tarball with the digest as an integrity check
   (`ADD --checksum`), unpacks it to the path the loader expects, and points the binary
   at it. Updating the palette is therefore a **new pack version + an image rebuild**.

## On-disk layout the loader expects

`crates/audio-core/src/sample.rs` (`load_pack`) reads, from the baked pack directory:

- the **first `*.toml`** as the manifest — `sample_rate` plus `[[sample]]` entries
  (`name`, `tags`, `duration_ms`, `description`, optional `file` defaulting to
  `<name>.wav`); and
- each sample's audio at `<file>` beside it, decoded as **PCM-16 WAV**.

`build-sample-pack.mjs` writes exactly this (`pack.toml` + `<name>.wav`). The loader
**degrades gracefully**: an absent/invalid pack directory yields an empty library, so a
run without a baked pack still works.
