# shellcheck shell=bash
alias gg=lazygit

# Point the podman *remote* client at the host runtime socket, which
# tools/host-runtime.sh publishes at /var/run/docker.sock. Harmless when the
# host is running Docker instead: only `podman` reads this, and the `docker`
# client already defaults to the same path. The compose file sets the same
# variable for processes that start no shell.
#
# Only when the socket is actually there. A host that offers no runtime at all
# leaves the path empty, and pointing the client at one that does not exist
# turns every `podman` invocation into a connection error that reads like a
# broken daemon rather than a host with nothing to offer.
if [ -S /var/run/docker.sock ]; then
	export CONTAINER_HOST=unix:///var/run/docker.sock
fi

# Forward the host's SSH agent when the devcontainer exposes it (see
# tools/ssh-agent.sh, run from the postStartCommand in devcontainer.json).
if [ -S /tmp/devcontainer-ssh-agent.sock ]; then
	export SSH_AUTH_SOCK=/tmp/devcontainer-ssh-agent.sock
fi
