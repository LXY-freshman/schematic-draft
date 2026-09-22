import { useMemo } from "react";
import type { Annotation } from "@icm/model";
import { AnnotationPropertyCodeEditor } from "./annotation-property-code-editor";
import { AnnotationPropertyForm } from "./annotation-property-form";
import {
  annotationPropertyAdapter,
  annotationPropertyValue,
  parseAnnotationPropertyCode,
  serializeAnnotationPropertyCode,
} from "./annotation-property-code";

export function AnnotationColorProperties({
  annotation,
  inheritedColor,
  onApply,
}: {
  annotation: Annotation;
  inheritedColor: string;
  onApply(annotation: Annotation): { ok: boolean; message?: string };
}) {
  const adapter = useMemo(
    () =>
      annotationPropertyAdapter(
        (source) => parseAnnotationPropertyCode(source, annotation),
        false,
      ),
    [annotation],
  );
  const value = useMemo(
    () => annotationPropertyValue(annotation),
    [annotation],
  );
  const format = (next: Annotation) =>
    serializeAnnotationPropertyCode(annotationPropertyValue(next));
  return (
    <section
      className="property-section annotation-text-properties"
      aria-label="Text properties"
    >
      <AnnotationPropertyForm
        value={value}
        colorLabel="Text"
        parse={(source) => parseAnnotationPropertyCode(source, annotation)}
        onApply={onApply}
        defaultColor={inheritedColor}
        title="Text"
        codeAriaLabel="Text property code"
        contentHint="Double-click the text on the canvas to edit its words."
        code={
          <AnnotationPropertyCodeEditor
            baseline={format(annotation)}
            adapter={adapter}
            parse={(source) => parseAnnotationPropertyCode(source, annotation)}
            format={format}
            onApply={onApply}
            defaultColor={inheritedColor}
            title="JSON"
          />
        }
      />
    </section>
  );
}
