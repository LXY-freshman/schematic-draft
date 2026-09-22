import { magneticDisplayParameters } from "@icm/derived";

import type { ComponentPropertyCodeContext } from "./component-property-code";
import { componentDetailFields } from "./component-property-details";
import {
  CANVAS_PROPERTY_FIELDS,
  type CanvasPropertyField,
} from "./component-property-fields";

/**
 * Every authoring field this component actually has, in the order the property
 * code presents them. The code editor decorates these paths and the form draws
 * a control for each, so a field added here reaches both surfaces at once.
 */
export function componentPropertyFields(
  context?: ComponentPropertyCodeContext,
): readonly CanvasPropertyField[] {
  return [
    ...CANVAS_PROPERTY_FIELDS,
    ...(context
      ? magneticDisplayParameters(context.instance.symbolId).map(
          (parameter) => ({
            path: `display.parameters.${parameter.name}`,
            label: parameter.label,
            kind: "boolean" as const,
            description: "",
            help: `Show ${parameter.label} on the canvas`,
          }),
        )
      : []),
    ...(context
      ? componentDetailFields(context.instance, context.details)
      : []),
  ];
}
