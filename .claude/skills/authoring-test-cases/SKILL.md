---
name: authoring-test-cases
description: Read this skill before creating, revising, or adding a variant to ANY test case under test-cases/ — an end-to-end playable game, a full-stack game that produces its own 2D assets during the run, or an asset-generation case of any asset_kind (2D sprite/sprite-sheet drawn with draw/draw-sheet; static or animated voxel/cube models; static or animated meshed mc/sn/dc SDF/CSG models; skinned mc/sn/dc characters; ui high-res 2D; material PBR textures; particle systems; audio sfx/music). The authoring and variant procedures now live in the documentation site (Astro Starlight) so they serve both developers and agents; this skill routes you to the right guide and quickstart, and to the authoritative manifest/testing docs, by test type and asset_kind.
---

# Authoring test cases (documentation-first)

The step-by-step procedures for authoring test cases, adding versions, and adding
variants **live in the documentation site**, not in this skill. This is deliberate:
the same pages serve developers browsing the [Astro Starlight](https://starlight.astro.build/)
docs and agents working in the repo, so there is one source of truth that stays
current when the workflow changes.

**Do this:** identify the test type (and, for asset-generation, the `asset_kind`),
then open the matching **guide** below and follow it. Each guide is the full,
self-contained procedure; the paired **quickstart** is a short refresher. The
[`testing/`](../../../apps/docs/src/content/docs/testing/) pages remain
authoritative for **what** each manifest field means — read them first, as the
guides instruct.

## Pick your guide

Pick the `asset_kind` from
[`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md);
an end-to-end or full-stack case has no `asset_kind` (a full-stack case is an
end-to-end game that additionally produces its own 2D assets during the run).

| You are authoring… | Guide | Quickstart |
| --- | --- | --- |
| A playable game (end-to-end) | [`guides/authoring-an-end-to-end-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-an-end-to-end-test-case.md) | [`quickstarts/author-an-end-to-end-test-case.md`](../../../apps/docs/src/content/docs/quickstarts/authoring/author-an-end-to-end-test-case.md) |
| A playable game that produces its own 2D assets (full-stack) | [`guides/authoring-a-full-stack-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-full-stack-test-case.md) | [`quickstarts/author-a-full-stack-test-case.md`](../../../apps/docs/src/content/docs/quickstarts/authoring/author-a-full-stack-test-case.md) |
| A 2D sprite / sprite sheet (`sprite`, `sprite-sheet`) | [`guides/authoring-an-asset-generation-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-an-asset-generation-test-case.md) | [`quickstarts/author-an-asset-generation-test-case.md`](../../../apps/docs/src/content/docs/quickstarts/authoring/author-an-asset-generation-test-case.md) |
| A static voxel/cube model (`voxel-model`) | [`guides/authoring-a-voxel-model-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-voxel-model-test-case.md) | — |
| A rigged, animated voxel model (`voxel-animation`) | [`guides/authoring-a-voxel-animation-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-voxel-animation-test-case.md) | — |
| A static meshed model (`mc-model`/`sn-model`/`dc-model`) | [`guides/authoring-a-mesh-model-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-mesh-model-test-case.md) | — |
| A rigged, animated meshed model (`mc-animation`/`sn-animation`/`dc-animation`) | [`guides/authoring-a-mesh-animation-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-mesh-animation-test-case.md) | — |
| A skinned character (`mc-skinned`/`sn-skinned`/`dc-skinned`) | [`guides/authoring-a-skinned-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-skinned-test-case.md) | — |
| A Blender-authored skinned character (`blender-character`) | [`guides/authoring-a-blender-character-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-blender-character-test-case.md) | — |
| A high-res 2D UI asset (`ui`) | [`guides/authoring-a-ui-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-ui-test-case.md) | — |
| A PBR material (`material`) | [`guides/authoring-a-material-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-material-test-case.md) | — |
| A particle system (`particle`) | [`guides/authoring-a-particle-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-a-particle-test-case.md) | — |
| Audio — sfx or music (`audio`) | [`guides/authoring-an-audio-test-case.md`](../../../apps/docs/src/content/docs/guides/authoring/authoring-an-audio-test-case.md) | — |

## Adding a variant to an existing case

A variant is a brief variation (asset-generation) or an added mode (end-to-end)
registered in a version's `test-case.toml`.

| Variant of… | Guide | Quickstart |
| --- | --- | --- |
| An end-to-end case (a playable mode) | [`guides/creating-an-end-to-end-variant.md`](../../../apps/docs/src/content/docs/guides/authoring/creating-an-end-to-end-variant.md) | [`quickstarts/create-an-end-to-end-variant.md`](../../../apps/docs/src/content/docs/quickstarts/authoring/create-an-end-to-end-variant.md) |
| A single-sprite case (`sprite`) | [`guides/creating-a-sprite-variant.md`](../../../apps/docs/src/content/docs/guides/authoring/creating-a-sprite-variant.md) | [`quickstarts/create-a-sprite-variant.md`](../../../apps/docs/src/content/docs/quickstarts/authoring/create-a-sprite-variant.md) |
| A sprite-sheet case (`sprite-sheet`) | [`guides/creating-a-sprite-sheet-variant.md`](../../../apps/docs/src/content/docs/guides/authoring/creating-a-sprite-sheet-variant.md) | [`quickstarts/create-a-sprite-sheet-variant.md`](../../../apps/docs/src/content/docs/quickstarts/authoring/create-a-sprite-sheet-variant.md) |
| A static-voxel case (`voxel-model`) | [`guides/creating-a-voxel-model-variant.md`](../../../apps/docs/src/content/docs/guides/authoring/creating-a-voxel-model-variant.md) | — |
| A voxel-animation case (`voxel-animation`) | [`guides/creating-a-voxel-animation-variant.md`](../../../apps/docs/src/content/docs/guides/authoring/creating-a-voxel-animation-variant.md) | — |
| A static meshed case (`mc-model`/`sn-model`/`dc-model`) | [`guides/creating-a-mesh-model-variant.md`](../../../apps/docs/src/content/docs/guides/authoring/creating-a-mesh-model-variant.md) | — |
| A meshed-animation case (`mc-animation`/`sn-animation`/`dc-animation`) | [`guides/creating-a-mesh-animation-variant.md`](../../../apps/docs/src/content/docs/guides/authoring/creating-a-mesh-animation-variant.md) | — |

For a variant of a `skinned`, `ui`, `material`, `particle`, or `audio` case —
kinds with no dedicated variant guide — follow the additive-brief pattern in
[`guides/creating-a-sprite-variant.md`](../../../apps/docs/src/content/docs/guides/authoring/creating-a-sprite-variant.md)
together with that kind's authoring guide and the
[manifest rules](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md):
a variant layers **additive** specs and review items on the common set, and an
asset-generation case declares no `[[reference]]`.

## After authoring

Validate as each guide's **Validate your work** section describes (`tcab prompt` /
`tcab seed`, plus `npm run lint:specs`), then exercise the case end to end with
[`quickstarts/run-a-test-case.md`](../../../apps/docs/src/content/docs/quickstarts/development/run-a-test-case.md).
Editing a case the backend already ingested requires a forced re-ingest — see
[`guides/running-the-local-service-stack.md`](../../../apps/docs/src/content/docs/guides/development/running-the-local-service-stack.md).
