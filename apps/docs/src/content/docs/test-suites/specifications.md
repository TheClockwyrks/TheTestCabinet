---
title: "Specifications"
---

Test suites define specifications as structured data. Every specification has
its own folder, where all files in that folder are for that single
specification. Specification folders may be nested within other specification
folders; it is only files that are required to be specific to the specification.

A folder is a specification folder if and only if it holds a
`specification.toml`.

All specifications are required to have the same elements. A specification
consists of a `specification.md` file that provides a natural language
explanation of the content the specification covers, plus some number of
requirements.

Specification folders live under `specifications/` in the suite tree:

```
specifications/<name>/specification.toml
specifications/<name>/specification.md
```

## The specification manifest

```toml
# specifications/<name>/specification.toml
id = "ball-physics"          # stable identity (required); kebab-case, unique per suite
name = "Ball Physics"        # human-readable display name (required)
summary = "One short line."  # short abstract (required, inline plain text)
path = "ball-physics.md"     # seeded output path (required), relative to specs/

# One table per requirement, in the order they are presented.
[[requirement]]
id = "constant-speed"        # stable identity (required); kebab-case, unique per file
kind = "functional"          # functional | non-functional (required)
text = "The ball MUST travel at a constant speed between collisions."
validators = ["ball/constant-speed.ts"]  # paths under validators/
```

## Specification keys

- `id` identifies the specification across the whole suite. It is kebab-case and
  unique among every specification in the suite, including nested ones.
- `name` is the display name used wherever the specification is presented.
- `summary` is a single inline plain-text line describing what the specification
  covers.
- `path` is where the rendered specification is seeded in the run workspace,
  relative to `specs/`. It ends in `.md`, stays within `specs/`, and is unique
  across the suite. Authoring a specification and placing it in the run
  workspace are therefore decided separately.

## Requirements

All requirements are defined within the `specification.toml` and are written in
RFC 2119 style. The `text` key carries the statement itself, with the RFC 2119
keyword capitalized inside it. The full keyword set is available, aliases
included: MUST, REQUIRED, SHALL, MUST NOT, SHALL NOT, SHOULD, RECOMMENDED,
SHOULD NOT, NOT RECOMMENDED, MAY, and OPTIONAL.

- `id` is kebab-case and unique within the file. Requirement identity across the
  suite is `<specification id>/<requirement id>`, which is the form recorded in
  results. Test case definitions select requirements a whole specification at a
  time, through the `specifications` key.
- `kind` classifies the requirement as `functional` or `non-functional`.
- `text` is the requirement statement, written as a complete RFC 2119 sentence.
- `validators` lists validator module paths relative to `validators/`. Each path
  names a `.ts` file exporting a validator function. A functional requirement
  declares one or more validators.

Every functional requirement must be satisfied. A validator decides it, and a
validator either passes or fails. Non-functional requirements are judged by
review.

Behavioral requirements are functional requirements. Where the test case's
subject is an implementation the model wrote, their validators drive and read
that implementation through the [debug API](/test-suites/debug-apis/).
Appearance requirements are non-functional requirements. A requirement holds for
every engine a test case runs on, because a validator reaches the implementation
only through the engine-independent debug API.

Each validator path is claimed by exactly one requirement across the whole
suite. This keeps every [validator](/test-suites/validators/) result
attributable to a single requirement, so a failing validator names exactly what
the implementation got wrong.
