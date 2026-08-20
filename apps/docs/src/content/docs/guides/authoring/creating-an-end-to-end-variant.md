---
title: Creating an End-to-End Variant
---

## Overview

An [end-to-end](/testing/end-to-end/overview/) test case version offers one or
more variants, and a run selects exactly one. Every variant seeds the version's
common specs plus its own additive specs, so a single case can describe several
builds without duplicating the shared specification. The chosen variant's slug is
recorded in the run record, so every result is attributed to a specific build.

This guide is the procedure for adding a variant to an existing end-to-end
version. The authoritative rules live in
[End-to-End Tests](/testing/end-to-end/overview/#variants) and
[Manifests](/testing/end-to-end/manifests/#the-variant-file). The worked example
is the Gyre variant of the `carom` case, whose obstacles oscillate and rotate.

A variant's seeded specs must never mention the other variants, because a run
receives only the one it selected. The rest of the editorial rules in
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/)
apply to a variant's specs as much as to the common ones.

## Variant contents

A variant lives in its own file under `variants/` and is listed in the `variants`
array in `test-case.toml`. Its `spec`, `reference`, `proof`, review, and
`[[domain]]` entries are additive on top of the common ones. It may also declare
its own `workspace`, which replaces the common workspace, and its own
`reference_implementation`.

The rules the variant's mode adds reach the model in one of two ways: through a
spec file the variant seeds itself, or through a common `.hbs`
[spec template](/testing/end-to-end/overview/#spec-templates) that branches on
`{{variant.slug}}`. A template keeps one shared narrative and states the mode's
rules inline; a separate file keeps the mode's rules in one place. `carom` uses
templates, so its `gyre` variant declares no `spec` of its own.

## Procedure

### 1. Choose the variant

Decide and keep consistent everywhere:

- slug, lowercase, used in `test-case.toml` and any spec filename, such as
  `gyre`;
- display name, title case, the variant's `name`, such as `Gyre`;
- menu label, the upper-case main-menu entry, such as `GYRE`;
- HUD or in-game label, usually the same upper-case token.

Favor a single evocative word that matches the case's existing mode names.

### 2. State the mode's rules

Either branch the common `.hbs` spec templates on `{{variant.slug}}`, or create
`specs/modes/<slug>.md` following the shape of the sibling mode specs. Either
way the seeded text must give:

- which existing rules it builds on, by name;
- a menu-entry section saying which label it adds and where it sits;
- the mode's rules as a delta against an existing mode;
- whatever mechanic sections the variant needs, with precise, testable numbers
  in pixels, degrees, seconds, and multipliers, in the same coordinate system
  and style as the common specs;
- the exact HUD label.

A variant's own spec file may reference the common specs freely, since they are
always seeded, and must never reference another variant's spec.

### 3. Soften a common spec you contradict

Common specs are seeded for every variant, so a flat statement in one ships to
the model alongside a variant that overrides it. When a new variant overrides
something a common spec asserts absolutely, generalize that statement to defer
to the active mode, exactly as the speed-cap rule already does.

Keep the change minimal and generic: refer to the mode rules in general terms,
never to your new variant by name. Naming a variant-only spec from a common spec
breaks self-containment for every other variant. Existing variants' behavior
must stay identical.

For Gyre this meant widening the static-obstacle statements in the playfield,
physics, and flow specs so the gyre branch can carry the moving, rotating
obstacle rules.

### 4. Give the variant a workspace, if its state differs

A variant may declare its own `workspace`, which REPLACES the common one rather
than layering on it — so a variant workspace is the whole seeded project, not a
patch over the case's. Declare one only when the variant genuinely changes what
the starter project must hold, and build it from the common workspace so the two
stay identical everywhere they are not deliberately different.

Gyre needs one: its state carries the obstacle clock and both obstacles' live
poses, and its debug API adds a `setObstacleClock` operation, so
`workspaces/gyre/` is `workspaces/base/` plus those three additions and the
constants naming the sway and spin figures.

A variant that changes only the rules, and not the shape of the state or the
debug surface, declares no `workspace` and seeds the common one.

### 5. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose top-level keys
are the variant's fields, then add its path to the `variants` array in
`test-case.toml`. The first entry is the default. Every path inside the variant
file resolves against the version folder, and `dest` defaults to `source` with a
trailing `.hbs` stripped.

```toml
# variants/gyre.toml
slug = "gyre"
name = "Gyre"
description = "The obstacles sway and rotate, so the ball bounces off tilted faces."
workspace = "workspaces/gyre"

# Keyed by engine slug, because the build a reference demonstrates differs under
# each. The table must name every engine the case supports and nothing else, so
# with one supported engine, naming it alone IS the complete table.
[reference_implementation]
simple-2d = "reference-impl-simple-2d/gyre"

# A category of graded points that only this variant's mode introduces. The case
# manifest declares `[review] format = 2`; a variant inherits it and must not
# repeat it. A variant using the [[review_item]] grammar declares those instead.
[[review.categories]]
id = "gyre"
title = "Gyre"

[[review.categories.items]]
id = "oriented-bounce"
title = "Oriented bounces"
description = "The ball bounces off the obstacles' tilted faces at oriented angles."
validation = { script = "validation/simple-2d/gyre/oriented-bounce.test.ts", outputs = [
  { id = "oriented", name = "A shot deflecting off a tilted obstacle", kind = "video" },
] }
```

```toml
# test-case.toml: add the new file to the ordered list
variants = [
  "variants/base.toml",
  "variants/gyre.toml",
]
```

A `script` path on an engine-backed case must carry the engine segment —
`validation/<engine>/…` — because the runner stages the directory for the run's
engine into the built workspace at `validation/` and reaches a suite by dropping
exactly that segment. A path that omits it names no suite of the run's engine, so
the point is reported as undecided and left to the reviewer rather than failed.
See [The Suite](/engines/simple-2d/validators/the-suite/).

Rules enforced at resolution:

- `spec` entries are additive on the common specs. Within one variant, no two
  seeded specs may share a `dest`.
- `reference` entries are additive on the common views. A view slug must not be
  declared both commonly and by a variant.
- Review entries are additive, in whichever grammar the case declares. Two
  entries resolving to the same verdict id within a variant's effective set are
  rejected.
- A variant's own `[[domain]]` tables are additional to the case's common
  domains, and a domain id must be unique across that effective set. A variant's
  review item may name a common domain or one of its own.
- `[[proof]]` entries are additive on the common proofs. A proof id must be
  unique within the variant's effective set, and the seeded spec must instruct
  the build to write the file at that same `dest`.

Update the human-readable comment in the manifest that enumerates the variants
so the list stays accurate.

## Validate your work

Seed and render the new variant, and re-check the existing ones to confirm your
common-spec edits changed nothing for them:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's set is self-contained, then
lint the specs with `npm run lint:specs`.

Every objective point the variant adds names a
[validator](/components/core/validation/#validators), and a validator is only
worth having once it has been run against the variant's own reference
implementation: a validator that fails there is a broken validator, not a failing
build. Author the variant's reference implementation alongside its validators,
run the suite against it, and then check each validator actually discriminates by
breaking the rule it covers in a scratch copy of that build and confirming that
exactly the expected check fails.

The backend's definition store is immutable per case version, so force a
re-ingest before running:

```sh
scripts/reingest.sh --force <slug>
```

Then exercise the variant with
[Run a Test Case](/quickstarts/development/run-a-test-case/).
