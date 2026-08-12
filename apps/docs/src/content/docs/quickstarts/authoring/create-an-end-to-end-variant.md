---
title: Create an End-to-End Variant
---

## Overview

Add a playable [variant](/testing/end-to-end/overview/#variants), a mode or
configuration, to an existing end-to-end version. A variant seeds the version's
common specs plus its own additive specs, so its specs describe only the delta.
[Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/)
is the full procedure, and
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/)
is the editorial rulebook the variant's specs follow.

## Steps

1. Choose a consistent slug (`gyre`), display name (`Gyre`), and menu or HUD
   label (`GYRE`).
2. Write `specs/modes/<slug>.md`: which common specs it builds on, the menu
   entry it adds, and its rules framed as a delta against an existing mode, with
   precise, testable numbers. It may reference the common specs. It may not
   reference another variant's spec.
3. Where the variant contradicts an absolute statement in a common spec, soften
   that common spec generically to defer to a mode spec under `specs/modes/`.
   Leave the existing variants' behaviour unchanged.
4. Where the menu differs, add a per-variant `title` mockup at
   `reference/menu-<slug>.html`, copied from a sibling. Mockup source is never
   seeded.
5. Create `variants/<slug>.toml`, a standalone TOML file whose top-level keys are
   the variant's fields, and add its path to the `variants` list in
   `test-case.toml`. The first entry in that list is the default variant.

```toml
# variants/gyre.toml
slug = "gyre"
name = "Gyre"
description = "Standard plus a mode whose obstacles oscillate and rotate."
spec = [{ source = "specs/modes/gyre.md" }]
reference = [{ view = "title", path = "reference/menu-gyre.html" }]

# A mode a variant introduces is usually rated on its own domain, layered on the
# case's common ones.
[[domain]]
id = "gyre"
name = "Gyre"
description = "Swaying, rotating obstacles the ball bounces off at oriented angles."
```

A spec entry's `dest` defaults to its `source` with any trailing `.hbs` removed.
Within one variant, two seeded entries may not share a `dest`. A variant's
`spec`, `reference` and `[[domain]]` entries are additive on the common ones, and
each id or view slug must be unique across the common set and the variant's own.
Every reference view named by a [check](/components/core/validation/#checks) must
resolve for every variant, either as a common reference or as one each variant
declares.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the new variant, then repeat for the existing variants to
confirm nothing else changed.
