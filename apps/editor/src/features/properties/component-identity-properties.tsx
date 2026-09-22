import type { SchematicDocument } from "@icm/model";
import { deviceDescriptor } from "@icm/devices";

import type { CapacitorPlatePropertyRow } from "./capacitor-plate-properties";
import type { ComponentSourceCode } from "./component-source-code";

type Instance = SchematicDocument["instances"][number];

export function componentTargetDescription(
  instance: Instance,
  internalCellName?: string,
  externalSubcircuitName?: string,
): string | null {
  const binding = instance.netlist?.binding;
  if (
    !binding &&
    deviceDescriptor(instance.symbolId)?.targetPolicy === "builtin"
  ) {
    return null;
  }
  switch (binding?.kind) {
    case "primitive":
      return null;
    case "subcircuit":
      return `Internal Cell: ${internalCellName ?? "unresolved"}`;
    case "external-subcircuit":
      return `External subcircuit: ${externalSubcircuitName ?? "unresolved"}`;
    case "unresolved-subcircuit":
      return `Unresolved subcircuit: ${binding.name}`;
    default:
      return "No target is bound yet.";
  }
}

/**
 * The electrical facts a component carries outside its property code: plate
 * and property-only terminals, and the SPICE line it would emit. Placement,
 * identity, parameters and appearance belong to the property form.
 */
export function ComponentIdentityProperties({
  capacitorPlateRows,
  propertyTerminal,
  sourceCode,
}: {
  capacitorPlateRows: readonly CapacitorPlatePropertyRow[] | null;
  propertyTerminal?: {
    label: string;
    pinName: string;
    netId: string | null;
    options: readonly { netId: string; label: string }[];
    onChange: (netId: string | null) => void;
  } | null;
  sourceCode: ComponentSourceCode;
}) {
  return (
    <>
      {capacitorPlateRows ? (
        <div
          className="property-card property-terminal-card"
          role="group"
          aria-label="Capacitor plate terminals"
        >
          <div className="property-section-heading">Electrical terminals</div>
          <dl className="component-readonly-fields">
            {capacitorPlateRows.map((row) => (
              <div key={row.role}>
                <dt>{row.label}</dt>
                <dd aria-label={`${row.label} terminal`}>
                  Pin {row.pinName} ·{" "}
                  {row.netName ?? row.netId ?? "Unconnected"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {propertyTerminal ? (
        <div
          className="property-card property-terminal-card"
          role="group"
          aria-label="Property-only electrical terminals"
        >
          <div className="property-section-heading">Electrical terminals</div>
          <label>
            {propertyTerminal.label}
            <select
              aria-label={propertyTerminal.label}
              value={propertyTerminal.netId ?? ""}
              onChange={(event) =>
                propertyTerminal.onChange(event.currentTarget.value || null)
              }
            >
              <option value="">Unconnected</option>
              {propertyTerminal.options.map((option) => (
                <option value={option.netId} key={option.netId}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>Property-only terminal · no canvas pin or wire</small>
          </label>
        </div>
      ) : null}
      <div
        className="component-source-code"
        aria-label="SPICE component code"
        data-exact={sourceCode.exact}
      >
        <code>{sourceCode.code}</code>
        {sourceCode.note ? <small>{sourceCode.note}</small> : null}
      </div>
    </>
  );
}
