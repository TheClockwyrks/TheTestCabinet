// The one thing PureScript cannot see about a thrown value: whether it is one of gg's.
//
// A `ToolError` is a JavaScript `Error` subclass the guest's own SDK threw, carrying `tool`, `code`
// and `message`. `message` is non-enumerable on an `Error`, so this reads the three fields by name
// rather than copying the object — a spread would silently lose the one field that says what went
// wrong.
export const toolErrorImpl = (failure) => {
  if (failure === null || typeof failure !== "object") return null;
  const tool = failure.tool;
  const code = failure.code;
  const message = failure.message;
  if (typeof tool !== "string" || typeof code !== "string" || typeof message !== "string") {
    return null;
  }
  return { tool, code, message };
};
