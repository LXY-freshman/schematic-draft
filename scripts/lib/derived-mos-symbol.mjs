/** Shared geometry operation; each DMOS still owns a complete component file. */
export function deriveDmosSymbol(base, id, name) {
  if (!base) throw new Error(`Missing Extended Devices base Symbol for ${id}`);
  const baseId = base.id;
  const drainPin = base.pins.find((pin) => pin.name === "D");
  if (!drainPin)
    throw new Error(`Missing drain pin for Expanded Device: ${baseId}`);
  const drainBranch = base.primitives.find(
    (primitive) =>
      primitive.kind === "polyline" &&
      primitive.points.at(-1)?.x === drainPin.at.x &&
      primitive.points.at(-1)?.y === drainPin.at.y,
  );
  if (drainBranch?.kind !== "polyline")
    throw new Error(`Missing drain branch for Expanded Device: ${baseId}`);
  const branchStart = drainBranch.points[0];
  const branchEnd = drainBranch.points[1];
  if (!branchStart || !branchEnd)
    throw new Error(`Invalid drain branch for Expanded Device: ${baseId}`);
  const driftOffset = Math.sign(branchEnd.y - drainPin.at.y) * 4;
  return {
    ...base,
    id,
    name,
    primitives: [
      ...base.primitives,
      {
        kind: "polyline",
        points: [
          { x: branchStart.x, y: branchStart.y + driftOffset },
          { x: branchEnd.x, y: branchEnd.y + driftOffset },
          branchEnd,
        ],
        part: "drift-region",
        style: drainBranch.style,
      },
    ],
    variants: base.variants.map((variant) => ({
      ...variant,
      id:
        variant.id === base.defaultVariantId
          ? "standard-3terminal"
          : variant.id,
    })),
    defaultVariantId: "standard-3terminal",
  };
}

/**
 * Keep the reviewed MOS body, pins, variants, and polarity arrow intact while
 * adding the single continuous depletion-channel mark requested by the user,
 * and start the body lead on that mark instead of behind it.
 */
export function deriveDepletionMosSymbol(base, id, name) {
  if (!base) throw new Error(`Missing depletion-MOS base Symbol for ${id}`);
  const branchYs = base.primitives
    .filter((primitive) => primitive.kind === "polyline")
    .map((primitive) => primitive.points[0]?.y)
    .filter((value) => Number.isFinite(value));
  if (branchYs.length < 2)
    throw new Error(`Missing channel branches for depletion MOS: ${base.id}`);
  const upperY = Math.min(...branchYs);
  const lowerY = Math.max(...branchYs);
  const wireHalfWidth = 0.8;
  // The branch ys are pixel-mapped, so the overhang lands a few ulps off a
  // clean six-decimal coordinate. Symbol geometry is written as literal JSON,
  // where that tail is what a reader sees; quantize it like the generators do.
  const rounded = (value) => Math.round(value * 1_000_000) / 1_000_000;
  // One third of the way back from the NMOS arrow tail (x=1.27907) toward
  // the channel edge (x=-3.662791), matching the approved visual placement.
  const depletionChannelX = -0.368217;
  // The body lead the enhancement MOS inherits runs from the channel edge all
  // the way out to B, which on a depletion part means straight through the
  // middle of the mark that says the device is normally on: the two cross at
  // right angles and the bar reads as cut in half. The body belongs to the
  // channel, so the lead starts on the mark and leaves it in one piece. Its
  // far end, and B itself, do not move.
  const bulkLead = base.primitives.find(
    (primitive) => primitive.part === "bulk-lead",
  );
  if (bulkLead?.kind !== "line")
    throw new Error(`Missing body lead for depletion MOS: ${base.id}`);
  return {
    ...base,
    id,
    name,
    primitives: [
      ...base.primitives.map((primitive) =>
        primitive === bulkLead
          ? { ...primitive, from: { ...primitive.from, x: depletionChannelX } }
          : primitive,
      ),
      {
        kind: "line",
        from: { x: depletionChannelX, y: rounded(upperY - wireHalfWidth) },
        to: { x: depletionChannelX, y: rounded(lowerY + wireHalfWidth) },
        part: "depletion-channel",
        style: {
          strokeRole: "normal",
          lineCap: "butt",
          lineJoin: "miter",
        },
      },
    ],
  };
}
