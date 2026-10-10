#!/usr/bin/env bash
# Table test for mirror.sh. Run it directly: scripts/ci/mirror.test.sh
#
# A copy of the script runs in a throwaway git repository with a tag on its
# branch and another on a side branch. `git` is wrapped first on PATH: `push` is
# recorded with the GIT_SSH_COMMAND it would use and never sent, `ls-remote`
# answers with the mirror's refs a case writes into a file, and everything else
# reaches the real git. The subject is where the target comes from
# (.nyxsis/mirrors.toml or --url), the ancestor guard and its override, the
# refspecs a branch and a tag push, the key handling, and the input it refuses.
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

readonly MIRROR="git@github.com:TheClockwyrks/contracts.git"
real_git="$(command -v git)"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
unset MIRROR_ALLOW_REWRITE

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/.nyxsis" "$tmp/bin"
cp "$CI_DIR/mirror.sh" "$repo/scripts/ci/"
git -C "$repo" init --quiet --initial-branch=master
git -C "$repo" add scripts
git -C "$repo" commit --quiet -m first
git -C "$repo" tag v0.1.0
first="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" commit --quiet --allow-empty -m second
git -C "$repo" tag -a -m "second" v0.2.0
second="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" checkout --quiet -b side
git -C "$repo" commit --quiet --allow-empty -m side
git -C "$repo" tag v9.9.9-side
side="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" checkout --quiet master
v020="$(git -C "$repo" rev-parse refs/tags/v0.2.0)"

cat >"$tmp/bin/git" <<STUB
#!/usr/bin/env bash
case "\$1" in
	push)
		echo "\$*" >>"\$STUB_LOG"
		echo "ssh: \$GIT_SSH_COMMAND" >>"\$STUB_LOG"
		exit "\${STUB_PUSH_EXIT:-0}"
		;;
	ls-remote)
		echo "\$*" >>"\$STUB_LS_LOG"
		[ -f "\$STUB_REMOTE" ] && cat "\$STUB_REMOTE"
		exit "\${STUB_LS_EXIT:-0}"
		;;
esac
exec "$real_git" "\$@"
STUB
chmod +x "$tmp/bin/git"

declare_mirrors() { # url... (none removes the file)
	rm -f "$repo/.nyxsis/mirrors.toml"
	local u
	for u in "$@"; do
		printf '[[mirror]]\nurl = "%s"\n' "$u" >>"$repo/.nyxsis/mirrors.toml"
	done
}

remote_has() { # "<sha> <ref>"... (none: the mirror is empty)
	: >"$tmp/remote"
	local line
	for line in "$@"; do
		printf '%s\t%s\n' "${line%% *}" "${line#* }" >>"$tmp/remote"
	done
}

run() { # args...
	: >"$tmp/push.log"
	: >"$tmp/ls.log"
	(cd "$tmp" && STUB_LOG="$tmp/push.log" STUB_LS_LOG="$tmp/ls.log" STUB_REMOTE="$tmp/remote" \
		PATH="$tmp/bin:$PATH" "$repo/scripts/ci/mirror.sh" "$@" 2>&1)
}

key="$tmp/key"
printf 'not a real key\n' >"$key"
chmod 644 "$key"

declare_mirrors "https://github.com/TheClockwyrks/contracts"
remote_has

echo "target from .nyxsis/mirrors.toml, an empty mirror"
out="$(run "$key" refs/heads/master)"
check_equal "a branch push succeeds" "0" "$?"
check_equal "pushes HEAD to the branch with every tag it contains, over ssh, unforced" \
	"push --atomic $MIRROR HEAD:refs/heads/master refs/tags/v0.1.0:refs/tags/v0.1.0 refs/tags/v0.2.0:refs/tags/v0.2.0" \
	"$(head -1 "$tmp/push.log")"
check_lacks "and no tag it does not contain" "v9.9.9-side" "$(cat "$tmp/push.log")"
check_equal "reads the mirror's refs first" "ls-remote $MIRROR" "$(cat "$tmp/ls.log")"
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
check_equal "pushes that tag alone" \
	"push --atomic $MIRROR refs/tags/v0.2.0:refs/tags/v0.2.0" "$(head -1 "$tmp/push.log")"

echo "the ancestor guard"
remote_has "$first refs/heads/master" "$first refs/tags/v0.1.0" "$v020 refs/tags/v0.2.0" \
	"$second refs/tags/v0.2.0^{}" "$side refs/heads/side"
out="$(run "$key" refs/heads/master)"
check_equal "a mirror behind the new head is pushed" "0" "$?"
check_contains "and the push is made" "HEAD:refs/heads/master" "$(cat "$tmp/push.log")"

remote_has "$second refs/heads/master"
out="$(run "$key" refs/heads/master)"
check_equal "a mirror already at the new head is pushed" "0" "$?"

remote_has "$side refs/heads/master"
out="$(run "$key" refs/heads/master)"
check_equal "a mirror head that is not an ancestor is refused" "1" "$?"
check_contains "naming the mirror's head" "is at $side, which is not an ancestor of $second" "$out"
check_contains "and the override" "--allow-rewrite" "$out"
check_equal "and pushes nothing" "" "$(cat "$tmp/push.log")"

remote_has "$side refs/heads/side"
out="$(run "$key" refs/heads/master)"
check_equal "another branch's head does not count against this one" "0" "$?"

remote_has "0123456789abcdef0123456789abcdef01234567 refs/heads/master"
out="$(run "$key" refs/heads/master)"
check_equal "a mirror head this clone does not hold is refused" "1" "$?"
check_equal "and pushes nothing" "" "$(cat "$tmp/push.log")"

