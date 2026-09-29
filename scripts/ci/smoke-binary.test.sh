#!/usr/bin/env bash
# Table test for smoke-binary.sh. Run it directly: scripts/ci/smoke-binary.test.sh
#
# Each case hands the script a stub `tcab`, a small script whose --version and
# --help answers the case declares. The subject is the verdict: a binary that
# answers both and lists every checked subcommand passes, and each way of
# falling short fails with a message naming it.
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

# Writes a stub tcab at <path> printing <version> and <help>.
fake_tcab() { # path version help
	cat >"$1" <<STUB
#!/usr/bin/env bash
case "\$1" in
	--version) printf '%s' '$2' ;;
	--help) printf '%s\n' '$3' ;;
esac
STUB
	chmod +x "$1"
}
readonly HELP="Commands: run validate harnesses publish orchestrators help"

run() { "$CI_DIR/smoke-binary.sh" "$@" 2>&1; }

fake_tcab "$tmp/good" "tcab 0.7.0" "$HELP"
out="$(run "$tmp/good")"
check_equal "a sound binary passes" "0" "$?"
check_equal "and says so with its version" "smoke OK: tcab 0.7.0 ($tmp/good)" "$out"

fake_tcab "$tmp/silent" "" "$HELP"
out="$(run "$tmp/silent")"
check_equal "a binary with no version fails" "1" "$?"
check_contains "naming the version" "tcab --version produced no output" "$out"

for missing in run validate harnesses publish orchestrators; do
	fake_tcab "$tmp/no-$missing" "tcab 0.7.0" "${HELP/ $missing / }"
	out="$(run "$tmp/no-$missing")"
	check_equal "a help missing '$missing' fails" "1" "$?"
	check_contains "naming '$missing'" "missing the '$missing' subcommand" "$out"
done

printf 'not a binary\n' >"$tmp/plain"
out="$(run "$tmp/plain")"
check_equal "a file that is not executable fails" "1" "$?"
check_contains "naming it" "not an executable binary: $tmp/plain" "$out"

out="$(run "$tmp/absent")"
check_equal "a path that does not exist fails" "1" "$?"

out="$(run)"
check_equal "no path is a usage error" "2" "$?"
check_contains "which says how to call it" "usage: smoke-binary.sh <path-to-tcab-binary>" "$out"

echo
echo "smoke-binary.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
