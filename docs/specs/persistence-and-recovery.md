# Persistence and Recovery

Status: `accepted`

Primary owner: the desktop file bridge, `packages/project-protocol`, and
the editor document lifecycle

Project content uses canonical schema-58 JSON. The `.icproj.json` file on disk is
the formal saved resource; there is no second store.
The current-only model in `packages/model` validates the normalized shape;
`packages/project-protocol` owns parsing, compatibility diagnostics,
and canonical serialization. Persistence validates the complete current schema
before import or Save. Compatibility and migration failure rules belong to the
[file-format contract](project-file-format.md). The protocol reader upgrades
supported historical content before current-schema validation; all writers emit
the current schema. Persistence does not maintain a separate migration policy.

Recovery state is a non-authoritative local safety copy. It may restore a
complete schema-58 Project or a supported historical record that validates
after the chained upgrade, associated with a recorded working-copy session.
Corrupt, incompatible, or partial recovery data is discarded or retained as raw
data without changing the live Project. User-saved Library examples and their
browser store are retired. Selection, viewport, and overlays
are never embedded in Project JSON or recovery records.

## Local recovery records

Recovery copies are complete canonical Project texts stored in IndexedDB under
an application-specific database, keyed by a random `workingCopyId` plus a
`latest`/`previous` generation, never by `projectId` alone. The executable
limits live in `apps/editor/src/document/browser-recovery-contract.ts`:

- at most 2 retained working-copy sessions, the active one always kept and the
  oldest inactive session pruned first;
- at most `latest` and `previous` per session; identical Project text does not
  consume a new generation. Save-state and formal-file metadata may update the
  latest envelope in place without rotating its Project text into `previous`;
- one record's Project text is at most 4 MB (UTF-8, recomputed on read);
- all owned records total at most 12 MB.

Records use a versioned envelope (`analog-canvas-browser-recovery-v2`) that is
separate from the Project schema and never enters `.icproj.json`. Stored input
is decoded structurally before its Project text is parsed, and a record whose
Project text carries an unsupported schema version classifies as
`unsupported-schema`, keeps its raw bytes recoverable, and is never deleted as
corrupt. Envelope identity fields must agree with the parsed Project. The
optional `unsavedAtSnapshot` envelope field records whether the snapshot was
ahead of the file on disk. Records written before this additive field
remain valid but have unknown save state and therefore do not trigger an
automatic startup offer. This metadata is session lifecycle state, never part
of Project JSON. The optional `fileBinding` (`path` plus `name`) records the file
this working copy came from, so a restored copy can name its Save target;
records without it restore unbound rather than guessing a path.

A rejected write (oversized, quota exceeded, storage unavailable, or failed)
must leave every previous record readable. Storage or quota failure is visible
to the user and never destructive: the previous record is kept and the user is
told to save the Project to a file. Only this application's own object store is
ever pruned; the editor never clears all IndexedDB databases or origin storage.

The legacy `icm.recovery.v1` localStorage slot migrates into IndexedDB on first
upgraded launch; the old key is removed only after the IndexedDB transaction
commits. Unmigratable legacy data stays in localStorage for raw
download/discard.

## Save semantics

A Project is bound to at most one file path. **Save** writes that path in place
with no dialog. **Save As…** always asks, and rebinds the Project to the chosen
path on success. A Project with no binding — New, imported, or restored from
recovery — makes its first **Save** ask once, then keeps the binding. The editor
exposes no third command that writes a file silently to a path the user never
chose.

The write itself belongs to the shell: the renderer hands text and an optional
path across the file bridge, and only the main process touches the filesystem.
A failed or cancelled write leaves the binding and the dirty state exactly as
they were. Cancelling a dialog is not a failure and is never reported as one.

The editor session owns the binding, the saved content baseline, and its
recovery working-copy id. A successful write advances the baseline. If edits
occurred while the write was in flight, the submitted snapshot is on disk but
the newer live content remains dirty. Undo back to the written content becomes
clean.

**Import Project File** is an interchange operation: it validates and loads
bytes without binding a path, so it never claims to be Save and never clears
dirty state. A contextual backup save is offered only when recovery needs
attention. Saving a copy does not remove recovery records; bounded retention and
explicit user deletion remain their only removal paths.

The editor persistence lifecycle is the single source of unsaved truth. A
successful persistent edit marks it dirty; only a completed write of
the current content marks it clean. Selection, view, export, and
panel changes do not. While dirty, and only while dirty, the editor registers
the native `beforeunload` guard for Refresh and window close.
The application does not synthesize history entries, customize the
host-owned warning, or depend on unload-time asynchronous storage as its
only protection.

`beforeunload` is the browser's guard. A host that reads the same
`preventDefault()` as a silent refusal rather than a prompt — Electron does —
must ask the question itself, and the desktop shell does: closing a window
that holds unsaved work offers **Save**, **Don't Save**, or **Cancel** in a
native dialog, naming the file Save would write or saying it will ask when
there is no binding. Save runs the editor's own Save command, so a Project
with no binding is asked where to go. The shell contract is:

- The editor answers one question — dirty, Project name, bound path — and
  performs one command, its own Save. Every other decision about the close is
  the shell's.
- An unanswerable editor closes the window. A guard that cannot read the
  editor must never be able to trap someone in a window that refuses to shut;
  the recovery copy is the backstop for that case.
- A cancelled save keeps the window without reporting a fault; a failed save
  keeps the window and says why. Neither discards anything.
- The window's remembered geometry is written before the window is destroyed,
  because destroying it is what bypasses the renderer's own `beforeunload`.

Opening or replacing a Project stages and validates the complete candidate —
read bytes, JSON/schema validation, approved-symbol validation, Project
preparation — before the live Project changes. Invalid input leaves the
Project, selection, history, recovery, and file state untouched. Before
replacing dirty work the editor first attempts and flushes a recovery write,
then offers **Save and continue**, **Continue without saving**, or
**Stay**, defaulting to Cancel. The dialog names the file Save would write, or
says it will ask when there is no binding. A failed save leaves the foreground
Project and dialog in place. Recovery failure is shown in the same dialog as
elevated risk but never grants permission to discard.
A successful replacement seeds the incoming Project's own working-copy
identity. **Continue without saving** is an explicit discard: it deletes the
outgoing working copy's recovery records before the replacement proceeds.
Every other successful replacement retains the outgoing Project in recent
recovery.

On startup, the latest valid recovery record is offered
non-modally only when it explicitly says `unsavedAtSnapshot: true`, the
foreground Project is still clean, and the load is not the editor's explicit
refresh-restore path. The offer provides Restore, Save a copy (a backup file written through the file
bridge, which never rebinds the Project), and Ignore.
Normal pending/stored recovery writes stay silent; only failures are promoted
while the foreground work is dirty.

Required validation covers in-place overwrite versus prompted save, binding
after Save As, cancelled and failed writes, canonical import/export stability,
exact schema-version rejection, corrupt recovery, unsupported-schema retention,
envelope/Project identity mismatch, retention ordering, and quota and storage
failure mapping. The shell close guard is covered by its own decision table
(clean, unreadable, and each of the three answers crossed with a saved,
cancelled, and failed write) and, because no unit test drives a real window, by
`scripts/close-guard-window-check.mjs` closing and quitting a dirty window in a
real Electron shell.
