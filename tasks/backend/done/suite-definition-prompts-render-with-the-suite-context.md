# Suite-Defined Prompts Render With The Suite Prompt Context

Render a suite-defined test case's prompt in the backend and the gallery
snapshot with the suite prompt context the docs specify, so an ingested suite
version or preview is readable and launchable.

## Current state

`render_variant_prompt` in `crates/backend/src/api/test_cases.rs` renders every
version's prompt with `test_cabinet_core::render_prompt_from_template`, the
authored-case context. `render_case_prompt` in `crates/backend/src/snapshot.rs`
does the same for gallery snapshots. That context has no `specifications`, so a
suite prompt using `{{#each specifications}}` fails in strict mode.

On the local k3d stack, the wizard's own `prompts/full-stack.hbs` and
`prompts/end-to-end.hbs` both use `specifications`. The effects:

- `GET /test-cases/{slug}/versions/{version}` answers `500` with "Failed to
  access variable in strict mode Some(\"specifications\")", for previews and
  exported versions alike.
- The web console's test case page fails to load, and the new-run page leaves
  Launch run disabled.
- A suite prompt that avoids `specifications` renders with the authored
  full-stack standing preamble prepended, which differs from the prompt a run
  receives.

The Spec Cabinet's prompt preview and core's suite rendering already use the
suite context. [Test Case Definition](../../apps/docs/src/content/docs/test-suites/test-case-definition.md#prompt-template)
is authoritative for the context a suite prompt is rendered with.

## Design

Wherever the backend or the snapshot renders the prompt of a suite-defined
version, it renders through core's suite prompt rendering with the documented
context: `workspace`, `engine`, and `specifications`. The prompt a version's
detail shows is the prompt a run of that version receives. Authored cases keep
their current rendering.

## Done when

- [ ] A suite-defined version whose prompt uses `specifications`, `engine` and
      `workspace` renders in version detail, for an exported version and for a
      preview.
- [ ] The rendered prompt equals the prompt a run of that version receives, with
      no authored-case preamble.
- [ ] The gallery snapshot renders suite-defined prompts the same way.
- [ ] The web console loads a suite-defined test case page and enables Launch run
      on its new-run page.
- [ ] Authored cases render as before.
- [ ] Gates green.
