---
title: "Saved agents"
---

An [agent profile](/gg/configurations/#agents) can be authored on its own and
imported into any number of configurations. A saved agent is one profile held on
the account under its own name, so a reviewer used by four configurations is
authored once and edited in one place.

A saved agent holds one profile's configuration and nothing more. Memories,
skills and every other per-agent store belong to the run that creates them, so
each run gets its own — exactly as it does for a profile declared inline. The
run's ceilings and its session hooks belong to the configuration, which is what
a run is launched from.

## Registering one

Account → gg Agents lists the saved agents on the signed-in account. Creating
or editing one opens the same per-agent view a configuration opens, alongside:

- a one-line note saying what the agent is for, shown wherever the library is
  listed;
- the model slots its bindings defer to, since the configuration that runs the
  agent is what names a slot.

The agent's own name is the library's name for it. The library assigns each
saved agent an id of its own, which is what an importing configuration points
at, so renaming one carries every import along with it. Duplicate seeds a new
saved agent from an existing one.

## Importing one

A configuration's Agents tab declares a profile in either of two ways. Add agent
declares a fresh one inline, which belongs to that configuration alone. Import
agent picks a saved one, and the resulting profile:

- mints a [profile id](/gg/configurations/#identity) of its own, derived from
  the saved agent's;
- takes the saved agent's name as its display text, suffixed only when another
  profile in the configuration already shows it, so the operator's list stays
  legible;
- declares any model slot its bindings name that the configuration does not
  already have, taking the default recorded with the saved agent;
- carries the saved agent's references to itself onto the id it arrives under.

An imported profile is marked as such on the configuration's agent list, beside
the name of the saved agent it follows. Save to library does the reverse for a
profile declared inline: it writes that profile to the library and leaves the
configuration following it.

## Overriding one

Editing an imported profile edits the configuration's copy. Edits land on that
copy alone, and each field the configuration edits becomes an override pinned to
that configuration. Every field left alone follows the saved agent, so editing a
saved agent reshapes each configuration that imported it.

Overrides are recorded per field, with each capability its own field. Editing
the compaction capability on one configuration's copy leaves that
configuration's compaction settings fixed while the agent's prompt, roster and
every other capability keep following the saved agent.

The [call allowlist](/gg/configurations/#granting-calls) is one field. A
configuration that pins it decides which calls its copy grants for good,
including for a capability the saved agent switches on later.

Two controls end the link. Revert drops the overrides, returning the profile to
the saved agent as it stands, under the name the configuration gave it. Detach
keeps the profile exactly as it is and stops it following anything, turning it
into an ordinary inline profile. Deleting a saved agent detaches every profile
that followed it, which leaves those configurations unchanged.

## Resolution

A configuration is stored and launched with every agent written out in full. gg
reads a capability set whose agents are already whole, so the console resolves
each import first: the saved agent, then the configuration's overrides on top.

An import is a live reference: that resolution runs whenever a configuration is
read. A configuration launched after its saved agent changed carries the new
version of every field it does not override.

## Storage

Saved agents are per-account and private, stored by the backend:

| Endpoint                 | Purpose               |
| ------------------------ | --------------------- |
| `GET /gg/agents`         | The account's agents. |
| `POST /gg/agents`        | Save one.             |
| `PUT /gg/agents/{id}`    | Update one in place.  |
| `DELETE /gg/agents/{id}` | Delete one.           |

A configuration records the saved agent each of its profiles follows and the
fields it overrides, beside the resolved capability set itself.
