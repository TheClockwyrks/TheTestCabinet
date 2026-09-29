"""Lint and spell-check the test-case, game-jam and group prose at commit time.

The template's `markdownlint` and `cspell` gates cover every Markdown file in CI,
but their hooks fire only for documentation paths, so a commit that touches a
spec would reach CI unchecked. This gate is the spec trees' own hook, and it
also covers what the template's cspell never reads:

- markdownlint-cli2 over `test-cases/`, `game-jams/` and `test-case-groups/`
  Markdown, with `--no-globs` so the rendered `.markdownlint-cli2.yaml` supplies
  the rules and the ignores but not its whole-tree globs;
- cspell under `.cspell/specs.json`, which adds the specs' `.html`, `.css`,
  `.toml` and `.hbs` files to their Markdown and shares the project dictionary.

Both run the workspace's own locked tools, as the template's prose gates do.
"""

import os

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run, say

root = enter_repo_root()

for tool in ("markdownlint-cli2", "cspell"):
    if not os.access(root / "node_modules" / ".bin" / tool, os.X_OK):
        fail(f"{tool} is not installed. Install the npm workspace first:", "    npm ci")

SPEC_MARKDOWN = ["test-cases/**/*.md", "game-jams/**/*.md", "test-case-groups/**/*.md"]

# Both run whatever the first one found, so one run names every problem.
lint = run(["npx", "--no-install", "markdownlint-cli2", "--no-globs", *SPEC_MARKDOWN], unset=GIT_LOCATION_VARIABLES)
spell = run(
    ["npx", "--no-install", "cspell", "lint", "--no-progress", "--config", ".cspell/specs.json"],
    unset=GIT_LOCATION_VARIABLES,
)

problems = []
if lint.returncode != 0:
    problems.append("markdownlint found issues in the spec Markdown above. Fix them, then commit again.")
if spell.returncode != 0:
    problems.append(
        "cspell found unknown words in the specs above. Fix the typo, or, if the word is a real "
        "domain term, add it to .cspell/project-words.txt."
    )
if problems:
    fail("", *problems)
say("The spec prose is lint-clean and spelled with known words.")
