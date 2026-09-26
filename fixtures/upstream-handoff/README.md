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
projects' saves apart. It cannot: both projects increment it independently from
the common ancestor, where both were at 57.

Worse than a shared counter, though, is that the counters now count different
things. Read at upstream commit
[`5a7841e0`](https://github.com/cascode-ai/analog-canvas/commit/5a7841e0ec0b9aab26420b971fa302c80b7ee0d6)
(2026-09-26), upstream keeps **two** numbers where this fork keeps one:

- `CURRENT_PROJECT_SCHEMA_VERSION` is 58 — the model schema.
- `CURRENT_PROJECT_FILE_VERSION` is 63 — the on-disk format, and the bound
  `load.ts` range-checks against.
- `load.ts` reads `sourceSchemaVersion >= 59 ? decodeProjectFile(parsed)
  : parsed`, so from 59 up the number denotes an **encoded container** —
  compacted, with derived connectivity stripped out and stored separately —
  rather than a model schema at all.

This fork never made that split: `schemaVersion` is one number and the file is
always plain canonical JSON. So `60` in a file from here and `60` in a file from
upstream are not two dialects of one format; they are two different kinds of
claim that happen to be spelled the same way.

That produces five behaviours, all read from upstream's source rather than
executed against it — verify before relying on any row:

| This bundle's file            | What upstream's reader does                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 57 (`01`)                     | loads correctly; it predates the divergence                                                                                                                             |
| 58, no fork field (`11`)      | **loads correctly.** Upstream's own 57→58 step is an inlined `(raw) => ({...raw, schemaVersion: 58})`, so the step this file skips is a no-op                            |
| 58, with a fork field (`02`)  | **refused by name.** `RouteStyleOverrideSchema` is a `z.strictObject` of `{color, lineStyle, arrow}`, so `lineJump` is an unrecognized key                                |
| 59 (`03`)                     | enters `decodeProjectFile`, which dispatches 59 exactly to the older owned-v59 decoder. Plain JSON is not that encoding, so it fails; we have not characterised the message |
| 60 with any Route (`04`–`10`) | enters the compact branch and trips its explicit guard on persisted `Route.netId`, surfacing as `INVALID_PROJECT`: `Route netId is derived; edit its endpoints instead`   |

**An earlier version of this file got this wrong in both directions**, and the
mistake is instructive enough to leave on the record: it claimed 58 was a silent
mis-read and that 59 and 60 were refused outright for being above upstream's
current version. Neither holds. Nothing here is silently mis-read, because the
migration step a 58 file skips is a no-op and a strict object catches the fork
fields; and nothing is refused for being *ahead*, because upstream's ceiling is
63, so every number this fork uses is already inside its accepted window.

So the cost today is not corruption. It is **a diagnostic that names the wrong
cause**: a person handed a file from this fork is told to go edit the endpoints
of routes that are not the problem, and `INVALID_PROJECT` does not distinguish
"this file is damaged" from "this file is not ours". A format identifier on fork
saves would end that, and `02-target-architecture.md` §3 rule 5 already permits
one. We have not implemented it: this fork's feature set is frozen, and adding a
persisted field would invalidate the baseline commit the migration plan is
pinned to. It is a decision for the version-number conversation, not something
to ship unilaterally.

One scoping consequence worth stating plainly, because it is easy to
underestimate: since upstream's file layer at 59 and above is an encoded
container, a fork-to-upstream converter cannot be a field-renaming pass over
JSON. It has to *produce* that encoding.

`manifest.json` carries all of this per sample, under `knownDivergence` and
`upstreamReaderAsRead`. The handoff test checks each claim it can check from the
bytes — that only a 58 sample with a fork field claims the unknown-field
refusal, and only a sample above 59 that actually contains a Route claims the
misleading decoder diagnostic.

## Reading further

[`porting-notes.md`](porting-notes.md) is the other half of what we promised:
for each feature in your integration plan, the defects we hit while building it,
what caused them, and why it ended up the shape it did.
