# ci

The workspace's gates, the runner that executes them, and the metrics read off
their results. It is a [uv](https://docs.astral.sh/uv/) project,
`the-test-cabinet-ci`, built on the Python standard library alone, so a
gate runs on any machine that has uv.

```text
ci/
  gates/<id>.py    one script per gate; the file stem is the gate's id
  images/          the CI images the pipeline runs the gates in
  src/<module>_ci/ the library: process helpers, the runner, the metrics
  tests/           pytest
```

`<module>` is the project's slug written as an identifier, which is the one
name a Python package and an import path both accept.

Every command is run from anywhere inside a checkout and acts on that checkout,
a linked worktree included: the workspace root is the one git reports for the
working directory. A workspace git knows nothing about — a fresh render, before
`git init` makes it a repository — is found instead by the `ci/pyproject.toml`
at its top, which is what lets `make gate` run in one.

```sh
uv run --quiet --project ci gate list
uv run --quiet --project ci gate run ci-tests
uv run --quiet --project ci gate run --all --keep-going
```

Inside a linked worktree, `--project` takes the path of that worktree's `ci/`.

## Gates

A gate is a standalone script that exits 0 when it passes. Its id is its file
stem, in lowercase letters, digits and hyphens, and that id is what a hook, a
pipeline step and an issue name the check by.

```python
"""Fail when clippy reports anything, warnings denied.

The rest of the docstring is for whoever reads the script.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

enter_repo_root()

clippy = ["cargo", "clippy", "--locked", "--workspace", "--all-targets"]
if not succeeded([*clippy, "--", "-D", "warnings"]):
    fail("", "clippy found issues. Fix them, then commit again.")
```

- The first line of the module docstring is the gate's description.
  `gate list` reads it from the source with `ast`, so listing the gates runs
  none of them and works where a gate's tools are absent.
- `enter_repo_root()` makes the repository root the working directory. The
  other helpers in [`proc`](src/the_test_cabinet_ci/proc.py) run a tool
  (`run`, `succeeded`), run a command in another uv project's environment
  (`uv_project`), and end the gate (`fail`, `skip`).
- `git()` is the only way this project runs git, in the library, in a gate and
  in the tests alike. It removes the variables that point git at another
  repository (`GIT_DIR`, `GIT_INDEX_FILE` and the rest of
  `GIT_LOCATION_VARIABLES`) from the child's environment: git exports those to
  every hook, a hook's children inherit them, and they beat the working
  directory, so a gate started from a commit hook would otherwise read — and
  could write — the repository being committed to rather than the checkout it
  entered. `tests/test_gitrun.py` greps the project for a `["git", …]` command
  built anywhere else and fails on what it finds.
- A file under `gates/` whose stem is shaped otherwise, such as `_shared.py`,
  is a helper and stays out of the list.
- A gate is also runnable alone: `uv run --project ci python ci/gates/<id>.py`.

### Artifacts

When `CI_GATE_ARTIFACTS` names a directory, a gate that runs tests writes its
machine-readable results there in the test tool's native format:

| File | Format | Written by |
| --- | --- | --- |
| `junit.xml` | JUnit | every gate that runs tests |
| `coverage-summary.json` | istanbul `json-summary` | TypeScript gates |
| `lcov.info` | lcov | TypeScript gates whose runner writes lcov |

`artifacts_dir()` returns that directory, created, or `None`. With the variable
unset a gate writes no report and collects no coverage, which keeps a commit
hook at the cost of the check alone.

Under `gate run --report-dir` the directory is the gate's own folder in the
report, which also holds its `output.log`. A gate adds files to it and leaves
what it finds there alone.

A gate's test tool has to label each case with something that tells it apart
from every other case in the run, because the metrics key a test
`<gate>::<classname>::<name>` and a repeated key is read as a retry. nextest
labels a case with its crate and test binary, and pytest with its module and
class, so both are already distinct; a vitest project that runs one file under
several instances needs a `classnameTemplate` that names the instance, or the
instances become one test and the figures of all but one disappear.

### Adding a gate

Write `ci/gates/<id>.py` in the shape above, putting the reason for each
non-obvious step beside it: the script is the one place the gate is explained.
A gate that runs tests asks `artifacts_dir()` where its report goes and passes
that on to its test tool. Then run it with
`uv run --quiet --project ci gate run <id>`.

The hooks, the pipeline's steps and the lists of gates are rendered by the
template, so a gate is wired into them by answering it rather than by editing
them: add it to the `extra_gates` answer, with its id, its name, the track its
step runs on, whether it has a hook and the files that fire the hook, and run
`copier update`. `ci/tests/test_wiring.py` holds the scripts, the hooks and the
steps to one another. A gate too slow for a commit is answered with no hook,
and `rust-test` and `rust-doctest` are given none by answering `rust_test_hook`
no; each then runs in `make gate` and the pipeline only.

The project's own gates, as answered:

| Id | Name | Track | Hook |
| --- | --- | --- | --- |
| `frozen-paths` | frozen test-case versions | web | yes |
| `seeded-contract` | seeded contract vocabulary | web | yes |
| `spec-vocabulary` | seeded spec vocabulary | web | yes |
| `spec-prose` | spec prose (markdownlint, cspell) | web | yes |
| `audio-packs` | audio pack declarations | web | yes |
| `build-context` | Dockerfile build contexts | web | yes |
| `k8s-deploy-sets` | kubernetes deploy sets | web | yes |
| `ci-image-pins` | project jobs pin the Rust CI image | web | yes |
| `scripts-test` | script library tests (node --test) | web | yes |
| `file-endings` | file endings outside frozen versions | web | no |
| `workspace-test` | npm workspace tests (vitest) | web | no |
| `validators-typecheck` | validator projects typecheck (tsc) | web | no |
| `site-build` | gallery build (vite build) | web | no |
| `contract-drift` | generated contract drift | rust | no |

One check, one id: the id is the unit a hook, a pipeline step and an issue all
name, so a check that shares an id with another cannot be reported on alone.

## `gate`

```text
gate list [--json]
gate run <id>... [--all] [--keep-going]
         [--report-dir DIR [--baseline METRICS.json]]
```

`gate list --json` prints `[{"id": "...", "description": "..."}]`, sorted by
id.

`gate run` runs the gates one after another in the order given. Every id is
checked before the first gate starts, and an unknown one is a usage error whose
message names the known ids.

Without `--report-dir` each gate's output streams to the terminal and the run
stops at the first failure, or continues past it with `--keep-going`. This is
the form a hook and a person use.

With `--report-dir DIR` the run prints nothing of any gate's output, and every
gate runs whatever the ones before it did. Each gate has one folder in the
report, named after it, which holds its combined stdout and stderr as
`output.log` and is the `CI_GATE_ARTIFACTS` it writes its results to:

```text
DIR/
  SUMMARY.md  results.json  metrics.json  compare.json
  <id>/output.log  <id>/junit.xml  <id>/coverage-summary.json …
```

Once the gates have run, the run collects their figures into `metrics.json`
itself. With `--baseline` it compares them with that metrics file, at the
default thresholds, into `compare.json`. It always ends by writing
`SUMMARY.md`. `--baseline` is read before the first gate starts, and a file
that is not a metrics file is a usage error.

`DIR/results.json` is written, and printed as the run's only output:

```json
{
  "ok": false,
  "report_dir": "/abs/DIR",
  "root": "/abs/checkout",
  "gates": [
    {
      "id": "ci-tests",
      "ok": false,
      "exit_code": 1,
      "seconds": 4.2,
      "log": "/abs/DIR/ci-tests/output.log",
      "artifacts": "/abs/DIR/ci-tests"
    }
  ],
  "summary": "/abs/DIR/SUMMARY.md",
  "metrics": "/abs/DIR/metrics.json",
  "compare": "/abs/DIR/compare.json"
}
```

`compare` is present when the run had a baseline.

This is the form a pipeline and a workflow use: it points a reader at the
summary and at a failed gate's folder, and keeps the output itself out of every
prompt.

### `SUMMARY.md`

The summary is what a reviewer reads first, in a minute:

- the overall result, and a table of the gates with each one's status,
  duration, tests run and failed, and the path of its log;
- for each failed gate, the names of its failing tests, the first ten with the
  count of all of them, or its exit code when no JUnit report names one;
- under "Worth a look", each gate or test the comparison lists as slower and
  each coverage decrease, with the baseline's figure beside the run's, the
  first twenty of each with the count;
- the paths of `results.json`, `metrics.json` and `compare.json`, which hold
  everything in full.

It never holds a gate's output. It is plain Markdown with no frontmatter that
passes this workspace's markdownlint configuration, and the same inputs always
give the same text.

The child environment is the caller's plus `CI_GATE_ARTIFACTS`. A report's logs
are plain text for `grep` and `tail`: the run sets `NO_COLOR` and
`CARGO_TERM_COLOR=never` and drops the variables that force color. A caller
that runs gates in several worktrees at once sets `CARGO_TARGET_DIR` for each.

| Exit code | Meaning |
| --- | --- |
| 0 | every gate passed |
| 1 | a gate failed |
| 2 | usage error: an unknown id, no id, an unreadable baseline, or a working directory outside a checkout |

## `metrics`

```text
metrics collect REPORT_DIR [-o FILE]
metrics compare BASE.json HEAD.json [--ratio 1.5] [--min-seconds 1.0]
                                     [--coverage-epsilon 0.1] [-o FILE]
metrics summary REPORT_DIR [--baseline METRICS.json]
```

`gate run --report-dir` runs all three itself. The commands serve a report that
is already there: figures written somewhere else, a comparison at other
thresholds, a summary against another baseline.

`collect` reads a report directory's `results.json` and the folder of every
gate it lists, and writes the figures: each gate's seconds and verdict, each
test keyed `<gate>::<classname>::<name>` with its seconds and status, and each
gate's coverage as percentages for the whole and per file. A case reported more
than once, such as a test a runner retried, keeps its longest duration and its
worst status. Coverage comes from `coverage-summary.json` when the gate wrote
one and from `lcov.info` otherwise, with paths relative to the repository root
so that figures from a worktree compare with figures from the main checkout.

`compare` prints, and with `-o` also writes, what changed for the worse between
two metrics files. A test or a gate is slower when `head >= --min-seconds` and
`head >= base * --ratio`; the floor keeps the jitter of a fast test out.
Coverage is listed when a metric fell by more than `--coverage-epsilon`
percentage points. Anything with no baseline, a new test or a new file, is
never listed, and both lists are sorted worst first. It exits 0 whenever it
could compare: the lists are input for a reviewer, who decides whether the
change justifies them.

`summary` writes a report directory's `metrics.json` and `SUMMARY.md` again
from what the gates left in it, and prints the summary's path. With
`--baseline` it compares with that file and writes `compare.json`; without, the
summary keeps the comparison the directory already holds. `results.json` stays
as the run wrote it.

## Tests

```sh
uv run --project ci pytest ci
uv run --quiet --project ci gate run ci-tests
```

The `ci` argument is what points pytest at this project's configuration when
the command is run from the repository root.
