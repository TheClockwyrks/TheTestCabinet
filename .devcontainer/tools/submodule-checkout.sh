#!/usr/bin/env bash
# Checks out the submodules the workspace builds against over SSH, through the
# host's agent that tools/ssh-agent.sh publishes. The submodules named as
# arguments are checked out, and with none named, `contracts`, `engines`, `gg`,
# `microservice-repos`, `tool-model-core`, `tool-sprite` and `test-suites`:
# contracts/ and engines/ hold the crates and packages every build compiles against, and the npm
# workspace lists their packages, so `npm ci` needs them populated; gg/,
# microservice-repos/, tool-model-core/ and tool-sprite/ hold the crates the
# patch table names, and cargo loads every patch path, so every build under the superrepo needs them populated; gg/ holds the documentation
# site's gg pages too; test-suites/ is the suites checkout The Test Cabinet
# ingests from.
# cold-storage/ beside them is optional and about 2 GB, so it is left to a
# `git submodule update --init cold-storage` by hand.
#
# Run from post-create.sh, ahead of `npm ci`, and from post-start.sh, so a
# container created with no agent or no network gets its checkout at the next
# start. Both run it after tools/ssh-agent.sh, because the clone goes through
# the agent that script publishes.
#
# Never fails the step it runs from: a host with no agent, or no network, keeps
# a working container, and `git submodule update --init contracts engines gg microservice-repos tool-model-core tool-sprite test-suites`
# (or this script) checks them out once it has one. A checkout with no
# .gitmodules has nothing to check out and is left alone. Idempotent: a
# submodule already checked out is left where it is.
#
# Never stops to ask either. The submodules' repositories are reached at
# ssh.dev.azure.com, and a container's first clone of one would stop at ssh's
# interactive host-key prompt, which nothing is there to answer, so Azure
# DevOps' published RSA host key is pinned in ~/.ssh/known_hosts before the
# clone, and ssh is run in BatchMode, which answers no prompt at all.
#
# Never holds the step either. A connection can stall where it cannot fail: an
# agent whose key waits on an approval nobody is there to give, which answers
# `ssh-add -l` and never signs, or a network that accepts the connection and
# carries nothing. A submodule already cloned is then fetched without a word, so
# the step would stop with nothing said, for as long as whatever is creating or
# starting the container waits. The checkout is therefore given a deadline,
# SUBMODULE_CHECKOUT_TIMEOUT seconds where the environment states a positive
# whole number and DEFAULT_DEADLINE where it does not, and one that outlives it
# is stopped and reported like any other failure.
set -uo pipefail

# How long the checkout runs for, in seconds, where the environment states no
# deadline of its own. contracts, engines, gg, microservice-repos, tool-model-core,
# tool-sprite and test-suites are a few megabytes each and clone in seconds; the deadline is for a connection that never answers.
readonly DEFAULT_DEADLINE=120

# How long a checkout told to stop is given to do so before it is killed.
readonly KILL_AFTER=10

# What the checkout connects with. BatchMode answers no prompt, ConnectTimeout
# bounds a connection that is never accepted or never greeted, and the
# ServerAlive options end one that goes quiet once it is up.
readonly SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2'

# Azure DevOps' published RSA host key
# (SHA256:ohD8VZEXGWo6Ez8GSEJQ9WpafgLFsOfLOtGGQCQo6Og), pinned so the first
# clone does not stop at an interactive host-key prompt.
readonly HOST_KEY='ssh.dev.azure.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7Hr1oTWqNqOlzGJOfGJ4NakVyIzf1rXYd4d7wo6jBlkLvCA4odBlL0mDUyZ0/QUfTTqeu+tm22gOsv+VrVTMk6vwRU75gY/y9ut5Mb3bR5BV58dKXyq9A9UeB5Cakehn5Zgm6x1mKoVyf+FFn26iYqXJRgzIZZcZ5V6hrE0Qg39kZm4az48o0AUbf6Sp4SLdvnuMa2sVNwHBboS7EJkm57XQPVU3/QpyNLHbWDdzwtrlS+ez30S3AdYhLKEOxAG8weOnyrtLJAUen9mTkol8oII1edf7mWWbWVf0nBmly21+nZcmCTISQBtdcyPaEno7fFQMDD26/s0lfKob4Kw8H'

cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 0
if [ ! -f .gitmodules ]; then
	echo 'no .gitmodules; no submodule to check out'
	exit 0
fi

submodules=("$@")
if [ "${#submodules[@]}" -eq 0 ]; then
	submodules=(contracts engines gg microservice-repos tool-model-core tool-sprite test-suites)
fi

if mkdir -p "${HOME}/.ssh" && chmod 700 "${HOME}/.ssh"; then
	known_hosts="${HOME}/.ssh/known_hosts"
	if ! grep -qsF "${HOST_KEY}" "${known_hosts}"; then
		printf '%s\n' "${HOST_KEY}" >>"${known_hosts}" ||
			echo "could not pin the Azure DevOps host key in ${known_hosts}"
	fi
else
	echo "could not create ${HOME}/.ssh to pin the Azure DevOps host key in"
fi

# post-create.sh and post-start.sh run without system/.bashrc, which is what
# exports this.
if [ -z "${SSH_AUTH_SOCK:-}" ] && [ -S /tmp/devcontainer-ssh-agent.sock ]; then
	export SSH_AUTH_SOCK=/tmp/devcontainer-ssh-agent.sock
fi

deadline="${SUBMODULE_CHECKOUT_TIMEOUT:-}"
if ! [[ "$deadline" =~ ^[1-9][0-9]*$ ]]; then
	if [ -n "$deadline" ]; then
		echo "SUBMODULE_CHECKOUT_TIMEOUT is '${deadline}', not a positive whole number of seconds; using ${DEFAULT_DEADLINE}"
	fi
	deadline="$DEFAULT_DEADLINE"
fi

# Said first, because a fetch of a submodule already cloned prints nothing
# until it ends.
echo "checking out ${submodules[*]} over SSH, for at most ${deadline}s"

# `timeout` signals the whole process group it starts, so the ssh under git is
# stopped with it, and stdin is closed so nothing in that group stops to read
# the terminal the step runs on.
GIT_SSH_COMMAND="$SSH_COMMAND" \
	timeout --kill-after="$KILL_AFTER" "$deadline" git submodule update --init -- "${submodules[@]}" </dev/null
status=$?

manual="run 'git submodule update --init ${submodules[*]}' once SSH works"

# 124 is `timeout` ending the checkout, and 137 is it killing one that would not
# end.
case "$status" in
	0) echo "${submodules[*]} checked out" ;;
	124 | 137)
		echo "submodule checkout did not finish within ${deadline}s and was stopped; SSH reached no answer, which is a key waiting on an approval or a connection carrying nothing"
		echo "$manual"
		;;
	*) echo "submodule checkout failed; contracts/, engines/, gg/, microservice-repos/, tool-model-core/ and tool-sprite/ are build inputs and test-suites/ the suites checkout The Test Cabinet ingests; ${manual}" ;;
esac
exit 0
