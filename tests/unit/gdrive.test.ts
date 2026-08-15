import { describe, expect, test } from "bun:test";
import { escapeQueryValue } from "../../src/gdrive.ts";

/**
 * `findFile` interpolates a file name into a single-quoted Drive query and
 * the caller overwrites whatever it returns, so a quote that escapes the
 * literal picks a different file to destroy.
 */
describe("escapeQueryValue", () => {
  test("should leave ordinary names untouched", () => {
    expect(escapeQueryValue("web.txt")).toBe("web.txt");
  });

  test("should escape a quote so it cannot close the literal", () => {
    expect(escapeQueryValue("it's.txt")).toBe("it\\'s.txt");
  });

  test("should escape backslashes before quotes", () => {
    // Escaping the quote first would leave `\\'` — an escaped backslash
    // followed by a live quote
    expect(escapeQueryValue("a\\'b")).toBe("a\\\\\\'b");
  });

  test("should neutralize a name that rewrites the query", () => {
    const name = "x' or name = 'secret.doc";
    const query = `name = '${escapeQueryValue(name)}' and 'root' in parents`;

    // The whole name stays one literal: no bare `'` remains to split it
    expect(query).toBe(
      "name = 'x\\' or name = \\'secret.doc' and 'root' in parents",
    );
  });
});
