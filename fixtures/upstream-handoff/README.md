# Upstream handoff: frozen Project samples

Sample `.schdraft` Projects for the Analog Canvas team, answering the acceptance
list in their [issue #1003](https://github.com/cascode-ai/analog-canvas/issues/1003)
(`03-integration-plan.md` §4 and `02-target-architecture.md` §7): a file from
before the fork, a file for each field the fork added, an empty Project, a
hierarchical circuit, split analog/digital grounds, the new power devices, the
four-terminal body variant, and a file whose origin cannot be determined from
its bytes.

[`manifest.json`](manifest.json) is the machine-readable index: one entry per
sample, with its schema version, the exact JSON paths of any fork fields it
carries, and the divergence it demonstrates.

Everything here is a synthetic textbook circuit. No real design work appears in
any of them.

## How these files were made

Each sample was generated at the current schema version by
[`scripts/generate-upstream-handoff.mjs`](../../scripts/generate-upstream-handoff.mjs),
then **opened, corrected and saved in the real Windows shell** before being
frozen. So the bytes are a normal product save — the same serializer, the same
canonical key order, the same two-space indent — of a drawing a person actually
edited, not a JSON blob a script assembled. Sample 09 in particular looks the
way it does because the reviewer redrew both body ties by hand.

The generator's `--finalize` pass then stamped the historical version numbers,
rendered the previews and wrote the manifest. It has no `--check` drift gate on
purpose: these files are frozen artefacts containing hand corrections, and a
byte-comparison gate would force them to be regenerated — and the corrections
lost — at the next schema bump. What holds them honest is
[`packages/project-protocol/src/upstream-handoff-samples.test.ts`](../../packages/project-protocol/src/upstream-handoff-samples.test.ts),
which asserts properties of the committed bytes: every sample is listed exactly
once, parses, reports the version its name claims, round-trips to canonical
current form, and carries **exactly** the fork fields its manifest entry
declares and no others.

## The samples

| File                                                                                    | Schema | Circuit                                                            | Answers                                                    |
| --------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| [`01-rc-divider.v57`](01-rc-divider.v57.schdraft)                                       | 57     | RC low-pass with formal `VIN`/`VOUT` ports                           | pre-fork control: should load unchanged                    |
| [`02-crossing-line-jump.v58`](02-crossing-line-jump.v58.schdraft)                       | 58     | resistively loaded NMOS cross-coupled pair                           | the 58 per-wire line-jump flag, **and** the number clash   |
| [`03-stroke-scale.v59`](03-stroke-scale.v59.schdraft)                                   | 59     | common-source stage, heavy rail and heavy device                     | the 59 per-object stroke width                             |
| [`04-line-jump-radius.v60`](04-line-jump-radius.v60.schdraft)                           | 60     | the same pair at a larger hop radius                                 | the 60 per-document line-jump size                         |
| [`05-empty.v60`](05-empty.v60.schdraft)                                                 | 60     | empty Project, one empty Document                                    | empty Project                                              |
| [`06-ota-5t-hierarchy.v60`](06-ota-5t-hierarchy.v60.schdraft)                           | 60     | a 5T OTA Cell instantiated twice from a top Document                 | hierarchy with a formal Cell interface                     |
| [`07-split-grounds.v60`](07-split-grounds.v60.schdraft)                                 | 60     | analog side on AGND, digital side on DGND, no shared `0`             | AGND/DGND as named global rails                            |
| [`08-power-devices.v60`](08-power-devices.v60.schdraft)                                 | 60     | E-GaN half bridge, IGBT leg with freewheeling diode, GaN cascode     | the new power-device families, their pins and prefixes     |
| [`09-four-terminal-mos.v60`](09-four-terminal-mos.v60.schdraft)                         | 60     | CMOS inverter with both bodies drawn and wired                       | the four-terminal body variant                             |
| [`10-all-extensions.v60`](10-all-extensions.v60.schdraft)                               | 60     | cross-coupled pair carrying all three fork fields at once            | what a current fork save actually looks like               |
| [`11-origin-indistinguishable.v58`](11-origin-indistinguishable.v58.schdraft)           | 58     | NMOS current mirror with no fork field anywhere                      | origin cannot be determined from the bytes                 |

08 and 09 are separate files because an unknown `symbolId` and an unknown
`symbolVariantId` fail differently in a symbol resolver, and both paths need a
witness.

SVG previews ship only for 02, 03, 04 and 10 — the four whose subject is a
visual effect. They are rendered by our own `@icm/render-svg`, so they show what
we intended the field to mean; they are not an independently verifiable golden.

## Why stamping the version number is exact, not approximate

Schema 58, 59 and 60 are pure version bumps. All three transforms are literally
`{...raw, schemaVersion: N}`:

- [`transforms/route-line-jump.ts`](../../packages/project-protocol/src/transforms/route-line-jump.ts) (57→58)
- [`transforms/per-object-stroke-scale.ts`](../../packages/project-protocol/src/transforms/per-object-stroke-scale.ts) (58→59)
- [`transforms/line-jump-radius-scale.ts`](../../packages/project-protocol/src/transforms/line-jump-radius-scale.ts) (59→60)

All three features are optional fields whose absence means the pre-existing
default, so a Project that uses none of them is **byte-identical at 57 and at
60 except for that one number**. Our own suite already leans on this:
`minimalProjectAt()` in
[`legacy-load.test.ts`](../../packages/project-protocol/src/legacy-load.test.ts)
builds historical fixtures the same way.

The handoff test checks the property directly rather than asserting it here: it
re-serializes each migrated Project and requires that substituting the stamped
version number back reproduces the file byte for byte.

## The actual compatibility problem

`CircuitProjectSchema`
([`packages/model/src/schema/project.ts`](../../packages/model/src/schema/project.ts))
is a `z.strictObject` with **no producer, generator or dialect field**.
`schemaVersion` is therefore the only thing in a file that could tell the two
projects' saves apart — and it is a plain integer that both projects increment
independently from the common ancestor, where both were at 57.

The loader guard is shared ancestry: `load.ts` refuses any
`sourceSchemaVersion` outside `[24, CURRENT]` with `UNSUPPORTED_SCHEMA_VERSION`.
That gives three behaviours today:

| Sample version | What upstream's reader does                                            |
| -------------- | ---------------------------------------------------------------------- |
| 57             | loads it correctly; it predates the divergence                          |
| **58**         | **accepts it and migrates it as upstream's own 58 — silently mis-read** |
| 59, 60         | refuses it outright: above upstream's current version                   |

Only 58 is silent. 59 and 60 are loud, and loud is safe.

The window widens, though: every version upstream adds moves one more of our
numbers from "refused" into "silently accepted". `11-origin-indistinguishable`
is the file that makes this concrete — it is a perfectly ordinary current mirror
with no fork field anywhere, so there is nothing in it, at any version number,
that either side could use to tell where it came from. The handoff test proves
that claim rather than stating it.

A format identifier on fork saves would end this, and
`02-target-architecture.md` §3 rule 5 already permits one. We have not
implemented it: this fork's feature set is frozen, and adding a persisted field
would invalidate the baseline commit the migration plan is pinned to. It is a
decision for the version-number conversation, not something to ship unilaterally.
