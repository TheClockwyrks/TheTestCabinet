---
title: Writing Case Specifications and Prompts
---

## Overview

The seeded specs and the rendered prompt are the whole world a model sees when it
builds a case. The rules on this page apply to every
[end-to-end](/testing/end-to-end/overview/) and
[full-stack](/testing/full-stack/overview/) case, whether you are authoring one,
revising one, or adding a variant. The per-type authoring guides say which files
to produce; this page says what goes in them.

## The seeded set

A run is seeded with the selected variant's specs plus the case's assets, in an
isolated container. Everything a model must know to build the case is written
into that set, in real numbers and observable terms.

Every value that matters is stated as a concrete value: dimensions, colors,
timings, scores. Reference screenshots illustrate the target; the numbers stay in
the specs.

The seeded set describes the design as it stands today. A case's history lives in
git and in the immutable versions under its slug, so wording such as
"previously", "as of v1.1", or "this was changed to" is removed from the seeded
files.

## Keeping evaluation out of the seeded set

A model must not learn that it is being evaluated, that its output is scored, or
that The Test Cabinet exists. Knowing it is under test changes how a model
behaves and contaminates the result.

Every seeded spec and the prompt exclude:

- the phrases "test case", "test cabinet", "benchmark", "evaluation", "grading",
  and "scoring", and the names of this project's components and tooling;
- framing that presents a requirement as something measured rather than something
  the product needs;
- URLs, paths, and identifiers that point at this repository or the gallery.

Requirements that exist for validation are written as ordinary product
requirements. The [instrumentation](/testing/end-to-end/instrumentation/)
contract is the standing example: the debug API, deterministic core, and debug
overlay are specified as debugging features the game needs.

Mentioning reviewers is acceptable. Work gets reviewed whether or not it is part
of a benchmark, so "reviewers will check X" reads as ordinary engineering
process.

## Edge cases

A spec states the rules of the system. Recognizing what those rules imply at the
boundaries is the model's job, and failing to recognize it is a result worth
measuring.

An edge case earns a place in a spec when it needs behavior the general rules do
not already produce. In that case it is a rule, and it is written as one.

Every other edge case becomes a
[review item](/testing/end-to-end/evaluation/#review) with an
[automated validation script](/testing/end-to-end/manifests/#automated-validation),
so a model that misses it is docked points. Write the script against the debug
API and the deterministic core.

## One variant per run

A run receives one variant, so a seeded spec describes only that variant.
References to sibling variants, alternate modes, or other difficulty settings
describe things the model cannot build.

- Give each variant its own spec file seeded to a common destination, or branch
  with Handlebars so the rendered spec carries only the selected variant's
  section.
- Name a single mode spec for what it is (`mode.md`) and keep its seeded
  destination stable across variants.

## File names and scope

Spec file names are part of the specification a model reads, so they describe
this case's concerns. Rename and split freely so each file has an accurate name
and a coherent scope: a reader can predict a file's contents from its name and
find a given rule in exactly one file, with the others cross-referenced by name.

When you rename a spec, update the `[[spec]]` entries in `test-case.toml` and
every cross-reference in the seeded set, then re-seed to confirm nothing dangles.

## Prompt content

`prompt.hbs` tells the model what it is being asked to build, where the workspace
is, and how the build is invoked. Every other requirement lives in the specs and
is pointed at rather than restated. If a sentence appears in both the prompt and
a spec, cut it from the prompt.

The prompt carries no coaching. "Verify before you finish", "make sure to test
your work", and similar exhortations are removed. A capable model recognizes on
its own that it needs to validate what it built, and a model that ships a broken
build has produced a real signal.

State capability rather than conduct: the prompt says Playwright with Chromium is
available in the container, and leaves how and whether to use it to the model.

## Prose style

The specs are read by a model under a token budget, so density matters more than
voice.

### Em dash asides

Restructure "the ball bounces — losing speed — off the wall" into plain
sentences. A single em dash introducing a clause at the end of a sentence is
acceptable in moderation.

### Bold

Reserve bold for the few words that would change the build if missed. Prefer
structure such as headings, lists, and tables to make a requirement findable.

### Lists and tables

Values, states, screens, controls, and thresholds all read better and stay
unambiguous in a table.

## Revision checklist

When you finish revising a case's specs or prompt, confirm each of the following.

- The seeded set is complete and self-contained, with every value written as a
  concrete number.
- The seeded set carries no historical or changelog wording.
- Specs, prompt, and file names carry no mention of testing, benchmarking,
  scoring, or this project.
- Each edge case the spec's own rules already imply has become a review item with
  a validation script.
- No spec references another variant or mode.
- File names describe this case's concerns, and each file has one coherent scope.
- The prompt states the task and the operational detail only.
- Em dash asides and bold are cut back hard.

Then re-render the prompt and re-seed every variant, as the per-type authoring
guide's validation section describes, and check these items against the seeded
output rather than the sources. The seeded tree is what the model receives.

## Next steps

- [Authoring an end-to-end case](/guides/authoring/authoring-an-end-to-end-test-case/)
  gives the structural procedure for a playable case.
- [Authoring a full-stack case](/guides/authoring/authoring-a-full-stack-test-case/)
  does the same for a case that also produces its own 2D assets.
- [Instrumentation](/testing/end-to-end/instrumentation/) covers the debug API
  and deterministic core that validation scripts drive.
