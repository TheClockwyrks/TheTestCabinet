# frozen_string_literal: true

module GG
  # Read the skills this run authored.
  #
  # The names available are listed in the system prompt, and an unknown one comes back as
  # `:not_found` carrying the full list.
  module Skills
    extend Surface::Operations

    # Read a skill by name and hand back its body with the front matter stripped.
    #
    # Reading it also pins that body permanently into context, so a skill that has been read stays
    # read.
    #
    # A skill may be code rather than prose, or as well as it. Its code is reached at
    # `lib.<key>` by a program that writes `require "lib"`, and reading the skill opens a
    # documentation view of each function the module declares. An on-use script runs on every read,
    # after the calling program has ended, and whatever it shows arrives on the next turn.
    #
    # @param name [String] The skill's name, as the system prompt lists it.
    # @return [String] the skill's body, with its front matter stripped
    # @raise [GG::Core::ApiError] `:not_found`, listing the skills that do exist, when the name is
    #   unknown.
    def self.read_skill(name)
      Wire.call("read_skill", "skills", "readSkill", [name])
    end
    operation :read_skill, "skills.read_skill", tool: "read_skill"
  end
end
