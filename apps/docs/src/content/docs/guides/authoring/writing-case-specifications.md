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

Every value that governs behavior is stated as a concrete value: dimensions,
timings, speeds, scores. Reference screenshots illustrate the target; the numbers
stay in the specs. Appearance is the exception, as
[What is specified and what is validated](#what-is-specified-and-what-is-validated)
explains.

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

## Never help the model

A spec states what must be built and how the built game behaves, in exact
values and observable terms, and **never** how to implement it. Designing the
implementation is the work a run measures, so a spec that suggests an
algorithm, a data structure, a decomposition, or a place for code to live is
doing part of the model's job. The fixed build interface, the seeded project's
toolchain, and the module contract an engine's workspace states are
requirements, and they are the only implementation facts a spec fixes.

Every sentence in a spec is a rule: a statement a build either satisfies or
violates. A sentence a build cannot violate is advice, and advice is cut or
recast as the rule it hints at.

| Advice (cut) | Rule (kept) |
| --- | --- |
| Name each one once in a module of your own and read it from there, rather than restating a value at each use. | Every fixed figure is named once and imported where it is used. |

The left column tells the model how to write its code. The right column states
a property the finished code either has or lacks, which is what the
[clean-code requirements](#clean-maintainable-code) already are: rules about
the delivered code, not guidance on producing it.

## What is specified and what is validated

A playable case is scored by its validators and rated by its reviewers, and the
specs are written so the two never overlap. These principles apply to every
end-to-end and full-stack case.

### Behavior is exact and validated

Everything a validator checks is specified exactly, or by explicit upper and
lower bounds. A model then has one reading of the rule, and a validator asserts
that reading and nothing more.

A validator is derived from the spec, never from the reference implementation.
Every threshold it asserts traces to a figure or rule the spec states, plus an
honest numeric tolerance. A validator that passes on the reference but fails a
different, spec-compliant build is worse than no validator, in the same way a
flaky test is worse than no test: it teaches the reader to distrust the whole
suite.

### Appearance is loose and reviewed

The spec states what must be visible or present: a dark field, two paddles each
drawn in a color that stands apart from the field and from each other, the
scores near the top during a match, a title screen showing the title and the
menu. Palettes, fonts, layouts, and styling are the build's choices.

How the build looks is what the reviewer's
[domain ratings](/testing/end-to-end/evaluation/#review) judge. A validator
asserting appearance checks presence and distinguishability, never a hex value.

### Every review item carries a validator

Every review item declares a
[validation script](/testing/end-to-end/manifests/#automated-validation), for
every engine the case supports. The checklist is decided by the validators and
the reviewer overrides a verdict only as the exception; behavior is never
something a reviewer is asked to decide.

### One observable behavior per item

A review item asserts one observable behavior. A single item for "the paddle
moves up and down" earns the same score for a build whose paddle moves both ways
as for one whose paddle moves only up, because the item can only fail once.
Split it into "up" and "down", and the two builds score differently. Tightly
focused items are what let results differentiate models.

### Clean, maintainable code

The spec requires the code a model writes to be fit for a real codebase shared
with human developers: modules split by concern, every fixed figure named once
and imported, no duplicated logic or dead code, comments that explain intent, and
the project's type-check, lint, format, and test commands passing.

### Engineless configurations

A case's `none` workspace follows the principles above best-effort, since without
an engine a validator drives the build through its
[debug API](/testing/end-to-end/instrumentation/) in a browser rather than in
process. The hard rule is that the seeded workspace supplies configuration only:
a `package.json`, tool configuration, and an `index.html`, with no source code.
The model owns as much of the code as possible.

## Edge cases

A spec states the rules of the system. Recognizing what those rules imply at the
boundaries is the model's job, and failing to recognize it is a result worth
measuring.

An edge case earns a place in a spec when it needs behavior the general rules do
not already produce. In that case it is a rule, and it is written as one.

Every other edge case becomes a
[review item](/testing/end-to-end/evaluation/#review) with a validation script,
so a model that misses it is docked points. The script asserts what the spec's
rules imply at that boundary, with the spec, rather than the reference
implementation, as its source.

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

- The seeded set is complete and self-contained, with every value that governs
  behavior written as a concrete number or an explicit bound.
- Appearance is specified as what must be visible or present, leaving palette,
  type, layout, and styling to the build.
- Every review item asserts one observable behavior and carries a validation
  script for every supported engine, with every threshold derived from the
  spec.
- The spec requires clean, maintainable code and names the checks that must
  pass.
- The specs carry no implementation advice: every sentence states a rule a
  build can violate, and nothing suggests how to implement one.
- An engineless workspace contains configuration only.
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
