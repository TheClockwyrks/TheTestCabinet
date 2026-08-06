# frozen_string_literal: true

module GG
  # The `skills` family: the authored skill library.
  #
  # A skill name is a plain string rather than a symbol out of a fixed set, because the catalogue is
  # per-run while this component is baked once. The names available are listed in the system
  # prompt, and an unknown one comes back as `:not_found` carrying the full list.
  #
  # @api private
  module Skills
    # Read a skill by name and return its body with the front matter stripped; reading it also pins
    # that body permanently into your context, so a skill you have read stays read.
    #
    # A skill may be **code** rather than prose, or as well as it. If it carries code, reading it
    # binds that code at `lib.<key>` for the rest of your session and the reply names the key and
    # what it offers. If it carries an on-use script, gg runs it once your program has ended, and
    # whatever it shows you arrives on your next turn.
    #
    # @param name [String] The skill's name, as the system prompt lists it.
    # @return [String] the skill's body, with its front matter stripped
    # @raise [ToolError] `:not_found`, listing the skills that do exist, when the name is unknown.
    def self.read_skill(name)
      Wire.call("read_skill", "skills", "readSkill", [name])
    end
  end
end
