---
title: Writing Case Specifications and Prompts
---

The seeded specs and the rendered prompt are the entire world a model sees when
it builds a case. This guide collects the editorial rules that apply to every
[end-to-end](/testing/end-to-end/overview/) and
[full-stack](/testing/full-stack/overview/) case, so that the per-type authoring
guides can stay focused on structure, manifests, and validation.

Read this alongside
[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/)
or
[Authoring a Full-Stack Test Case](/guides/authoring/authoring-a-full-stack-test-case/).
Those guides describe *what files to produce*; this one describes *how to write
what goes in them*, and applies equally when revising an existing case or adding
a variant.

## The specification is the only source of truth

A run is seeded with the selected variant's specs and nothing else: no links out,
no docs site, no reference source, no conversation. Anything a model must know to
build the case correctly has to be written down in the seeded set, in real
numbers and observable terms.

Two consequences follow.

**Say it once, and say it completely.** If a value matters (a dimension, a
color, a timing, a score) it belongs in a spec as a concrete value, not as a
gesture at one. Screenshots illustrate a target; they never substitute for the
numbers.

**Write only the current state.** A model sees the specs exactly as they stand
today, so the history of how they got there is noise that costs tokens and
invites confusion. Do not write "previously", "as of v1.1", "this was changed
to", "the old behavior was", or changelog-style notes. Describe the system that
exists. Version history lives in git, and a case's own history lives in the
immutable versions under its slug.

## Never reveal that this is a test

A model must not learn that it is being evaluated, that its output will be
scored, or that The Test Cabinet exists. Knowing it is under test changes how a
model behaves, which contaminates the result.

Keep out of every seeded spec and prompt:

- the phrases "test case", "test cabinet", "benchmark", "evaluation", "grading",
  "scoring", and the names of any of this project's components or tooling;
- any framing that presents a requirement as something being *measured* rather
  than something the product needs;
- URLs, paths, or identifiers that point back at this repository or the gallery.

Requirements that exist for validation still go in the spec, framed as ordinary
product requirements. The [instrumentation](/testing/end-to-end/instrumentation/)
contract is the standing example: the debug API, deterministic core, and debug
overlay are specified as normal debugging features that the game needs, never as
the mechanism a run is judged through.

Mentioning **reviewers** is acceptable. Work gets reviewed whether or not it is
part of a benchmark, so "reviewers will check X" reads as ordinary engineering
process rather than as a tell.

## Edge cases belong in review items, not in specs

A spec states the rules of the system. Recognizing what those rules imply at the
boundaries is the model's job, and failing to recognize it is a genuine result
worth measuring.

So do not write gotcha notes. If a situation is already covered by the spec's
wording, calling it out separately hands the model a hint it should have derived,
and turns a design test into a reading-comprehension test.

An edge case earns a place in the spec only when it needs **special** behavior
that the general rules do not already produce. In that case it is not really an
edge case, it is a rule, and it should be written as one.

Every edge case you are tempted to warn about should instead become a
[review item](/testing/end-to-end/evaluation/#review) with an
[automated validation script](/testing/end-to-end/manifests/#automated-validation),
so a model that misses it is docked points rather than rescued by a footnote.
Write the script against the debug API and the deterministic core, exactly as the
[instrumentation](/testing/end-to-end/instrumentation/) doc describes.

## Say nothing about variants a run cannot see

A run receives one variant. References to sibling variants, alternate modes, or
"the other difficulty settings" describe things the model has no access to and
cannot build, so they read as missing specs.

- Never mention other variants or modes by name in a seeded spec.
- Give each variant its own spec file seeded to a common destination, or branch
  with Handlebars so the rendered spec carries only the selected variant's
  section.
- Do not keep a `modes/` directory holding a single file. If a variant has one
  mode spec, name it for what it is (`mode.md`), and let the seeded destination
  be stable across variants.

## Name and scope files for this case

Spec filenames are part of the specification a model reads, so they should
describe this case's concerns. Many cases were scaffolded from Carom and inherited
its file names even where they fit badly. There is no requirement to match Carom
name for name, and no reason to force a case into a shape that is not natural for
it.

Rename and split freely so that each file has an accurate name and a coherent
scope: a reader should be able to predict a file's contents from its name, and
find a given rule in exactly one file. Cross-reference the others by name. When
you rename a spec, update the `[[spec]]` entries in `test-case.toml` and every
cross-reference in the seeded set, then re-seed to confirm nothing dangles.

## Prompts state the task, not advice

`prompt.hbs` tells the model what it is being asked to build, where the workspace
is, and how the build must be invoked. It is not a place to coach.

Remove "Verify before you finish", "make sure to test your work", "double-check
your implementation", and every similar exhortation. A capable model should
recognize on its own that it needs to validate what it built. A model that does
not, and ships a broken build, has produced a real and useful signal, and
prompting that behavior into existence hides it.

State capability, not conduct: it is correct for the prompt to say that Playwright
with Chromium is available in the container, and incorrect for it to say how or
whether to use it.

Keep the prompt short. It carries the task, the run-specific operational detail
(workspace path, commit expectations), and the fixed build-and-serve interface.
Every other requirement lives in the specs and is pointed at, not restated.

## Prose style

The specs are read by a model under a token budget, so density matters more than
voice.

**Em dash interruptions.** Avoid the parenthetical em dash aside. Text of the
form "the ball bounces — losing speed — off the wall" should be restructured into
plain sentences, or split into two. A single em dash introducing a clause at the
end of a sentence is acceptable in moderation; a running habit of them is not.

**Bold.** Reserve bold for the few words that would change the build if missed.
Existing specs over-use it heavily, and the correct target when revising is well
under a tenth of the current amount. When everything is emphasized, nothing is.
Prefer structure (headings, lists, tables) over inline emphasis to make a
requirement findable.

**Lists and tables over paragraphs** for anything enumerable: values, states,
screens, controls, and thresholds all read better and stay unambiguous in a
table.

## Revision checklist

When you finish revising a case's specs or prompt, confirm each of the following.

- The seeded set is complete and self-contained, with every value written as a
  concrete number.
- No historical or changelog wording anywhere in the seeded set.
- No mention of testing, benchmarking, scoring, or this project, in specs,
  prompt, or filenames.
- No gotcha or edge-case warnings that the spec's own rules already imply, and a
  review item with a validation script for each edge case you removed.
- No references to other variants or modes, and no single-file `modes/`
  directory.
- Filenames describe this case's concerns, and each file has one coherent scope.
- No "verify your work" advice in the prompt.
- Em dash asides and bold usage cut back hard.

Then re-run the resolution and seeding for every variant, as the per-type
authoring guide's **Validate your work** section describes, and read the seeded
output rather than the sources when checking these items. The seeded tree is what
the model actually receives.

## Next steps

- [Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/)
  — the full structural procedure for a playable case.
- [Authoring a Full-Stack Test Case](/guides/authoring/authoring-a-full-stack-test-case/)
  — the same, for a case that also produces its own 2D assets.
- [Instrumentation](/testing/end-to-end/instrumentation/) — the debug API and
  deterministic core that validation scripts drive.
- [End-to-End Manifests](/testing/end-to-end/manifests/) — review items, sub-items,
  and the `validation` table an edge case turns into.
