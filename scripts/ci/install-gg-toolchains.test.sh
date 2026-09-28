#!/usr/bin/env bash
# Table test for install-gg-toolchains.sh. Run it directly:
# scripts/ci/install-gg-toolchains.test.sh
#
# A copy of the script runs in a throwaway repository whose per-arm installers
# are stubs that record, in order, that they ran and the PATH they ran with,
# with `ruby` and `gem` stubbed and PATH otherwise holding only bash and
# dirname, so no tool of the machine running the test is seen. The subject is
# the order of the eleven arms, YARD's install, the refusal without Ruby, and
# the note when the npm workspaces are not installed.
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

readonly ORDER="install-uv install-rust-wasm install-purescript install-kotlin install-wasi-sdk install-dotnet install-swift install-wit-bindgen install-adapter install-gg-build-tools"
fresh_repo() {
	local repo installer
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-ruby"
	cp "$CI_DIR/install-gg-toolchains.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
	printf 'YARD_VERSION="0.9.37"\n' >"$repo/packages/gg-sandbox-ruby/yard-version.sh"
	for installer in $ORDER; do
		cat >"$repo/scripts/ci/$installer.sh" <<STUB
#!/usr/bin/env bash
echo "$installer PATH=\$PATH" >>"\$STUB_LOG"
[[ "\${STUB_FAIL:-}" == "$installer" ]] && exit 1
exit 0
STUB
		chmod +x "$repo/scripts/ci/$installer.sh"
	done
	printf '%s' "$repo"
}

# Only what the script and its stubs need, so a ruby on this machine is not seen.
mkdir -p "$tmp/min" "$tmp/ruby"
for tool in bash dirname; do
	ln -s "$(command -v "$tool")" "$tmp/min/$tool"
done
cat >"$tmp/ruby/ruby" <<'STUB'
#!/usr/bin/env bash
case "$2" in
	'gem "yard", ARGV[0]') [[ "$3" == "${STUB_YARD_HAVE:-none}" ]] ;;
	'print Gem.user_dir') printf '%s' "/home/someone/.gem/ruby/3.3.0" ;;
	*) exit 1 ;;
esac
STUB
cat >"$tmp/ruby/gem" <<'STUB'
#!/usr/bin/env bash
echo "gem $*" >>"$STUB_LOG"
STUB
chmod +x "$tmp/ruby/ruby" "$tmp/ruby/gem"

run() { # repo path [env...]
	local repo="$1" path="$2"
	shift 2
	: >"$tmp/calls.log"
	(cd "$tmp" && /usr/bin/env -i HOME="$tmp/home" STUB_LOG="$tmp/calls.log" PATH="$path" "$@" \
		"$repo/scripts/ci/install-gg-toolchains.sh" 2>&1)
}
installers() { sed 's/ PATH=.*//' "$tmp/calls.log" | grep -v '^gem ' | tr '\n' ' ' | sed 's/ $//'; }

repo="$(fresh_repo)"
out="$(run "$repo" "$tmp/ruby:$tmp/min")"
check_equal "a full run succeeds" "0" "$?"
check_equal "runs every installer, in order" "$ORDER" "$(installers)"
check_contains "installs the pinned YARD for the user" "gem install --user-install --no-document yard -v 0.9.37" \
	"$(cat "$tmp/calls.log")"
check_contains "after uv and before the rust arm" "install-uv PATH=" "$(head -1 "$tmp/calls.log")"
check_contains "saying where" "Installing yard 0.9.37 -> /home/someone/.gem/ruby/3.3.0" "$out"
check_contains "every installer finds ~/.local/bin first on PATH" \
	"install-gg-build-tools PATH=$tmp/home/.local/bin:" "$(cat "$tmp/calls.log")"
check_contains "and notes that npm ci is still needed" "the npm workspaces are not installed" "$out"
check_contains "ending on the summary" "gg's toolchains are installed" "$out"

mkdir -p "$repo/node_modules/.bin"
printf '#!/bin/sh\n' >"$repo/node_modules/.bin/tsc"
chmod +x "$repo/node_modules/.bin/tsc"
out="$(run "$repo" "$tmp/ruby:$tmp/min" STUB_YARD_HAVE=0.9.37)"
check_equal "a run with YARD and the workspaces in place succeeds" "0" "$?"
check_contains "leaving YARD alone" "yard 0.9.37 already installed" "$out"
check_lacks "without installing a gem" "gem install" "$(cat "$tmp/calls.log")"
check_lacks "and without the npm note" "the npm workspaces are not installed" "$out"

out="$(run "$repo" "$tmp/ruby:$tmp/min" STUB_YARD_HAVE=0.9.36)"
check_contains "another YARD is not accepted" "gem install --user-install --no-document yard -v 0.9.37" \
	"$(cat "$tmp/calls.log")"

out="$(run "$repo" "$tmp/min")"
check_equal "no ruby fails" "1" "$?"
check_contains "saying why" "no \`ruby\` on PATH" "$out"
check_contains "and how to get one" "sudo apt-get install -y ruby" "$out"
check_equal "after uv alone" "install-uv" "$(installers)"

out="$(run "$repo" "$tmp/ruby:$tmp/min" STUB_FAIL=install-swift)"
check_equal "a failed installer fails the run" "1" "$?"
check_equal "and stops there" "install-uv install-rust-wasm install-purescript install-kotlin install-wasi-sdk install-dotnet install-swift" \
	"$(installers)"

echo
echo "install-gg-toolchains.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
