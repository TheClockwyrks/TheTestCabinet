alias gg=lazygit

# Forward the host's SSH agent when the devcontainer exposes it (see the
# postStartCommand in devcontainer.json).
if [ -S /tmp/devcontainer-ssh-agent.sock ]; then
	export SSH_AUTH_SOCK=/tmp/devcontainer-ssh-agent.sock
fi
