#!/usr/bin/env bash
# Table test for mirror.sh. Run it directly: scripts/ci/mirror.test.sh
#
# A copy of the script runs in a throwaway git repository with a tag on its
# branch and another on a side branch. `git` is wrapped first on PATH: `push` is
# recorded with the GIT_SSH_COMMAND it would use and never sent, and everything
# else reaches the real git. The subject is the refspecs a branch and a tag push,
# the key handling, and the refs it refuses.
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

readonly MIRROR="git@github.com:TheClockwyrks/TheTestCabinet.git"
real_git="$(command -v git)"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$tmp/bin"
cp "$CI_DIR/mirror.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
git -C "$repo" init --quiet --initial-branch=master
git -C "$repo" add scripts
git -C "$repo" commit --quiet -m first
git -C "$repo" tag v0.1.0
git -C "$repo" commit --quiet --allow-empty -m second
git -C "$repo" tag v0.2.0
git -C "$repo" checkout --quiet -b side
git -C "$repo" commit --quiet --allow-empty -m side
git -C "$repo" tag v9.9.9-side
git -C "$repo" checkout --quiet master

cat >"$tmp/bin/git" <<STUB
#!/usr/bin/env bash
if [[ "\$1" == push ]]; then
	echo "\$*" >>"\$STUB_LOG"
	echo "ssh: \$GIT_SSH_COMMAND" >>"\$STUB_LOG"
	exit "\${STUB_PUSH_EXIT:-0}"
fi
exec "$real_git" "\$@"
STUB
chmod +x "$tmp/bin/git"

run() { # args...
	: >"$tmp/push.log"
	(cd "$tmp" && STUB_LOG="$tmp/push.log" PATH="$tmp/bin:$PATH" "$repo/scripts/ci/mirror.sh" "$@" 2>&1)
}

key="$tmp/key"
printf 'not a real key\n' >"$key"
chmod 644 "$key"

out="$(run "$key" refs/heads/master)"
check_equal "a branch push succeeds" "0" "$?"
check_equal "force-pushes HEAD to the branch with every tag it contains" \
	"push --force $MIRROR HEAD:refs/heads/master refs/tags/v0.1.0:refs/tags/v0.1.0 refs/tags/v0.2.0:refs/tags/v0.2.0" \
	"$(head -1 "$tmp/push.log")"
check_lacks "and no tag it does not contain" "v9.9.9-side" "$(cat "$tmp/push.log")"
check_contains "says how many refs" "(3 refs)" "$out"
check_equal "the key is made private for ssh" "600" "$(stat -c %a "$key")"
ssh_line="$(sed -n 2p "$tmp/push.log")"
check_contains "ssh uses the key alone" "ssh -i '$key' -o IdentitiesOnly=yes" "$ssh_line"
check_contains "and checks GitHub's host key strictly" "-o StrictHostKeyChecking=yes" "$ssh_line"
check_contains "names a known-hosts file of its own" "-o UserKnownHostsFile='/" "$ssh_line"
known_hosts="$(sed -n "s/.*UserKnownHostsFile='\([^']*\)'.*/\1/p" <<<"$ssh_line")"
check_absent "the known-hosts file is removed afterwards" "$known_hosts"

out="$(run "$key" refs/tags/v0.2.0)"
check_equal "a tag push succeeds" "0" "$?"
check_equal "force-pushes that tag alone" \
	"push --force $MIRROR refs/tags/v0.2.0:refs/tags/v0.2.0" "$(head -1 "$tmp/push.log")"

out="$(STUB_PUSH_EXIT=1 run "$key" refs/heads/master)"
check_equal "a refused push fails the step" "1" "$?"

out="$(run "$key" refs/pull/7/merge)"
check_equal "a ref that is neither branch nor tag fails" "1" "$?"
check_contains "naming it" "'refs/pull/7/merge' is neither a branch nor a tag" "$out"
check_equal "and pushes nothing" "" "$(cat "$tmp/push.log")"

out="$(run "$key")"
check_equal "one argument is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/mirror.sh <key-file> <ref>" "$out"

echo
echo "mirror.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
