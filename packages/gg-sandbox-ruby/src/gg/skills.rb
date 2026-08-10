# frozen_string_literal: true

module GG
  # Read the skills this run authored.
  #
  # A skill name is a plain string rather than one of a fixed set, because the catalogue is per run
  # while this component is baked once. The names available are listed in the system prompt, and an
  # unknown one comes back as `:not_found` carrying the full list.
  module Skills
    extend Surface::Operations

    # Read a skill by name and hand back its body with the front matter stripped.
    #
    # Reading it also pins that body permanently into context, so a skill that has been read stays
    # read.
    #
    # A skill may be **code** rather than prose, or as well as it. Code is bound at `lib.<key>` for
    # the rest of the session and the reply names the key and what it offers. An on-use script runs
    # once the calling program has ended, and whatever it shows arrives on the next turn.
    #
    # @param name [String] The skill's name, as the system prompt lists it.
    # @return [String] the skill's body, with its front matter stripped
    # @raise [GG::Core::ToolError] `:not_found`, listing the skills that do exist, when the name is
    #   unknown.
    def self.read_skill(name)
      Wire.call("read_skill", "skills", "readSkill", [name])
    end
    operation :read_skill, "skills.read_skill", tool: "read_skill"
  end
end
