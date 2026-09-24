import { resolveDocumentLogicalNets } from "@icm/derived";
import { deriveStableId, powerMarkerContract } from "@icm/model";
import type { ConnectivityEvidence, SchematicDocument } from "@icm/model";

/**
 * Materialize an existing supply identity on each visible marker before a
 * topology operation separates its Base Net. This never invents a supply
 * from artwork, copies source spelling, or changes physical membership.
 * Source-backed ground recovery is restricted to the explicit import boundary.
 */
export function missingPowerMarkerClaims(
  document: SchematicDocument,
  options: { netId?: string; recoverImportedGround?: boolean } = {},
): ConnectivityEvidence[] {
  const resolution = resolveDocumentLogicalNets(document);
  const groundSources = new Set(
    document.connectivityEvidence.flatMap((evidence) =>
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "global-declaration" &&
      evidence.name === "0" &&
      evidence.scope === "global"
        ? [evidence.owner.sourceNetId]
        : [],
    ),
  );
  const claims: ConnectivityEvidence[] = [];
  for (const instance of document.instances) {
    const contract = powerMarkerContract(instance.symbolId);
    if (!contract) continue;
    if (
      document.netlist?.terminals.some((terminal) =>
        terminal.interfaceInstanceIds.includes(instance.id),
      )
    )
      continue;
    if (
      document.connectivityEvidence.some(
        (evidence) =>
          evidence.kind === "name-claim" &&
          evidence.owner.kind === "power-marker" &&
          evidence.owner.objectId === instance.id,
      )
    )
      continue;
    const nets = document.nets.filter((net) =>
      net.terminals.some((terminal) => terminal.instanceId === instance.id),
    );
    if (nets.length !== 1) continue;
    const net = nets[0]!;
    if (options.netId && net.id !== options.netId) continue;
    const logical = resolution.byBaseNetId.get(net.id)!;
    if (logical.conflicts.length > 0) continue;
    let name = logical.name;
    let scope = logical.scope;
    const ground = contract.domain === "ground";
    if (
      ground &&
      contract.canonical &&
      !name &&
      options.recoverImportedGround &&
      logical.powerDomain === "none" &&
      document.connectivityEvidence.some(
        (evidence) =>
          evidence.kind === "spice-source" &&
          evidence.netId === net.id &&
          groundSources.has(evidence.sourceNetId),
      )
    ) {
      name = contract.name;
      scope = contract.scope;
    }
    if (!name || !scope) continue;
    // Ground owns SPICE node `0` itself, so a Ground marker on any other Net
    // is a mistake rather than a rename. A dedicated AGND/DGND rail carries no
    // such fixed node number: it takes whatever ground-side identity the Net
    // already has.
    if (
      ground
        ? logical.powerDomain === "vdd" ||
          (contract.canonical &&
            (name !== contract.name || scope !== contract.scope))
        : logical.powerDomain !== "vdd"
    )
      continue;
    const id = deriveStableId(
      "connectivity-evidence",
      "marker-ownership",
      document.id,
      instance.id,
    );
    // Preserve conflicting user-owned identifiers instead of overwriting them.
    const occupied = [
      document.instances,
      document.nets,
      document.routes,
      document.junctions,
      document.annotations,
      document.connectivityEvidence,
      document.noConnects,
      document.layoutGroups,
      document.constraints,
      document.drafting?.objects ?? [],
    ].some((items) => items.some((item) => item.id === id));
    if (occupied) continue;
    claims.push({
      id,
      kind: "name-claim",
      netId: net.id,
      name,
      scope,
      powerDomain: contract.domain,
      owner: { kind: "power-marker", objectId: instance.id },
    });
  }
  return claims;
}

export function withPowerMarkerOwnership(
  document: SchematicDocument,
): SchematicDocument {
  const claims = missingPowerMarkerClaims(document);
  return claims.length === 0
    ? document
    : {
        ...document,
        connectivityEvidence: [...document.connectivityEvidence, ...claims],
      };
}
