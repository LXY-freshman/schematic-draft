import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { libraryProjectExamples } from "../../examples/library-examples";
import { ExamplesPanel } from "./examples-panel";

describe("ExamplesPanel", () => {
  it("does not resolve or render example projects while closed", () => {
    const reads = libraryProjectExamples.map((example) =>
      vi.spyOn(example, "project", "get").mockImplementation(() => {
        throw new Error("closed panel read a project");
      }),
    );
    try {
      const markup = renderToStaticMarkup(
        createElement(ExamplesPanel, {
          open: false,
          onOpenExample: () => undefined,
        }),
      );
      expect(markup).not.toContain("<svg");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
    } finally {
      reads.forEach((read) => read.mockRestore());
    }
  });
  it("presents every bundled example outside the Library device panel", () => {
    const markup = renderToStaticMarkup(
      createElement(ExamplesPanel, {
        open: true,
        onOpenExample: () => undefined,
      }),
    );

    expect(markup).toContain('data-testid="examples-panel"');
    expect(markup).toContain("<svg");
    expect(markup).not.toContain('data-testid="shapes-fold-library"');
    expect(markup.match(/data-testid="shapes-example-/g)).toHaveLength(
      libraryProjectExamples.length,
    );
    for (const example of libraryProjectExamples) {
      expect(markup).toContain(`data-testid="shapes-example-${example.id}"`);
      expect(markup).toContain(example.name);
    }
  });

  it("previews each circuit rather than only naming it", () => {
    const markup = renderToStaticMarkup(
      createElement(ExamplesPanel, {
        open: true,
        onOpenExample: () => undefined,
      }),
    );

    // A name and a sentence do not tell you whether a circuit is the one you
    // want to borrow from, so every card carries the circuit itself.
    expect(markup).toContain('class="shapes-example-preview"');
    expect(markup).toContain("<svg");
  });
});
