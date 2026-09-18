import { StreamLanguage, type StreamParser } from "@codemirror/language";

interface State {
  control: boolean;
  head: boolean;
}
/** Display tokens only; nothing here inspects the netlist semantically. */
const parser: StreamParser<State> = {
  name: "ngspice",
  startState: () => ({ control: false, head: true }),
  token(stream, state) {
    if (stream.sol()) state.head = true;
    if (stream.eatSpace()) return null;
    if (
      (state.head && stream.peek() === "*") ||
      stream.match(/^(?:\$|;|\/\/)/u)
    ) {
      stream.skipToEnd();
      return "comment";
    }
    const atHead = state.head;
    state.head = false;
    if (stream.match(/^\.control\b/iu)) {
      state.control = true;
      return "keyword";
    }
    if (stream.match(/^\.endc\b/iu)) {
      state.control = false;
      return "keyword";
    }
    if (stream.match(/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/u))
      return "string";
    if (
      stream.match(
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmunpfa])?\b/iu,
      )
    )
      return "number";
    if (stream.match(/^\.[a-z][\w]*/iu)) return "keyword";
    const word = stream.match(/^[a-z_][\w.:]*/iu);
    if (word) {
      if (atHead) return state.control ? "keyword" : "typeName";
      return stream.match(/^\s*=/u, false) ? "propertyName" : "variableName";
    }
    if (stream.match(/^[{}()[\]]/u)) return "bracket";
    if (stream.match(/^[=+*/^<>!-]/u)) return "operator";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "*" } },
};
export const spiceCodeLanguage = StreamLanguage.define(parser);
