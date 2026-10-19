#!/usr/bin/env bash
# Table test for smoke-binary.sh. Run it directly: scripts/ci/smoke-binary.test.sh
#
# Each case hands the script a stub `tcab`, a small script whose --version and
# --help answers the case declares. The subject is the verdict: a binary that
# answers both, lists every documented subcommand and none of the removed ones
# passes, and each way of falling short fails with a message naming it.
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
# The help in clap's shape: a command per line under `Commands:`, a blank line
# after the list.
help_listing() { # command...
	printf 'The Test Cabinet\n\nUsage: tcab <COMMAND>\n\nCommands:\n'
	for command in "$@"; do
		printf '  %-24s %s\n' "$command" "What $command does"
	done
	printf '\nOptions:\n  -h, --help     Print help\n'
}
readonly DOCUMENTED=(validate seed prompt publish-reference publish-asset-reference
	capture-baselines ingest analyze)
readonly REMOVED=(run review publish harnesses orchestrators engines test-case-groups)
HELP="$(help_listing "${DOCUMENTED[@]}" help)"
readonly HELP

run() { "$CI_DIR/smoke-binary.sh" "$@" 2>&1; }

fake_tcab "$tmp/good" "tcab 0.7.0" "$HELP"
out="$(run "$tmp/good")"
check_equal "a sound binary passes" "0" "$?"
check_equal "and says so with its version" "smoke OK: tcab 0.7.0 ($tmp/good)" "$out"

fake_tcab "$tmp/silent" "" "$HELP"
out="$(run "$tmp/silent")"
check_equal "a binary with no version fails" "1" "$?"
check_contains "naming the version" "tcab --version produced no output" "$out"

for missing in "${DOCUMENTED[@]}"; do
	kept=()
	for command in "${DOCUMENTED[@]}"; do
		[ "$command" = "$missing" ] || kept+=("$command")
	done
	fake_tcab "$tmp/no-$missing" "tcab 0.7.0" "$(help_listing "${kept[@]}" help)"
	out="$(run "$tmp/no-$missing")"
	check_equal "a help missing '$missing' fails" "1" "$?"
	check_contains "naming '$missing'" "missing the '$missing' subcommand" "$out"
done

for removed in "${REMOVED[@]}"; do
	fake_tcab "$tmp/with-$removed" "tcab 0.7.0" "$(help_listing "${DOCUMENTED[@]}" "$removed" help)"
	out="$(run "$tmp/with-$removed")"
	check_equal "a help still listing '$removed' fails" "1" "$?"
	check_contains "naming '$removed'" "still lists the removed '$removed' subcommand" "$out"
done

# A documented name only mentioned in prose is not a listed command, and the
# whole-name match keeps `publish-reference` from passing for `publish`.
fake_tcab "$tmp/prose" "tcab 0.7.0" \
	"$(help_listing seed prompt publish-reference publish-asset-reference capture-baselines ingest analyze)
validate is mentioned here"
out="$(run "$tmp/prose")"
check_equal "a name outside the command list does not count" "1" "$?"
check_contains "so the unlisted one is missing" "missing the 'validate' subcommand" "$out"

fake_tcab "$tmp/crlf" "tcab 0.7.0" "$(help_listing "${DOCUMENTED[@]}" help | sed 's/$/\r/')"
out="$(run "$tmp/crlf")"
check_equal "a help with Windows line endings passes" "0" "$?"

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
