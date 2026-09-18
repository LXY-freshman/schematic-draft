import { useMemo, useRef } from "react";

import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import {
  libraryProjectExamples,
  type LibraryProjectExample,
} from "../../examples/library-examples";

export interface ExamplesPanelProps {
  open: boolean;
  onOpenExample(example: LibraryProjectExample): void;
}

/**
 * The bundled example circuits, docked beside the canvas. Every card carries a
 * preview of the circuit itself: a name and a sentence do not tell you whether
 * a circuit is the one you want to borrow from.
 */
export function ExamplesPanel({ open, onOpenExample }: ExamplesPanelProps) {
  const previewCache = useRef<Map<string, string> | null>(null);
  const bundledPreviews = useMemo(() => {
    if (!open) return new Map<string, string>();
    if (previewCache.current) return previewCache.current;
    return (previewCache.current = new Map(
      libraryProjectExamples.map((example) => {
        const topDocument = example.project.documents.find(
          (candidate) => candidate.id === example.project.topDocumentId,
        )!;
        // A Cell instance draws with artwork derived from the Project, not
        // from the built-in library, so the preview needs the same
        // Project-aware resolver the canvas uses.
        return [
          example.id,
          renderDocumentSvg(
            topDocument,
            createProjectSymbolResolver(example.project, builtInSymbols),
          ),
        ];
      }),
    ));
  }, [open]);

  return (
    <aside
      id="examples-panel"
      className={
        open ? "shapes-panel examples-panel" : "shapes-panel collapsed"
      }
      aria-label="Examples"
      aria-hidden={!open}
      inert={!open ? true : undefined}
      data-testid="examples-panel"
      data-open={open ? "true" : "false"}
    >
      <div className="shapes-panel-body">
        {/* Columns follow the panel's dragged width, the same way the Library
            tiles do; a separate control for the same thing is one knob too
            many. */}
        <div className="shapes-example-list">
          {libraryProjectExamples.map((example) => (
            <button
              key={example.id}
              type="button"
              className="shapes-example-card"
              data-testid={`shapes-example-${example.id}`}
              aria-label={`Insert example ${example.name}`}
              title={`Insert ${example.name}`}
              onClick={() => onOpenExample(example)}
            >
              <span
                className="shapes-example-preview"
                // Server-free preview: our own renderer's escaped output.
                dangerouslySetInnerHTML={{
                  __html: bundledPreviews.get(example.id) ?? "",
                }}
              />
              <span className="shapes-example-copy">
                <span className="shapes-example-kicker">Example</span>
                <span className="shapes-example-name">{example.name}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
