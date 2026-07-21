/**
 * strip-jsonc.ts — strips `//` line comments and `/* * /` block comments
 * from JSONC text so it can be parsed by `JSON.parse`. Does not handle
 * comments inside string literals specially (opencode.jsonc in practice
 * does not put `//` inside string values that would false-trigger).
 */
export function stripJsoncComments(raw: string): string {
  // Strip block comments /* ... */
  let out = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip line comments // ... with string-state awareness
  out = stripLineComments(out);
  return out;
}

function stripLineComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      result += ch;
      if (ch === "\\") {
        // escape next char
        if (i + 1 < text.length) {
          result += text[i + 1];
          i += 2;
          continue;
        }
      } else if (ch === stringChar) {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      // skip to end of line
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}
