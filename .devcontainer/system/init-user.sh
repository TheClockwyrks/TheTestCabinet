#!/usr/bin/env bash
set -euo pipefail

: "${USERNAME:?USERNAME must be set}"
: "${USER_UID:?USER_UID must be set}"
: "${USER_GID:?USER_GID must be set}"
: "${DOCKER_GID:?DOCKER_GID must be set}"

# Ubuntu 23.04+ images may include a default `ubuntu` user with UID 1000.
# Remove it only when it would conflict with the requested devcontainer user.
if [[ "${USERNAME}" != "ubuntu" ]] && id -u ubuntu >/dev/null 2>&1; then
	UBUNTU_UID="$(id -u ubuntu)"

	if [[ "${UBUNTU_UID}" == "${USER_UID}" ]]; then
		userdel -r ubuntu 2>/dev/null || userdel ubuntu
	fi
fi

# Resolve or create the primary group by numeric GID. On Debian/Ubuntu, GID 100
# is commonly the existing `users` group, so this must not blindly call groupadd.
USER_GROUP="$(getent group "${USER_GID}" | cut -d: -f1 || true)"

if [[ -z "${USER_GROUP}" ]]; then
	if getent group "${USERNAME}" >/dev/null 2>&1; then
		EXISTING_USERNAME_GID="$(getent group "${USERNAME}" | cut -d: -f3)"

		if [[ "${EXISTING_USERNAME_GID}" != "${USER_GID}" ]]; then
			echo "Group '${USERNAME}' already exists with GID ${EXISTING_USERNAME_GID}, expected ${USER_GID}" >&2
			exit 1
		fi

		USER_GROUP="${USERNAME}"
	else
		groupadd --gid "${USER_GID}" "${USERNAME}"
		USER_GROUP="${USERNAME}"
	fi
fi

# Avoid silently creating a user if the requested UID is already owned by a
# different account.
EXISTING_USER_WITH_UID="$(getent passwd "${USER_UID}" | cut -d: -f1 || true)"

if [[ -n "${EXISTING_USER_WITH_UID}" && "${EXISTING_USER_WITH_UID}" != "${USERNAME}" ]]; then
	echo "UID ${USER_UID} is already used by '${EXISTING_USER_WITH_UID}', expected '${USERNAME}'" >&2
	exit 1
fi

# Create or update the devcontainer user.
if id -u "${USERNAME}" >/dev/null 2>&1; then
	usermod --uid "${USER_UID}" --gid "${USER_GROUP}" --shell /bin/bash "${USERNAME}"
	mkdir -p "/home/${USERNAME}"
else
	useradd \
		--uid "${USER_UID}" \
		--gid "${USER_GROUP}" \
		--create-home \
		--shell /bin/bash \
		"${USERNAME}"
fi

# Passwordless sudo for the devcontainer user.
printf '%s ALL=(root) NOPASSWD:ALL\n' "${USERNAME}" > "/etc/sudoers.d/${USERNAME}"
chmod 0440 "/etc/sudoers.d/${USERNAME}"

# Create or reuse the group with the Docker/Podman socket GID, then add the user.
# The group name does not matter; the numeric GID is what controls socket access.
# This only takes effect if a runtime socket is mounted into the container; see
# .devcontainer/README.md.
DOCKER_GROUP="$(getent group "${DOCKER_GID}" | cut -d: -f1 || true)"

if [[ -z "${DOCKER_GROUP}" ]]; then
	if getent group docker >/dev/null 2>&1; then
		DOCKER_GROUP="docker_${DOCKER_GID}"
	else
		DOCKER_GROUP="docker"
	fi

	groupadd --gid "${DOCKER_GID}" "${DOCKER_GROUP}"
fi

usermod --append --groups "${DOCKER_GROUP}" "${USERNAME}"

# Initialize shell config and fix ownership.
cp /etc/skel/.bashrc "/home/${USERNAME}/.bashrc"
chown -R "${USER_UID}:${USER_GID}" "/home/${USERNAME}"