remote_has "$side refs/heads/master"
out="$(run --allow-rewrite "$key" refs/heads/master)"
check_equal "--allow-rewrite pushes over it" "0" "$?"
check_equal "forced" \
	"push --atomic --force $MIRROR HEAD:refs/heads/master refs/tags/v0.1.0:refs/tags/v0.1.0 refs/tags/v0.2.0:refs/tags/v0.2.0" \
	"$(head -1 "$tmp/push.log")"
check_equal "without reading the mirror's refs" "" "$(cat "$tmp/ls.log")"
out="$(MIRROR_ALLOW_REWRITE=true run "$key" refs/heads/master)"
check_equal "MIRROR_ALLOW_REWRITE=true does the same" "0" "$?"
check_contains "forced" "push --atomic --force" "$(cat "$tmp/push.log")"
# shellcheck disable=SC2016 # the literal macro Azure leaves for an unset variable
out="$(MIRROR_ALLOW_REWRITE='$(mirrorAllowRewrite)' run "$key" refs/heads/master)"
check_equal "an unexpanded pipeline variable is not the override" "1" "$?"

remote_has "$first refs/tags/v0.2.0"
out="$(run "$key" refs/heads/master)"
check_equal "a contained tag the mirror holds elsewhere is refused" "1" "$?"
check_contains "naming it" "refs/tags/v0.2.0 names $first, not $v020" "$out"
check_equal "and pushes nothing" "" "$(cat "$tmp/push.log")"
out="$(run "$key" refs/tags/v0.2.0)"
check_equal "as is that tag pushed on its own" "1" "$?"
out="$(run --allow-rewrite "$key" refs/tags/v0.2.0)"
check_equal "unless the override is set" "0" "$?"
check_equal "which forces it" \
	"push --atomic --force $MIRROR refs/tags/v0.2.0:refs/tags/v0.2.0" "$(head -1 "$tmp/push.log")"

remote_has
out="$(STUB_LS_EXIT=128 run "$key" refs/heads/master)"
check_equal "a mirror whose refs cannot be read fails" "1" "$?"
check_equal "and pushes nothing" "" "$(cat "$tmp/push.log")"

out="$(STUB_PUSH_EXIT=1 run "$key" refs/heads/master)"
check_equal "a refused push fails the step" "1" "$?"

echo "where the target comes from"
out="$(run --url git@github.com:theclockwyrks/contracts.git "$key" refs/heads/master)"
check_equal "--url naming the declared mirror in another form is accepted" "0" "$?"
check_contains "and pushed as written" "git@github.com:theclockwyrks/contracts.git HEAD:" \
	"$(cat "$tmp/push.log")"

out="$(run --url https://github.com/TheClockwyrks/Elsewhere "$key" refs/heads/master)"
check_equal "--url naming an undeclared mirror is refused" "1" "$?"
check_contains "saying so" "is not a mirror .nyxsis/mirrors.toml declares" "$out"
check_equal "and pushes nothing" "" "$(cat "$tmp/push.log")"

declare_mirrors "https://github.com/TheClockwyrks/contracts" "https://github.com/TheClockwyrks/Other"
out="$(run "$key" refs/heads/master)"
check_equal "several declared mirrors and no --url is refused" "1" "$?"
check_contains "asking for one" "declares 2 mirrors; name one with --url" "$out"
out="$(run --url https://github.com/TheClockwyrks/Other.git "$key" refs/heads/master)"
check_equal "--url picks one of them" "0" "$?"
check_contains "and pushes there" "git@github.com:TheClockwyrks/Other.git HEAD:" "$(cat "$tmp/push.log")"

declare_mirrors
out="$(run "$key" refs/heads/master)"
check_equal "no file and no --url is no mirror, and succeeds" "0" "$?"
check_contains "saying nothing was pushed" "no mirror configured" "$out"
check_equal "touching nothing" "" "$(cat "$tmp/push.log" "$tmp/ls.log")"

: >"$repo/.nyxsis/mirrors.toml"
out="$(run "$key" refs/heads/master)"
check_equal "an empty file declares none either" "0" "$?"
check_equal "touching nothing" "" "$(cat "$tmp/push.log" "$tmp/ls.log")"

declare_mirrors
out="$(run --url https://github.com/TheClockwyrks/Standalone "$key" refs/heads/master)"
check_equal "with no file, --url alone names the mirror" "0" "$?"
check_contains "pushed over ssh" "git@github.com:TheClockwyrks/Standalone.git HEAD:" "$(cat "$tmp/push.log")"

out="$(run --url https://dev.azure.com/genyume/x/_git/y "$key" refs/heads/master)"
check_equal "a mirror that is not GitHub's is refused" "1" "$?"
check_contains "saying so" "is not a GitHub repository URL" "$out"

printf 'not toml [[\n' >"$repo/.nyxsis/mirrors.toml"
out="$(run "$key" refs/heads/master)"
check_equal "a malformed file fails" "1" "$?"
check_equal "and pushes nothing" "" "$(cat "$tmp/push.log")"
declare_mirrors "https://github.com/TheClockwyrks/contracts"

echo "input it refuses"
out="$(run "$key" refs/pull/7/merge)"
check_equal "a ref that is neither branch nor tag fails" "1" "$?"
check_contains "naming it" "'refs/pull/7/merge' is neither a branch nor a tag" "$out"
check_equal "and pushes nothing" "" "$(cat "$tmp/push.log")"

out="$(run "$key")"
check_equal "one argument is a usage error" "1" "$?"
check_contains "which says how to call it" \
	"usage: scripts/ci/mirror.sh [--url <mirror>] [--allow-rewrite] <key-file> <ref>" "$out"
out="$(run --bogus "$key" refs/heads/master)"
check_equal "an unknown flag is a usage error" "1" "$?"

echo
echo "mirror.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
