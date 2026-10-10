---
title: "Manifests"
---

A test suite declares its identity once, in the suite manifest at the root of the
suite folder. Each suite tree declares what distinguishes that version of the
suite, in the version manifest at the root of the tree.

```text
<slug>/
  suite.toml          # the suite manifest
  drafts/<draft>/
    version.toml      # a version manifest
  versions/v<major>.<minor>.<patch>/
    version.toml      # a version manifest
```

## The suite manifest

```toml
# <slug>/suite.toml
slug = "carom"  # stable identity (required); matches the suite folder
name = "Carom"  # human-readable display name (required)
```

- `slug` is the suite's stable identity and matches the suite folder. It is a
  kebab-case token of lowercase letters and digits with single hyphens between
  them, and it is fixed when the suite is created.
- `name` is the display name shown wherever the suite is presented, including
  for each of its exported versions.

A folder in the test suites repository is a suite if and only if it holds a
`suite.toml`.

## The version manifest

Every path a version manifest names is relative to the suite tree and resolves
inside it, so a suite tree stays self-contained. A declared path is validated to
exist when the suite is read.

```toml
# <slug>/versions/v<major>.<minor>.<patch>/version.toml
version = "1.0.0"               # semver (written by export); matches the version folder
tags = ["arcade", "2d"]         # classification tags (optional, default [])
summary = "One short line."     # one-line abstract (required, inline plain text)
description = "description.md"  # suite prose (required, relative path)
changelog = "changelog.md"      # per-version changelog (required, relative path)
experimental = false            # optional; true hides the version unless opted in
```

Everything a run executes is declared by the suite's [test case
definitions](/test-suites/test-case-definition/).

- `version` is the suite version in semver form and matches the name of the
  containing version folder, with the folder carrying a leading `v`. A version
  folder named `v1.2.0` declares `version = "1.2.0"`. Export writes it, and a
  draft omits it.
- `tags` classify the version for filtering and default to an empty list.
- `summary` is a one-line abstract authored inline as plain text.
- `description` points at the Markdown file describing the suite.
- `changelog` points at the Markdown file recording what changed in this
  version relative to the version it follows.
- `experimental` marks a version as still being iterated on and defaults to
  `false`. A deployment offers experimental versions only when it opts in.
