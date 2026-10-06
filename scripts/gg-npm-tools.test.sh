#!/usr/bin/env bash
# Table test for gg-npm-tools.sh. Run it directly: scripts/gg-npm-tools.test.sh
#
# The resolver is sourced against a throwaway copy of itself whose lock
# directory holds one tool, and `npm` is a stub that records how it was run and
# unpacks nothing but the directory the presence check looks for. The subject is
# the directory a tool resolves to — stamped with its version and its lock's
# digest, under each of the three roots — that a cold prefix is an `npm ci` of
# the committed lock and a warm one is left alone, and that a missing lock or
# one naming another version is refused before anything is installed.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPTS_DIR
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

# A copy of the resolver beside a lock directory of this test's own, so the
# repository's real locks play no part.
mkdir -p "$tmp/scripts/gg-npm-locks/scope-tool-1.2.3" "$tmp/bin" "$tmp/home"
cp "$SCRIPTS_DIR/gg-npm-tools.sh" "$tmp/scripts/"
cat >"$tmp/scripts/gg-npm-locks/scope-tool-1.2.3/package.json" <<'EOF'
{
  "name": "scope-tool-1.2.3",
  "private": true,
  "dependencies": {
    "@scope/tool": "1.2.3"
  }
}
EOF
printf '{"name":"scope-tool-1.2.3","lockfileVersion":3}\n' >"$tmp/scripts/gg-npm-locks/scope-tool-1.2.3/package-lock.json"
digest="$(sha256sum "$tmp/scripts/gg-npm-locks/scope-tool-1.2.3/package-lock.json")"
digest="${digest:0:8}"
readonly digest

# The npm stub: it records its arguments and the files in the prefix it was
# given, then creates the package directory the presence check looks for.
cat >"$tmp/bin/npm" <<'EOF'
#!/usr/bin/env bash
prefix=""
for ((i = 1; i <= $#; i++)); do
	[ "${!i}" = "--prefix" ] && j=$((i + 1)) && prefix="${!j}"
done
echo "npm $* [files=$(cd "$prefix" && echo *)]" >>"$STUB_LOG"
mkdir -p "$prefix/node_modules/@scope/tool"
EOF
chmod +x "$tmp/bin/npm"

run() { # [VAR=value...] function args...
	local env=()
	while [ $# -gt 0 ] && [[ "$1" == *=* ]]; do
		env+=("$1")
		shift
	done
	: >"$tmp/calls.log"
	# shellcheck disable=SC2016  # the script sources the resolver by the path it is handed
	(cd "$tmp" && /usr/bin/env -i HOME="$tmp/home" STUB_LOG="$tmp/calls.log" \
		PATH="$tmp/bin:$(dirname "$(command -v node)"):/usr/bin:/bin" "${env[@]}" bash -c \
		'set -euo pipefail; source "$0/scripts/gg-npm-tools.sh"; "$@"' "$tmp" "$@" 2>&1)
}

expected_dir="$tmp/home/.local/share/tcab/gg-npm/scope-tool-1.2.3-$digest"
out="$(run gg_npm_tool @scope/tool 1.2.3)"
check_equal "a cold tool resolves" "0" "$?"
check_contains "to the user prefix, stamped with the version and the lock's digest" "$expected_dir" "$out"
check_equal "installed with npm ci from the lock's two files, and nothing else" \
	"npm ci --silent --no-audit --no-fund --prefix $expected_dir [files=package-lock.json package.json]" \
	"$(cat "$tmp/calls.log")"
check_contains "saying so" "==> installing @scope/tool@1.2.3 -> $expected_dir" "$out"

out="$(run gg_npm_tool @scope/tool 1.2.3)"
check_equal "a warm tool resolves" "0" "$?"
check_equal "without running npm" "" "$(cat "$tmp/calls.log")"
check_equal "to the same directory" "$expected_dir" "$out"

out="$(run TCAB_GG_NPM_PREFIX="$tmp/staged" gg_npm_tool_dir @scope/tool 1.2.3)"
check_equal "an operator's prefix wins, under the same stamp" "$tmp/staged/scope-tool-1.2.3-$digest" "$out"

out="$(run GG_NPM_INSTALL_DIR="$tmp/elsewhere" gg_npm_tool_dir @scope/tool 1.2.3)"
check_equal "GG_NPM_INSTALL_DIR moves the user prefix" "$tmp/elsewhere/scope-tool-1.2.3-$digest" "$out"

printf '{"name":"scope-tool-1.2.3","lockfileVersion":3,"packages":{}}\n' >"$tmp/scripts/gg-npm-locks/scope-tool-1.2.3/package-lock.json"
out="$(run gg_npm_tool_dir @scope/tool 1.2.3)"
check_equal "a re-resolved lock is a new stamp" "1" "$([ "$out" != "$expected_dir" ] && echo 1)"

out="$(run gg_npm_tool @scope/tool 9.9.9)"
check_equal "a pin with no lock fails" "1" "$?"
check_contains "naming the directory it wanted" "@scope/tool@9.9.9 has no lock under scripts/gg-npm-locks/" "$out"
check_equal "before anything is installed" "" "$(cat "$tmp/calls.log")"

mkdir -p "$tmp/scripts/gg-npm-locks/scope-tool-2.0.0"
cp "$tmp/scripts/gg-npm-locks/scope-tool-1.2.3/"* "$tmp/scripts/gg-npm-locks/scope-tool-2.0.0/"
out="$(run gg_npm_tool @scope/tool 2.0.0)"
check_equal "a lock naming another version fails" "1" "$?"
check_contains "saying which" "pins @scope/tool at '1.2.3', not 2.0.0" "$out"
check_equal "before anything is installed" "" "$(cat "$tmp/calls.log")"

echo
echo "gg-npm-tools.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
