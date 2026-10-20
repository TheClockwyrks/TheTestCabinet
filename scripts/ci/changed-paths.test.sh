#!/usr/bin/env bash
# Table test for changed-paths.sh. Run it directly: scripts/ci/changed-paths.test.sh
#
# A copy of the script runs in a throwaway repository. The classification cases
# feed it a path list through --paths-from; the git cases build a target branch,
# a source branch and their merge commit, the shape a pull request's checkout
# has, and let the script diff them.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got:      ${3:-<empty>}"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

# A throwaway repository holding a copy of the script and a .gitmodules that
# pins six submodules, at `cold-storage`, `contracts`, `engines`, `gg`,
# `test-suites` and `ui-common`.
fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci"
	cp "$CI_DIR/changed-paths.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
	local name
	for name in cold-storage contracts engines gg test-suites ui-common; do
		printf '[submodule "%s"]\n\tpath = %s\n\turl = ../%s\n' "$name" "$name" "$name"
	done >"$repo/.gitmodules"
	printf '%s' "$repo"
}

repo="$(fresh_repo)"

# The two answers the script gave, as `rust=<v> submodules=<v>`.
answers() { # output
	sed -n 's/^##vso\[task.setvariable variable=\([a-z]*\);isOutput=true\]\(true\|false\)$/\1=\2/p' <<<"$1" | paste -sd' '
}

classify() { # paths...
	printf '%s\n' "$@" | (cd "$tmp" && BUILD_REASON=PullRequest "$repo/scripts/ci/changed-paths.sh" --paths-from - 2>&1)
}

echo "--- a run other than a pull request runs everything ---"
for reason in IndividualCI BatchedCI Manual ResourceTrigger ""; do
	out="$(cd "$tmp" && BUILD_REASON="$reason" "$repo/scripts/ci/changed-paths.sh" 2>&1)"
	check_equal "reason '${reason:-unset}' exits 0" "0" "$?"
	check_equal "reason '${reason:-unset}' answers true for every group" \
		"rust=true submodules=true" "$(answers "$out")"
done
out="$(cd "$tmp" && BUILD_REASON=PullRequest "$repo/scripts/ci/changed-paths.sh" --reason BatchedCI 2>&1)"
check_equal "--reason overrides BUILD_REASON" "rust=true submodules=true" "$(answers "$out")"
check_contains "and says why" "not a pull request: BatchedCI" "$out"

echo "--- classification ---"
table() { # label expected paths...
	local label="$1" expected="$2"
	shift 2
	local out
	out="$(classify "$@")"
	check_equal "$label" "$expected" "$(answers "$out")"
}

table "a documentation page reaches nothing" "rust=false submodules=false" \
	apps/docs/src/content/docs/development/building.md
table "a CI script the Rust jobs never run reaches nothing" "rust=false submodules=false" \
	scripts/ci/registry-purge.sh scripts/ci/registry-purge.test.sh scripts/ci/README.md
table "the submodule init helper's test reaches nothing" "rust=false submodules=false" \
	scripts/ci/submodules.test.sh
table "the submodule init helper, which every Rust job runs, reaches the Rust jobs" "rust=true submodules=false" \
	scripts/ci/submodules.sh
table "the web app reaches nothing" "rust=false submodules=false" \
	apps/web/src/main.tsx apps/site/src/index.ts
table "the board, manifests and dotfiles reach nothing" "rust=false submodules=false" \
	tasks/ci/foo.md deployments/k8s/overlays/staging/kustomization.yaml .github/README.md \
	.devcontainer/docker-compose.yml .claude/skills/coding/SKILL.md .vscode/settings.json
table "the gates' own sources reach nothing" "rust=false submodules=false" \
	ci/gates/format.py ci/tests/test_wiring.py ci/pyproject.toml
table "a run-container definition reaches nothing" "rust=false submodules=false" \
	containers/python/Dockerfile containers/build.sh
table "the image names list reaches the Rust jobs" "rust=true submodules=false" \
	containers/image-names.sh
table "Markdown outside crates reaches nothing" "rust=false submodules=false" \
	README.md CLAUDE.md packages/browser-driver/README.md apps/docs/src/content/docs/gg/overview.md
table "Markdown inside crates reaches the Rust jobs" "rust=true submodules=false" \
	crates/driver/README.md
table "a shell test reaches nothing" "rust=false submodules=false" \
	scripts/ci/gg-release.test.sh scripts/devcontainer-setup.test.sh scripts/lib/audio-store.test.mjs
table "lint configuration reaches nothing" "rust=false submodules=false" \
	.cspell/project-words.txt cspell.json .prettierrc.json .prettierignore .markdownlint.yaml \
	eslint.config.mjs .pre-commit-config.yaml Makefile .editorconfig .gitignore .copier-answers.yml LICENSE

table "a crate reaches the Rust jobs" "rust=true submodules=false" \
	crates/backend/src/api.rs
table "the lockfile reaches the Rust jobs" "rust=true submodules=false" Cargo.lock
table "a workspace manifest reaches the Rust jobs" "rust=true submodules=false" Cargo.toml
table "a harness, an orchestrator and a package reach the Rust jobs" "rust=true submodules=false" \
	harnesses/pi/harness.toml orchestrators/one-shot/runner.sh packages/browser-driver/driver.mjs
table "a script a Rust job runs reaches the Rust jobs" "rust=true submodules=false" \
	scripts/ci/provision-node.sh
table "the gg release helper, which only the image jobs run, reaches nothing" \
	"rust=false submodules=false" scripts/ci/gg-release.sh
