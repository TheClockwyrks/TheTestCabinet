# The CLI Reads And Ingests Test Suites

Teach `tcab` to resolve a suite-defined test case out of a local checkout, so a
suite can be seeded, its prompt rendered, and its validators run from the command
line, and add the ingest command that pushes a checkout into a backend.

## Current state

`crates/cli/src/cli.rs` declares the command set: `Run`, `Validate`, `Register`,
`Login`, `Logout`, `Review`, `Publish`, `Harnesses`, `Orchestrators`, `Engines`,
`TestCaseGroups`, `Seed`, `Prompt`, `PublishReference`, `CaptureBaselines` and
`Analyze`. A developer iterating on definitions reaches `POST /ingest` by hand or
through `scripts/reingest.sh`.

`crates/cli/src/commands/seed.rs`, `prompt.rs`, `validate.rs` and
`capture_baselines.rs` each build a `TestCaseCatalog` over a private
`catalog_root()` helper reading `TCAB_TEST_CASES_DIR`, and resolve definitions
locally. `commands/run.rs` builds a `LaunchBody` from the slug, version, variant,
harness, model, orchestrator and engine and posts it, so the backend resolves the
definition for a run.

`SeedArgs`, `PromptArgs` and `ValidateArgs` each take `--variant` as a required
flag. A suite's
[test case definition](../../apps/docs/src/content/docs/test-suites/test-case-definition.md)
declares no variants, so the flag cannot stay required for a suite-defined case.

The command surface is documented by
[the CLI overview](../../apps/docs/src/content/docs/components/cli/overview.md),
and the local ingest loop by
[Running](../../apps/docs/src/content/docs/development/running.md).

## Design

### Resolving a suite-defined case

[`suite-catalog-in-core.md`](suite-catalog-in-core.md) gives core one resolution
entry point covering both authored cases and suite-defined ones, and fixes the
identity a caller names: `<suite slug>-<definition file stem>` at the suite
version, carrying the single implicit variant `base`. The catalog-reading
commands resolve through that entry point rather than constructing
`TestCaseCatalog` directly, and the per-command `catalog_root()` helpers collapse
into one shared lookup that finds the suites checkout alongside `test-cases/`.

A suite-defined case and an authored case are named the same way on the command
line, because they share one identity space. An unresolvable name is an error
that names what was asked for.

`--variant` becomes optional on `seed`, `prompt`, `validate` and `run`, and
defaults to `base`. An authored case keeps naming its variant, and naming a
variant a case does not declare is an error.

### Seeding

`tcab seed` against a suite-defined case produces the workspace a run is handed:
the starter workspace the definition's `[workspaces]` table binds to the selected
engine, the rendered specifications under `specs/`, the files an end to end
definition seeds so the model writes only code, and a single clean initial
commit. `--engine` keeps its meaning and is checked against the `engines` the
definition declares before anything is written.

`engines` and `[workspaces]` belong to the code-producing types, so a definition
of an asset-producing type seeds its covered specifications and selects no
engine.

The production seeder stays the one that does the work, so the materialized tree
remains a faithful mirror of what a run mounts. Whatever seeding a suite needs
belongs in core beside the authored path rather than in the command.

### Prompt rendering

`tcab prompt` renders the definition's Handlebars template through the same
renderer a run uses, against the context
[Test Case Definitions](../../apps/docs/src/content/docs/test-suites/test-case-definition.md)
specifies: `workspace`, `engine`, and the `specifications` the definition covers.
Rendering is strict, so a template naming a variable outside that context fails
with the render error. The rendered prompt is the command's entire output.

### Validation

`tcab validate` against a suite-defined case runs the suite's own validators over
the produced tree. The definition's `[build]` install and build commands produce
the static build, and the suite's Vitest project rooted at `validators/` runs in
browser mode against it, which is the pairing
[Validators](../../apps/docs/src/content/docs/test-suites/validators.md)
describes. Requirement outcomes are derived by
[`requirement-outcomes-from-validators.md`](requirement-outcomes-from-validators.md);
this command reports them and decides its exit status from them.

The command exits non-zero when the tree failed the case, and reports every
fault the pass found.

### The ingest command

Add `Command::Ingest`. It posts to the backend's ingest endpoint and carries the
targeting and force options the endpoint accepts, which
[`suite-ingestion.md`](suite-ingestion.md) extends to cover suite versions.
Targets are positional, each a bare id or an `id@version`, and an empty target
list means a whole-checkout scan. `--force` requests the backend-side overwrite
of an already-stored version.

The command sends `Accept: application/x-ndjson` to get the streamed progress
feed the endpoint already offers, prints a line per completed version as it
lands, then closes with a summary of the versions ingested and skipped. A
streamed error line is reported as the command's failure.

The command addresses the backend at `TCAB_BACKEND_URL`, so it works against a
bare-process backend and a port-forwarded cluster through the configuration the
other backend commands read. The ingest endpoint is open, so the command sends no
bearer token.

`scripts/reingest.sh` keeps its mtime-based change detection and its own HTTP
call, so a re-ingest still works in a checkout with no built binary. The CLI
command is the hand-driven path, and `Running` gains it beside the existing curl
invocation.

### Launching a run

`tcab run` accepts a suite-defined case by the same identity, with `--variant`
defaulting to `base`. The backend resolves the definition, so the change is the
argument model and the identity it sends rather than new launch plumbing.

### Out of scope

`tcab capture-baselines` and `tcab publish-reference` stay on authored cases. A
suite decides requirements through its validators and carries no committed
baseline media, so neither command grows a suite path here. Running a
suite-defined case end to end on the cluster belongs to
[`run-a-suite-on-the-local-cluster.md`](run-a-suite-on-the-local-cluster.md).

## Done when

- [ ] The catalog-reading commands resolve a test case through core's single
      resolution entry point, and one shared lookup replaces the per-command
      `catalog_root()` helpers and finds the suites checkout alongside
      `test-cases/`.
- [ ] `--variant` is optional on `seed`, `prompt`, `validate` and `run`,
      defaults to `base`, and naming an undeclared variant is an error.
- [ ] `tcab seed` against a suite-defined case produces a workspace holding the
      starter files for the selected engine, the rendered specifications under
      `specs/`, and the files an end to end definition seeds.
- [ ] `tcab seed` rejects an engine the definition does not declare before
      writing anything.
- [ ] `tcab prompt` against a suite-defined case prints the prompt a run receives
      for the same case and engine, and a template naming a variable outside the
      documented context fails with the render error.
- [ ] `tcab validate` against a suite-defined case runs the definition's build
      commands and the suite's validators over the produced tree, reports each
      assertion result under the requirement that claims it, and exits non-zero
      when the tree failed the case.
- [ ] `tcab ingest` ingests a checkout against the configured backend, accepts
      bare and version-qualified targets plus `--force`, prints per-version
      progress from the streamed feed, and closes with the ingested and skipped
      summary.
- [ ] `tcab ingest` exits non-zero on a streamed error line and on an
      unreachable backend, with the reason on standard error.
- [ ] `tcab run` launches a suite-defined case and the backend resolves its
      definition.
- [ ] The CLI overview documents `ingest` and the optional variant flag, and
      `Running` names the command in the local ingest loop.
- [ ] Gates green.
