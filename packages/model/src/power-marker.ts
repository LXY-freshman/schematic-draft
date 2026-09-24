/**
 * The Symbols that carry a supply identity, and the single Net identity each
 * one claims.
 *
 * A power marker is not a device: it prints no netlist card and takes no
 * reference designator, so the Net name underneath it is its entire electrical
 * content. Every layer that touches connectivity needs the same answer to
 * "what does this glyph claim?", which is why the table lives in the model
 * rather than being spelled out again in each planner, projection and
 * extractor.
 *
 * Ground and VDD Power are `canonical`: SPICE node `0` and the supply rail are
 * the default node of their domain. A Ground marker anywhere other than global
 * node `0` is an error rather than a rename, and when a paste has to pick one
 * marker per domain, the canonical one wins. The dedicated analog and digital
 * grounds are ordinary named global rails that happen to have their own glyph:
 * their names are defaults the user may change, and they never displace node
 * `0` when both are drawn.
 */
export interface PowerMarkerContract {
  /** Symbol pin through which the marker claims its Net. */
  readonly pinName: string;
  /** Net name claimed when the marker lands on an unnamed, unclassified Net. */
  readonly name: string;
  readonly domain: "vdd" | "ground";
  readonly scope: "local" | "global";
  /** The domain's default node, rather than one rail among several. */
  readonly canonical: boolean;
}

const POWER_MARKER_CONTRACTS = {
  ground: {
    pinName: "0",
    name: "0",
    domain: "ground",
    scope: "global",
    canonical: true,
  },
  "vdd-port": {
    pinName: "P",
    name: "VDD",
    domain: "vdd",
    scope: "global",
    canonical: true,
  },
  "analog-ground": {
    pinName: "AGND",
    name: "AGND",
    domain: "ground",
    scope: "global",
    canonical: false,
  },
  "digital-ground": {
    pinName: "DGND",
    name: "DGND",
    domain: "ground",
    scope: "global",
    canonical: false,
  },
} as const satisfies Record<string, PowerMarkerContract>;

export type PowerMarkerSymbolId = keyof typeof POWER_MARKER_CONTRACTS;

export const POWER_MARKER_SYMBOL_IDS = Object.keys(
  POWER_MARKER_CONTRACTS,
) as readonly PowerMarkerSymbolId[];

export function powerMarkerContract(
  symbolId: string,
): PowerMarkerContract | undefined {
  return POWER_MARKER_CONTRACTS[symbolId as PowerMarkerSymbolId];
}

export function isPowerMarkerSymbol(
  symbolId: string,
): symbolId is PowerMarkerSymbolId {
  return symbolId in POWER_MARKER_CONTRACTS;
}
