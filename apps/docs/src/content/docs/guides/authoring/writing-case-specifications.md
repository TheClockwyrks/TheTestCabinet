---
title: Writing Case Specifications and Prompts
---

## Overview

The seeded specs and the rendered prompt are the whole world a model sees when it
builds a case, alongside the starter project the case seeds beside them. The
rules on this page apply to every
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

The seeded workspace carries the same rule, as
[The workspace describes the game alone](/guides/authoring/writing-workspaces-and-references/#the-workspace-describes-the-game-alone)
covers.

Requirements that exist for validation are written as ordinary product
requirements. The [instrumentation](/testing/end-to-end/instrumentation/)
contract is the standing example: the debug API, render-free core, and debug
overlay are specified as debugging features the game needs.

Mentioning reviewers is acceptable. Work gets reviewed whether or not it is part
of a benchmark, so "reviewers will check X" reads as ordinary engineering
process.

## Never help the model

A spec states what must be built and how the built game behaves, in exact values
and observable terms. Deciding how to build it is the work a run measures, so a
spec fixes no algorithm, no data structure, no decomposition, and no place for
code to live. The build interface, the seeded project's toolchain, and the module
contract an engine's workspace states are the only implementation facts a spec
fixes, because a run depends on them.

Clean code is one of the requirements a spec states, not a lesson a spec teaches.
The spec requires code fit for a long-lived codebase shared with other developers
and names the checks that must pass. Which figures get a name, how modules
divide, where a rule lives, and what a comment explains are the model's
decisions, and deciding them badly is a result worth measuring.

| Coaching (cut)                                                                                                         | Requirement (kept)                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Name each fixed figure once in a module of your own and read it from there, rather than restating a value at each use. | The code is fit for a long-lived codebase shared with other developers.      |
| Read the pressed keys into a set each frame and check it when you move the paddles.                                    | The left paddle moves up while `KeyW` is held and down while `KeyS` is held. |

The test is not whether a sentence names something a build could fail to do.
"Every fixed figure is named once and imported where it is used" is a property a
finished build either has or lacks, and it is still coaching, because it hands
over a practice the model is there to arrive at on its own. The test is whether
the sentence describes the product or the process that produces it.

An implementation fact a validated figure depends on is a requirement. Where a
spec asserts a position or a speed to a tolerance, the integration and the order
collisions resolve in are stated exactly, because a validator can only assert a
figure the spec pins down. That is the same exemption the module contract has,
and it reaches no further: the moment a sentence stops being what a validator's
number rests on, it is coaching again.

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
[domain ratings](/testing/end-to-end/evaluation/#review) judge. A validator reads
the picture only to decide whether the build drew something where the spec says
something is drawn, and reads palettes, contrast, extent, and placement never.

### Produced files are required to load

A case whose build produces its own files states that the built site is
self-contained and carries every file it draws and plays, and that the site
serves every produced file under the root the spec names. Producing those files
and getting them to the page is the build's work, and a build that fails at it
fails the checks that read what it drew.

The spec states no behavior for a load that fails. Wording that keeps the game
running through a missing sprite or a silent cue makes degradation a requirement,
which puts a fallback path under test and invites a validator to withhold the
files every other check depends on.

### Showcase media exists and is reviewed

A case that requires the build to produce showcase media carries one review item
for it. That item's validator confirms the showcase is present and checks
nothing further, and no other item asserts anything about the media. What the
showcase says and how well it presents the game are the reviewer's to judge,
like the rest of the build's presentation.

The item declares a `weight` above the default an ordinary item carries. The
case picks the figure.

A seeded spec states the showcase the build owes: the description, the carousel
manifest, and the media files, at the paths the
[showcase format](/components/core/showcase/) fixes. The showcase is a
deliverable of the build like any other, so the spec states it as one.

What a reference implementation carries for that validator is covered by
[It carries the least its showcase validator needs](/guides/authoring/writing-workspaces-and-references/#it-carries-the-least-its-showcase-validator-needs).

### Every review item carries a validator

Every review item declares a
[validation script](/testing/end-to-end/manifests/#automated-validation). The
script covers every engine the case supports unless the item's validation names
`engines`, which scopes the item to the engines where the behavior is the
build's own work rather than the engine's. The checklist is decided by the
validators and the reviewer overrides a verdict only as the exception; behavior
is never something a reviewer is asked to decide.

### One observable behavior per item

A review item asserts one observable behavior. A single item for "the paddle
moves up and down" earns the same score for a build whose paddle moves both ways
as for one whose paddle moves only up, because the item can only fail once.
Split it into "up" and "down", and the two builds score differently. Tightly
focused items are what let results differentiate models.

### Clean, maintainable code

The spec requires the code a model writes to be fit for a real codebase shared
with human developers, and names the checks that must pass: the project's
type-check, lint, format, and test commands. The practices that get it there stay
out of the spec, as [Never help the model](#never-help-the-model) covers.

The workspace ships the configuration those commands run under, as
[The shared toolchain](/guides/authoring/writing-workspaces-and-references/#the-shared-toolchain)
covers.

### Engineless configurations

A case's `none` workspace follows the principles above best-effort, since without
an engine a validator drives the build through its
[debug API](/testing/end-to-end/instrumentation/) in a browser rather than in
process. What that workspace holds is covered by
[Engineless workspaces ship configuration only](/guides/authoring/writing-workspaces-and-references/#engineless-workspaces-ship-configuration-only).

## Validators type-check where they are authored

A case ships one validator project per engine at `validation/<engine>/`, and a
run stages that project into the collected tree at `validation/`. Each project's
`tsconfig.json` extends `../tsconfig.json`, which is the build's own root
tsconfig at run time.

The version supplies that parent at `validation/tsconfig.json`, a copy of the
seeded workspace's `tsconfig.json`, so a validator is checked under the options
it runs under. Nothing seeds or stages it.

Two module paths a validator uses exist only in the staged tree. `../src/*` is
the build's own source, and `./case-harness/*` is the shared harness copied in
beside the suites. Each project's `tsconfig.json` maps both onto the checkout
with `rootDirs`, pointing the first at the case's reference implementation for
that engine and the second at `packages/case-harness/src`. The reference is the
one for the project's own engine at the case's default variant, and every suite
in the project is checked against it.

Run `npm run typecheck:validators` after editing a validator or a reference
implementation's exported surface. It covers every project of every case, and
both CI systems run it.

## Menus and screens

A case whose build presents menus specifies how they are driven, how they lead
to one another, and what is selected on the way back.

### Menus take pointer and touch

Every menu a case specifies is navigable with a mouse and with touch as well as
with the keyboard. The spec states the effect of each: a pointer moved onto an
item's region selects that item, a press and release inside the region confirms
it, and a touch contact landing and lifting inside the region selects and
confirms it.

Menu layout stays the build's, so the spec requires the build to report an
item's hit region through its debug API, as
[Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/#a-build-reports-the-layout-a-spec-leaves-loose)
covers. A validator drives the pointer at the region the build reports.

### Every transition is stated

The spec names each transition between screens: the screen it starts on, the
input that causes it, and the screen it reaches. A case with an in-game pause
menu specifies that the menu opens on Escape and on `P`, and that either key
resumes the game while the menu is open.

### Returning selects the entry left from

Navigating back to a menu selects the entry that led away from it. A build
leaving a How To Play screen returns to the main menu with the How To Play entry
selected, and a match left for the menu returns with the entry that started that
match selected.

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
- A case producing its own files requires the built site to be self-contained and
  to serve every produced file, and states no behavior for a load that fails.
- Every menu is navigable by pointer and touch as well as by the keyboard, and
  the build reports each item's hit region through its debug API.
- Every transition between screens is stated, and a pause menu opens on Escape
  and on `P` and resumes on either.
- Navigating back to a menu selects the entry that led away from it.
- Every review item asserts one observable behavior and carries a validation
  script for each engine it covers, with every threshold derived from the spec.
- Every validator project type-checks, with `npm run typecheck:validators`.
- A required showcase carries one review item whose validator checks only that
  the showcase exists, weighted above the default, with no other item asserting
  anything about the media.
- The seeded set states the showcase as a deliverable of the build.
- The spec requires clean, maintainable code and names the checks that must
  pass, without listing the practices that produce it.
- The specs carry no coaching: nothing states how to build the game or how to
  write the code, only what the finished build must be and do.
- The seeded set carries no historical or changelog wording.
- Specs, prompt, file names, and the seeded workspace carry no mention of
  testing, benchmarking, scoring, or this project.
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

- [Writing workspaces and reference implementations](/guides/authoring/writing-workspaces-and-references/)
  covers the starter project a run begins from and the case's own answer.
- [Authoring an end-to-end case](/guides/authoring/authoring-an-end-to-end-test-case/)
  gives the structural procedure for a playable case.
- [Authoring a full-stack case](/guides/authoring/authoring-a-full-stack-test-case/)
  does the same for a case that also produces its own assets.
- [Instrumentation](/testing/end-to-end/instrumentation/) covers the debug API
  and render-free core that validation scripts drive.
