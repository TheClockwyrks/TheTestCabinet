---
title: "Assets"
---

A test suite's `assets/` tree holds the finished asset set for the project. Each
asset gets its own folder at `assets/<asset-id>/`, containing an `asset.toml`
plus the asset's own files. The folder name is the asset's id and is how a test
case definition refers to it.

Every path an `asset.toml` names is relative to that asset's folder and resolves
inside it, so an asset folder stays self-contained.

## asset.toml

```toml
# assets/<asset-id>/asset.toml
id = "player-ship"                    # asset id (required); matches the directory name
name = "Player Ship"                  # display name (required)
kind = "sprite"                       # asset kind (required); see the kind list
specification = "player-ship"         # the specification id describing it (required)
files = ["player-ship.png"]           # the asset's files (required, non-empty)
```

## Asset keys

- `id` is kebab-case, unique across the suite, and identical to the folder name.
- `name` is the display name used wherever the asset is presented.
- `kind` selects the asset's format and the test case type that produces it.
- `specification` names the `id` declared in a `specification.toml` elsewhere in
  the suite, resolved suite-wide. The value is the id itself and carries no
  separators, so it is unrelated to the folder path that specification lives
  under. See [Specifications](/test-suites/specifications/).
- `files` lists the asset's files as paths relative to the asset folder. At
  least one file is declared, and every declared path exists.

## Asset kinds

| Kind           | Content                                             |
| -------------- | --------------------------------------------------- |
| `sprite`       | A single 2D sprite image                            |
| `sprite-sheet` | A 2D sprite sheet for one entity                    |
| `voxel`        | A voxel model, optionally with rigid-body animation |
| `blender`      | A model authored through Blender's Python API       |
| `particle`     | A particle system read by the particle runtime      |
| `music`        | A musical score                                     |
| `audio-fx`     | A short, non-musical audio effect                   |

## Asset specifications

An asset is specified the same way the rest of the suite is, through a
specification folder. Every requirement in an asset specification is
non-functional, because an asset is judged by review rather than by code. An
asset specification therefore carries no validators.

## Assets across the suite's test cases

A suite's assets serve all three ways the project is used as a test case:

- A full stack test case requires the model under test to produce the assets
  itself, alongside the code, against the same asset specifications.
- An end to end test case seeds the assets into the run so the model under test
  writes only code.
- An asset generation test case asks the model under test for exactly one asset
  and grades it against that asset's specification alone.

A test case definition of an asset-producing type names the asset it targets
through the table named for its type. Each type's table carries the keys that
type needs:

```toml
# test-cases/<name>.toml
type = "voxel"

[voxel]
id = "player-ship"  # an id under assets/ (required)
animated = true     # require rigid-body animation (optional, default false)
```

See [Test Case Definitions](/test-suites/test-case-definition/) for each type's
table and the rest of the definition format.

## Authoring assets

Assets are authored, imported, and edited through The Spec Cabinet, which also
generates asset generation test case definitions from them. A draft's full stack
test case can be run against a [preview](/test-suites/overview/#previews) to
produce the assets that are then bundled with it.
