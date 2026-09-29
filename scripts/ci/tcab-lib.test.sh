#!/usr/bin/env bash
# Table test for tcab-lib.sh, the project's helper its own CI scripts source.
# Run it directly: scripts/ci/tcab-lib.test.sh
#
# Each case sources a copy of the library inside a throwaway repository and
# calls one helper, with `uname` stubbed first on PATH where the case needs a
# given machine. The subjects are that sourcing it moves to the repository root,
# the registry it names, the architecture names, and the manifest index and
# namespace assertion the deploy scripts rest on.
#
# The snippets are single-quoted on purpose: the bash that sourced the library
# expands them.
# shellcheck disable=SC2016
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

check_lacks() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected no output containing: $2" "got: ${3:-<empty>}"
	else
		ok "$1"
	fi
}

check_exists() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		ok "$1"
	else
		bad "$1" "expected $2 to exist"
	fi
}

check_absent() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		bad "$1" "expected $2 to be gone"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/bin" "$repo/elsewhere"
cp "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$repo/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "$STUB_UNAME_M"
STUB
chmod +x "$repo/bin/uname"

# Runs <snippet> in a fresh bash that sourced the library from <repo>/elsewhere.
in_lib() { # snippet [uname -m]
	(cd "$repo/elsewhere" && STUB_UNAME_M="${2:-x86_64}" PATH="$repo/bin:$PATH" bash -c '
		set -euo pipefail
		# shellcheck source=/dev/null
		source "$1/scripts/ci/tcab-lib.sh"
		eval "$2"
	' _ "$repo" "$1" 2>&1)
}

echo "--- sourcing it ---"
check_equal "moves to the repository root" "$repo" "$(in_lib pwd)"
check_equal "names the repository root" "$repo" "$(in_lib 'echo "$REPO_ROOT"')"
check_equal "names its own directory" "$repo/scripts/ci" "$(in_lib 'echo "$CI_LIB_DIR"')"
check_equal "exports the registry" "testcabinet.azurecr.io" "$(in_lib 'bash -c "echo \$CI_REGISTRY"')"
check_contains "log prints a labelled step" "==> building the thing" "$(in_lib 'log building the thing')"

echo "--- ci_arch ---"
check_equal "x86_64 is amd64" amd64 "$(in_lib ci_arch x86_64)"
check_equal "amd64 is amd64" amd64 "$(in_lib ci_arch amd64)"
check_equal "aarch64 is arm64" arm64 "$(in_lib ci_arch aarch64)"
check_equal "arm64 is arm64" arm64 "$(in_lib ci_arch arm64)"
out="$(in_lib ci_arch riscv64)"
status=$?
check_equal "another machine fails" 1 "$status"
check_contains "and names it" "unsupported architecture 'riscv64'" "$out"

echo "--- ci_manifest_index ---"
cat >"$tmp/stream.yaml" <<'YAML'
apiVersion: v1
kind: Namespace
metadata:
  name: tcab-staging
---
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    name: not-the-name
  name: tcab-dispatcher
  namespace: tcab-staging
spec:
  template:
    metadata:
      name: nested-is-ignored
---
apiVersion: v1
kind: "Service"
metadata:
  name: 'tcab-web'
  namespace: "tcab-staging"
YAML
index="$(cd "$repo/elsewhere" && bash -c 'source "$1/scripts/ci/tcab-lib.sh"; ci_manifest_index <"$2"' _ "$repo" "$tmp/stream.yaml")"
check_equal "one line per object, quotes dropped, - for no namespace" \
	"Namespace - tcab-staging
Deployment tcab-staging tcab-dispatcher
Service tcab-staging tcab-web" "$index"

echo "--- ci_assert_namespaced ---"
assert() { # namespace file
	(cd "$repo/elsewhere" && bash -c 'source "$1/scripts/ci/tcab-lib.sh"; ci_assert_namespaced "$2" <"$3"' \
		_ "$repo" "$1" "$2" 2>&1)
}
sed '1,5d' "$tmp/stream.yaml" >"$tmp/namespaced.yaml"
out="$(assert tcab-staging "$tmp/namespaced.yaml")"
check_equal "objects all in the namespace pass" "0:" "$?:$out"
out="$(assert tcab-prod "$tmp/namespaced.yaml")"
status=$?
check_equal "objects in another namespace fail" 1 "$status"
check_contains "and each is named" "outside tcab-prod: Deployment/tcab-dispatcher (namespace tcab-staging)" "$out"
check_contains "every one of them" "outside tcab-prod: Service/tcab-web (namespace tcab-staging)" "$out"
out="$(assert tcab-staging "$tmp/stream.yaml")"
status=$?
check_equal "a cluster-scoped kind fails" 1 "$status"
check_contains "and is named as cluster-scoped" "cluster-scoped: Namespace/tcab-staging" "$out"
check_lacks "and not also as outside the namespace" "outside tcab-staging: Namespace" "$out"

echo
echo "tcab-lib.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
