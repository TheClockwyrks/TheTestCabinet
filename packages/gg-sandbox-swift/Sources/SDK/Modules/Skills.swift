/// Read the skills this run authored.
///
/// A skill name is a plain `String` rather than a case of an `enum`, because the catalogue is per
/// run while this SDK is compiled once. The names available are listed in the system prompt, and an
/// unknown one comes back as `.notFound` carrying the full list.
///
/// - ggmodule: skills
public enum skills {
    /// The gg tools this module dispatches — see `files.ggOperations`.
    static let ggOperations = ["read_skill"]

    /// Read a skill by name and hand back its body with the front matter stripped.
    ///
    /// Reading it also pins that body permanently into context, so a skill that has been read stays
    /// read.
    ///
    /// A skill may be code rather than prose, or as well as it. Code is bound at `lib.<key>` for the
    /// rest of the session and the reply names the key and what it offers. An on-use program runs
    /// once this program has ended, and whatever it shows arrives on the next turn.
    ///
    /// - Parameter name: The skill's name, as the system prompt lists it.
    /// - Returns: the skill's body, front matter stripped.
    /// - Throws: `core.ApiError` with `.notFound` — listing the skills that do exist — when the
    ///   name is unknown.
    /// - ggop: skills.read_skill
    public static func readSkill(_ name: String) throws -> String {
        try withScratch { scratch in
            var name = scratch.string(name)
            var ret = sandbox_string_t()
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_skills_read_skill(&name, &ret, &err) else {
                throw lift(failure: &err)
            }
            let body = lift(ret)
            sandbox_string_free(&ret)
            return body
        }
    }
}
