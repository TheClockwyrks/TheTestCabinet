// The one thing PureScript cannot see about a thrown value: whether it is one of gg's.
//
// An `ApiError` is a JavaScript `Error` subclass the guest's own SDK threw, carrying `operation`,
// `code` and `message`. `message` is non-enumerable on an `Error`, so this reads the three fields by
// name rather than copying the object — a spread would silently lose the one field that says what
// went wrong.
export const apiErrorImpl = (failure) => {
  if (failure === null || typeof failure !== "object") return null;
  const operation = failure.operation;
  const code = failure.code;
  const message = failure.message;
  if (
    typeof operation !== "string" ||
    typeof code !== "string" ||
    typeof message !== "string"
  ) {
    return null;
  }
  return { operation, code, message };
};
