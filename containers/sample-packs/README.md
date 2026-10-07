# Sample packs & instrument banks

This directory holds the committed audio metadata for the palettes the
[`sfx-sample`](../../apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md)
tool mixes over (its sample library) and the `music` tool plays (its instrument bank).
Three kinds of file live here: `clips.toml`, the registry of every audio clip The Test
Cabinet has ingested; one `<pack>.toml` per pack, naming the clips that pack exposes and
how it presents them; and `objects.lock.json`, recording which bytes have been published
to the object store.

No audio is committed here. Clip bytes live in a private
[Cloudflare R2](https://developers.cloudflare.com/r2/) bucket keyed by clip id, both as
the original source and as the normalized output of each pack's normalization profile.
`scripts/stage-audio-store.mjs` materializes every published pack into the audio store,
which ships as the data-only `test-cabinet-audio-store` image. A run container receives
the packs its test case declares in `[audio] packs`, staged into `/opt/audio` when the
container starts, and carries no other pack.

See the audio-store section of [`containers/README.md`](../README.md#the-audio-store)
and the [audio-binaries doc](../../apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md#the-sample-library).

## Clips

A clip is one audio source. Its identity is the sha256 of the original source bytes in
lowercase hex, and that id is the only name anything else uses to refer to it. Two packs
that use the same source share one clip, one stored object, and one normalized output per
profile they share.

`clips.toml` records the intrinsic facts about each clip and nothing about how a pack
presents it:

```toml
[[clip]]
id = "77193cc902f2f8c610b43818e73356dfe39548075fd96662d92d0a57721d518c"
license = "CC0-1.0"         # must be CC0 or otherwise permissive; NC/ND is rejected
source_url = "https://cdn.freesound.org/previews/68/68447_871124-hq.ogg"
freesound_id = 68447        # optional, provenance
root_note = 68              # optional, the MIDI note the clip was recorded at
```

`source_url` and `freesound_id` are provenance for a clip already ingested; nothing reads
them to fetch bytes. `root_note` is the detected recorded pitch, so a pack that plays the
clip melodically transposes relative to it.

Presentation belongs to the pack, not the registry. The same clip is `trombone` in one
bank and `low_brass` in another, with different tags and a different description, and the
registry is silent on all of it.

## Pack manifests

A pack is a named, versioned collection of clip ids plus the presentation and
normalization that pack applies:

```toml
name = "gm-lite"           # pack name (part of the pinned ref `name@version`)
version = "0.1.0"          # bump for any content change — packs are immutable
kind = "instrument-bank"   # or "sample-pack"

[normalize]                # applied to every clip this pack exposes
sample_rate = 44100
channels = 2               # 1 (mono) or 2 (stereo)
loudness_lufs = -20.0
true_peak_dbfs = -1.0
trim_silence = true
max_duration_ms = 5000     # clip ceiling is 5000ms

[[entry]]
clip = "77193cc902f2f8c610b43818e73356dfe39548075fd96662d92d0a57721d518c"
name = "grand_piano"       # the name the model addresses with `list-samples` / a track
tags = ["keys", "piano"]
description = "…"          # neutral + informational only (see below)
pitched = true             # optional, default true; false = played at native pitch
root_note = 60             # optional override of the registry's detected pitch
```

An entry carries no `url` and no `sha256`. Those are properties of the clip, and every
entry's `clip` must resolve to an id in `clips.toml`.

## The object store

The private bucket holds two key shapes:

- `sources/<clip-id>` — the original bytes, uploaded once when the clip is ingested.
- `normalized/<clip-id>/<profile-id>.wav` — the result of running one `[normalize]`
  profile over that clip.

`profile-id` is the first 16 hex characters of the sha256 over the canonical profile
encoding `sample_rate|channels|loudness_lufs|true_peak_dbfs|trim_silence|max_duration_ms`.
Two packs sharing a clip and a profile therefore share one normalized object, and a
profile change produces a new one without disturbing the old.

Publishing the normalized bytes once is what makes a pack reproducible. Every later
consumer downloads a finished `.wav` rather than re-deriving it, so every machine stages
byte-identical audio and the result no longer depends on the local `ffmpeg` build's
loudness normalization.

## `objects.lock.json`

`objects.lock.json` records what has actually been published, keyed by object key:

```json
{
  "sources/77193cc9…": {
    "bucket": "test-cabinet-audio",
    "sha256": "77193cc9…",
    "bytes": 12345
  },
  "normalized/77193cc9…/3f1a20c8b4d95e07.wav": {
    "bucket": "test-cabinet-audio",
    "sha256": "9be1…",
    "bytes": 6789
  }
}
```

Staging resolves every object it needs through this file and verifies each download
against the recorded digest and size. A missing lock entry fails staging immediately
with the clip id and the command that publishes it, rather than surfacing as a 404 partway
through a staging run. Commit the lock alongside the manifest change that needs it; it is
the pin CI and other machines stage from.

## The Freesound boundary

Freesound is contacted only by the ingest step, only by a developer, and only once per
clip. Ingest fetches the source, verifies its digest, uploads `sources/<clip-id>`, records
the lock entry, and writes the `clips.toml` entry. This is a requirement of the design:
every other path — normalization, publishing, store staging, CI — reads clip bytes from
The Test Cabinet's own store by clip id, and no staging path can reach freesound.org. A pack
naming a clip that has not been published is an error instructing the developer to run
ingest.

## Sourcing from Freesound

Clips are sourced from [Freesound](https://freesound.org) filtered to the CC0 license.
Freesound gates access in two tiers: a free API key (token) allows search, metadata, and
the preview transcodes at `cdn.freesound.org/previews/…-hq.ogg`, while OAuth2 (an
interactive per-user grant) is required for the pristine original files. Ingest stays in
the token tier and records a preview URL as `source_url`. Every clip is normalized to the
pack's profile anyway, so a preview transcode is indistinguishable from the original for a
short one-shot. CC0 governs reuse rights rather than access, so the token is orthogonal to
the license.

`FREESOUND_API_KEY` is sent as a `Token` header when ingest fetches a `*.freesound.org`
URL. Set it before ingesting:

```sh
export FREESOUND_API_KEY=<your key from https://freesound.org/apiv2/apply>
```

Because Freesound serves per-file previews rather than bundles, one fetch yields one clip
and no archive-extraction step exists. `freesound_id` is kept for traceability even though
CC0 waives attribution.

## `name` / `tags` / `description` must be neutral

The model browses the library through the `name`, `tags`, and `description` alone (it
cannot audition audio), so these must convey what each clip is — its source, timbre,
frequency character, and duration or decay. They must not give usage, layering, timing,
pitching, or role guidance. Describe the sound, not what to do with it: "a dry, deep
sub-bass rumble with a soft onset and no sharp transient", not "the low body under an
explosion; layer beneath a sharper crack and pitch to size the blast". Whether and how to
combine clips is exactly the composition skill an `sfx-sample` case measures, so prefer
neutral classifiers (`metal`, `impact`, `sub-bass`, `sustained`) over role labels (`body`,
`tail`, `glue`, `sweetener`).

## Curating and publishing

Ingest and publish are developer-local steps; CI only reads. Both halves need the
repo-root `.env`.

1. Ingest each new clip. `scripts/curate-instrument-bank.mjs` searches Freesound for a
   bank, detects each melodic clip's `root_note`, uploads `sources/<clip-id>`, and appends
   to `clips.toml` and `objects.lock.json`. `node scripts/curate-instrument-bank.mjs --ingest
<source-url>` does the same for one clip, printing the id to reference from a pack.
2. Author or update the pack manifest here, referencing clip ids. Any content change is a
   new `version`; packs are immutable.
3. Publish the normalized objects: `node scripts/build-sample-pack.mjs <pack> --publish`
   downloads each clip's source, normalizes it to the pack's profile, uploads
   `normalized/<clip-id>/<profile-id>.wav`, and updates `objects.lock.json`. This step
   needs `ffmpeg` on `PATH`; it is the only step that does.
4. Commit `clips.toml`, the pack manifest, and `objects.lock.json` together.

### Seeding sources from the registry

`node scripts/curate-instrument-bank.mjs --seed-sources --publish` uploads
`sources/<clip-id>` for every clip in `clips.toml` that `objects.lock.json` does not yet
record. The registry is the work list rather than a Freesound search, so the clips each
pack references stay exactly as they are: for each clip the mode fetches the recorded
`source_url`, verifies the bytes hash to that clip id, uploads the object, and records
it in the lock. A clip the lock already records is skipped and fetched bytes are cached
by clip id, so an interrupted run resumes where it stopped, and `--force` re-fetches and
re-uploads regardless. Omitting `--publish` fetches and verifies every clip and reports
the uploads it would make, which needs no credentials.

A clip whose source fails to fetch, or whose bytes hash to a different value, is an
error naming the clip id and its `source_url`. The run continues through the remaining
clips and exits non-zero with a summary, so one dead source is reported alongside every
clip that succeeded. This is the one-time bootstrap for a store that does not yet hold
the pinned clips; afterwards pack publishing and store staging read the object store.

`scripts/stage-audio-store.mjs` then presigns and downloads the already-normalized
objects and materializes the audio store the `test-cabinet-audio-store` image publishes.
No credential enters an image layer. A published pack becomes reachable by a run as soon
as a test case names it in `[audio] packs`; no run image is rebuilt.

## R2 environment

Read from repo-root `.env` locally, and from GitHub secrets and variables in CI. The two
credential pairs separate the roles: a developer's write pair publishes, and a read-only
pair presigns the downloads that stage the audio store. The container-build workflow needs
only the presign pair, and only for the `audio-store` image.

| Variable                                                           | Role                                        | Where                          |
| ------------------------------------------------------------------ | ------------------------------------------- | ------------------------------ |
| `CLOUDFLARE_AUDIO_R2_S3_URL`                                       | the S3 endpoint                             | publish + presign              |
| `CLOUDFLARE_ACCOUNT_ID`                                            | derives that endpoint when the URL is unset | publish + presign              |
| `CLOUDFLARE_AUDIO_R2_BUCKET`                                       | the private bucket                          | publish + presign              |
| `CLOUDFLARE_AUDIO_R2_PUBLISH_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | write                                       | local ingest + publish only    |
| `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | read                                        | local + CI audio-store staging |

## On-disk layout the loader expects

`crates/audio-core/src/sample.rs` (`load_pack`) reads a pack directory holding a
`pack.toml` manifest: a `sample_rate` plus one entry per sample, each with `name`, `tags`,
`duration_ms`, `description`, and a `file` path resolved relative to the pack directory.
Audio sits in a shared clip directory beside the packs, so an entry's `file` points out of
its own pack:

```
clips/<clip-id>.<profile-id>.wav          shared across packs, written once
packs/<name>@<version>/pack.toml          file = "../../clips/<clip-id>.<profile-id>.wav"
```

The audio store and a run container share this one layout, so the same relative `file`
resolves in both and a fetched store is directly loadable on the host. Every file a
manifest names must exist and decode as PCM-16 WAV at load time. Loading a named pack
whose directory is missing, unparseable, or empty is an error, so a run is never served an
empty or partial palette.

The store carries `objects.lock.json` beside that tree. Staging a run's declared packs
checks every clip it copies into the container against the published digest and byte
length, so the bytes are verified again on the machine that runs the case. A run container
holds only the packs its case declares and carries no lock of its own.

## Packs in this directory

- `combat-core.toml` — the combat-SFX sample pack for `sfx-sample`
  (`kind = "sample-pack"`, mono). Its entries are elemental layers rather than finished
  effects: a sub-bass body, a dry metal impact, a debris tail, a mechanical reload click,
  an air whoosh, an electric arc, a diesel idle. A single clip is never the briefed sound,
  so the model must select, layer, time, pitch, and process several (plus synth glue) into
  a specific weapon, vehicle, or explosion. That composition is what the case measures,
  which is why the palette carries no ready-made gunshots or explosions.
- `gm-lite.toml` — the general-MIDI-flavoured instrument bank for `music`
  (`kind = "instrument-bank"`, stereo). Each melodic entry inherits or overrides a
  `root_note` so the sequencer pitch-shifts it correctly across a track's notes;
  percussion entries are `pitched = false`. A bank entry is named by its instrument
  (`grand_piano`, `violin`), because a `music` case measures composition rather than
  identification.
- `cinematic.toml` — an epic-orchestral instrument bank for `music`: sectioned strings
  (tremolo, pizzicato), french horns and low brass, mixed choir (`choir_aah` /
  `choir_ooh`), oboe and flute, celesta and harp, and orchestral percussion (taiko, bass
  drum, cymbal).
- `synthwave.toml` — a synthwave and electronic instrument bank for `music`: analog leads
  and basses, pads, FM bells, synth brass and strings, and an electronic drum machine
  (`kick_808`, electronic snare and clap, hats, tom).

A test case names the packs it draws from in `[audio] packs`, and its run container carries
those and nothing else. To add a bank, extend the `BANKS` registry in
[`scripts/curate-instrument-bank.mjs`](../../scripts/curate-instrument-bank.mjs), ingest
and publish it, then name it from a test case.
