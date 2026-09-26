# Slim the CLI to validation and reference publishing

This issue follows the v0.7.0 tag and is v0.8.0 work. Reduce `tcab` to the
commands that operate on definitions, and route everything run-side through
the web console.

## Current state

`crates/cli/src/cli.rs` declares `run`, `validate`, `register`, `login`,
`logout`, `review`, `publish`, `harnesses`, `orchestrators`, `engines`,
`test-case-groups`, `seed`, `prompt`, `publish-reference`,
`publish-asset-reference`, `capture-baselines`, `ingest` and `analyze`. The
web console is the working surface for runs, reviews and publishing, and the
commands used in practice are the validation commands and the ones that
capture and publish references.

The `binary` job in `azure-pipelines.yml` release-builds and smoke-tests
`tcab`, and the CLI overview page and several quickstarts document the run-side
commands.

## Design

Keep `validate`, `capture-baselines`, `publish-reference`,
`publish-asset-reference`, `ingest`, `seed` and `prompt`. Remove `run`,
`register`, `login`, `logout`, `review`, `publish`, `harnesses`,
`orchestrators`, `engines`, `test-case-groups` and `analyze`, together with the
backend client code paths in core that only those commands use. Credentials
the kept commands need stay where they are.

Rewrite `components/cli/overview.md` to the kept command set, and rewrite every
quickstart and guide that names a removed command to the console route that
replaces it. The `binary` job keeps building and smoke-testing the slim binary.

## Done when

- [ ] `tcab --help` lists exactly the kept commands.
- [ ] Core carries no client code path that only a removed command used.
- [ ] The CLI overview, quickstarts and guides name no removed command.
- [ ] The `binary` job builds and smoke-tests the slim binary.
- [ ] Gates green.
