# Persistence and Compatibility

Status: `accepted`

Owners: `packages/project-protocol`, `apps/editor`, `apps/desktop`

## Decision

Separate in-place file save, exported copies and local recovery under
[persistence and recovery](../specs/persistence-and-recovery.md). Use one
current runtime shape and a contiguous reader upgrade chain under
[Project file format](../specs/project-file-format.md). The
[desktop shell](../../apps/desktop/README.md) owns the file dialogs and the
directory the application is allowed to read and write.

## Context

Saving, downloading a backup and recovering unsaved work have different
durability and identity guarantees. Rapid schema evolution must not make an
absent user's saved circuit unreadable.

## Rationale

The file the user opened is the only authoritative store, so **Save** overwrites
it without a dialog and only **Save As…** asks. A command that silently writes
somewhere the user never chose would be worse than a prompt; a prompt on every
ordinary save would be worse than overwriting. Check findings are independent
evidence, not a reason to withhold saving unfinished work.

Recovery lives in the renderer's own IndexedDB, is bounded, and is explicitly
non-authoritative: it survives a crash, not a deleted profile, and it never
claims to be a backup. Only the main process touches the filesystem, so the
renderer cannot widen its own write scope.

A fixed-width version window ties file lifetime to development velocity.
Keeping adapters at the file boundary preserves durability while runtime code
still sees one shape. This costs maintained adapters and focused tests, rather
than scattered legacy branches. Ambiguous electrical data must be refused with
a located explanation, not silently converted into guessed connectivity.
