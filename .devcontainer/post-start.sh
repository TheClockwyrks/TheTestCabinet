#!/usr/bin/env bash
# Runs every time the workspace's devcontainer starts, including the first.
#
# What it publishes is a property of the HOST, not of the image, so none of it
# can be baked in at build time: the host's container runtime and the host's SSH
# agent both arrive as bind mounts whose shape is only knowable once the
# container is running. Each of the three scripts below is idempotent and says
# what it did, so a restarted container re-publishes over whatever its previous
# life left behind.
#
# The order matters. tools/host-runtime.sh is what puts a socket at
# /var/run/docker.sock, so tools/docker-socket-access.sh has to follow it to
# have anything to align the permissions of.
#
# The permission alignment is the one failure a start survives. It needs the
# host's own group numbering to line up with this container's, which some hosts
# do not offer; a container whose socket it could not align is still a container
# worth working in, because everything but the host runtime works in it and the
# script has already said what went wrong. A host runtime or an SSH agent that
# fails to publish is not tolerated, because a silent failure there surfaces
# later as a `k3d` or a `git push` that cannot explain itself.
#
# The other is the checkout of the submodules that runs after them,
# tools/submodule-checkout.sh, which follows tools/ssh-agent.sh because it
# clones through the agent that script publishes. post-create.sh runs it once
# at creation, and it runs here again so a container created with no agent, or
# no network, gets contracts/, engines/, gg/, microservice-repos/, tool-sprite/ and
# test-suites/ at its next start. The script
# never fails, and the `|| true` holds that here as well. It stops a checkout
# that outlives its deadline too, so an SSH connection that never answers does
# not hold the start.
set -euo pipefail

bash .devcontainer/tools/host-runtime.sh
bash .devcontainer/tools/docker-socket-access.sh || true
bash .devcontainer/tools/ssh-agent.sh
bash .devcontainer/tools/submodule-checkout.sh || true
