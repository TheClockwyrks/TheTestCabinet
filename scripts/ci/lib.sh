# Shared helpers for the CI scripts under scripts/ci/.
#
# Sourced (not executed) by each script. It resolves the repository root from
# this file's own location and changes into it, so every CI script behaves
# identically regardless of the directory it is invoked from. Both the Azure
# DevOps pipeline and the GitHub workflows call these scripts, so keeping the
# real commands here keeps the two CI systems running exactly the same checks.

# Resolve the repo root two levels up from scripts/ci/ and work from there.
CI_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CI_LIB_DIR/../.." && pwd)"
readonly CI_LIB_DIR REPO_ROOT
cd "$REPO_ROOT"

# Print a labelled step header so the CI logs are easy to scan.
log() {
	printf '\n\033[1;34m==> %s\033[0m\n' "$*"
}
