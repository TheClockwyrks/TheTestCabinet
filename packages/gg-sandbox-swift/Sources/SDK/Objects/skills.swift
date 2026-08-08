/// read authored skills
///
/// A skill name is a plain `String` rather than a case of an `enum`, because the catalogue is per run
/// while this SDK is compiled once. The names available are listed in the system prompt, and an
/// unknown one throws `.notFound` carrying the full list.
public enum skills: ApiObject {
    public static let ggObject = "skills"

    /// The gg tools this object dispatches — see `fs.ggTools`.
    static let ggTools = ["read_skill"]

    /// Read a skill by name and hand back its body with the front matter stripped; reading it also
    /// pins that body permanently into your context, so a skill you have read stays read.
    ///
    /// A skill may be **code** rather than prose, or as well as it. If it carries code, reading it
    /// binds that code at `lib.<key>` for the rest of your session and the reply names the key and
    /// what it offers. If it carries an on-use program, gg runs it once your program has ended, and
    /// whatever it shows you arrives on your next turn.
    ///
    /// - Parameter name: The skill's name, as the system prompt lists it.
    /// - Returns: the skill's body, front matter stripped.
    /// - Throws: `ToolError` with `.notFound` — listing the skills that do exist — when the name is
    ///   unknown.
    public static func readSkill(_ name: String) throws -> String {
        try withScratch { scratch in
            var name = scratch.string(name)
            var ret = sandbox_string_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_skills_read_skill(&name, &ret, &err) else {
                throw lift(failure: &err)
            }
            let body = lift(ret)
            sandbox_string_free(&ret)
            return body
        }
    }
}