table "a script with no rule reaches the Rust jobs" "rust=true submodules=false" \
	scripts/vendor-lattice-assets.mjs scripts/lib/siblings.sh scripts/ci/some-new-script.sh
table "a directory with no rule reaches the Rust jobs" "rust=true submodules=false" \
	brand-new-area/thing.txt

table "the release scripts reach the Rust jobs" "rust=true submodules=false" \
	scripts/ci/release-build.sh scripts/ci/binary-smoke.sh scripts/ci/install-nextest.sh \
	scripts/ci/rust-build.sh
table "the build output prune, which the Rust jobs run, reaches them" "rust=true submodules=false" \
	scripts/ci/cargo-target-prune.sh

table "a submodule pin reaches submodule_pins alone" "rust=false submodules=true" cold-storage
table "the contracts pin reaches the Rust jobs and submodule_pins" "rust=true submodules=true" \
	contracts
table "the engines pin reaches the Rust jobs and submodule_pins" "rust=true submodules=true" \
	engines
table "the gg pin reaches the Rust jobs and submodule_pins" "rust=true submodules=true" gg
table "the test-suites pin reaches the Rust jobs and submodule_pins" \
	"rust=true submodules=true" test-suites
table "the ui-common pin reaches the Rust jobs and submodule_pins" \
	"rust=true submodules=true" ui-common
table ".gitmodules reaches submodule_pins alone" "rust=false submodules=true" .gitmodules
table "the pin check reaches submodule_pins alone" "rust=false submodules=true" \
	scripts/ci/submodule-pins.sh

table "the pipeline reaches everything" "rust=true submodules=true" .azure/project/jobs.yml
table "a job template reaches everything" "rust=true submodules=true" \
	.azure/tcab/binary-jobs.yml
table "the release pipeline reaches everything" "rust=true submodules=true" \
	azure-pipelines-release.yml
table "a CI image input reaches everything" "rust=true submodules=true" \
	ci/images/rust.Dockerfile ci/images/tags.yml
table "the toolchain pin reaches everything" "rust=true submodules=true" rust-toolchain.toml
table "this script reaches everything" "rust=true submodules=true" \
	scripts/ci/changed-paths.sh
table "the script library reaches everything" "rust=true submodules=true" \
	scripts/ci/tcab-lib.sh

table "a mixed change is the union" "rust=true submodules=true" \
	apps/docs/src/content/docs/index.md scripts/ci/release-test.sh cold-storage
table "no changed path reaches nothing" "rust=false submodules=false" ""

out="$(classify crates/core/src/lib.rs apps/docs/x.md)"
check_contains "the log names the path that reached a group" "rust       runs (crates/core/src/lib.rs)" "$out"
check_contains "and says when none did" "submodules skipped (no changed path reaches it)" "$out"

echo "--- the diff of a pull request's merge commit ---"
# A repository with a target branch, a source branch that changed a doc and a
# script, and the merge of the source into the target, checked out two deep as
# the job checks a pull request out.
origin="$tmp/origin"
git init --quiet --initial-branch=staging "$origin"
mkdir -p "$origin/scripts/ci" "$origin/apps/docs" "$origin/crates/core/src"
cp "$CI_DIR/changed-paths.sh" "$CI_DIR/tcab-lib.sh" "$origin/scripts/ci/"
echo base >"$origin/apps/docs/page.md"
echo base >"$origin/crates/core/src/lib.rs"
git -C "$origin" add -A
git -C "$origin" commit --quiet -m base
git -C "$origin" checkout --quiet -b feature
echo changed >"$origin/apps/docs/page.md"
git -C "$origin" commit --quiet -am docs
git -C "$origin" checkout --quiet staging
echo moved >"$origin/crates/core/src/lib.rs"
git -C "$origin" commit --quiet -am "target moved on"
git -C "$origin" merge --quiet --no-ff --no-edit feature
git -C "$origin" update-ref refs/pull/1/merge HEAD

checkout="$tmp/checkout"
git init --quiet "$checkout"
git -C "$checkout" fetch --quiet --depth=2 "$origin" refs/pull/1/merge
git -C "$checkout" checkout --quiet FETCH_HEAD

out="$(cd "$checkout" && BUILD_REASON=PullRequest scripts/ci/changed-paths.sh 2>&1)"
check_equal "a merge checkout exits 0" "0" "$?"
check_equal "the diff is the source's change alone" "rust=false submodules=false" "$(answers "$out")"
check_contains "and lists it" "apps/docs/page.md" "$out"
if grep -q "crates/core/src/lib.rs" <<<"$out"; then
	bad "the target's own commits are not in the diff" "got: $out"
else
	ok "the target's own commits are not in the diff"
fi

git -C "$checkout" checkout --quiet 'HEAD^2' 2>/dev/null || git -C "$checkout" checkout --quiet 'HEAD^1'
out="$(cd "$checkout" && BUILD_REASON=PullRequest scripts/ci/changed-paths.sh 2>&1)"
check_equal "a non-merge checkout exits 0" "0" "$?"
check_equal "and runs everything" "rust=true submodules=true" "$(answers "$out")"
check_contains "with a warning" "##vso[task.logissue type=warning]HEAD is not a merge commit" "$out"

echo "--- usage ---"
out="$(cd "$tmp" && "$repo/scripts/ci/changed-paths.sh" --bogus 2>&1)"
check_equal "an unknown flag is a usage error" "2" "$?"
check_contains "and prints the usage" "usage: scripts/ci/changed-paths.sh" "$out"
out="$(cd "$tmp" && "$repo/scripts/ci/changed-paths.sh" --reason 2>&1)"
check_equal "a flag without its value is a usage error" "2" "$?"

echo
echo "changed-paths.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
