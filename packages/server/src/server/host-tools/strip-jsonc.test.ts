import { describe, expect, it } from "vitest";
import { stripJsoncComments } from "./strip-jsonc.js";

describe("stripJsoncComments", () => {
  it("strips line comments", () => {
    const input = `{
  // this is a comment
  "key": "value"
}`;
    const result = stripJsoncComments(input);
    expect(result).toBe('{\n  \n  "key": "value"\n}');
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("strips block comments", () => {
    const input = `{
  /* block comment */
  "key": "value"
}`;
    const result = stripJsoncComments(input);
    expect(result).toBe('{\n  \n  "key": "value"\n}');
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("strips multi-line block comments", () => {
    const input = `{
  /* multi
     line */
  "key": "value"
}`;
    const result = stripJsoncComments(input);
    expect(result).toBe('{\n  \n  "key": "value"\n}');
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("does NOT strip // inside a string literal", () => {
    const input = `{
  "url": "https://example.com//path"
}`;
    const result = stripJsoncComments(input);
    expect(result).toBe(input);
    expect(JSON.parse(result)).toEqual({ url: "https://example.com//path" });
  });

  it("handles escaped quotes inside strings", () => {
    const input = `{
  "message": "hello \\"world\\" // not a comment"
}`;
    const result = stripJsoncComments(input);
    expect(result).toBe(input);
    expect(JSON.parse(result)).toEqual({ message: 'hello "world" // not a comment' });
  });

  it("passes through text with no comments", () => {
    const input = `{"key": "value"}`;
    const result = stripJsoncComments(input);
    expect(result).toBe(input);
  });

  it("handles empty input", () => {
    expect(stripJsoncComments("")).toBe("");
  });

  it("does not strip // inside single-quoted strings", () => {
    // Single-quoted strings are valid JSONC but not valid JSON.
    // We verify the comment is preserved, then check manually.
    const input = `  'hello // not a comment'`;
    const result = stripJsoncComments(input);
    expect(result).toBe(input);
  });

  it("handles // after block comment on same line", () => {
    const input = `{"key": "value"} /* block */ // line`;
    const result = stripJsoncComments(input);
    // Block comment leaves a space, line comment leaves nothing (no trailing newline in input)
    expect(result).toBe('{"key": "value"}  ');
    expect(JSON.parse(result.trim())).toEqual({ key: "value" });
  });
});
