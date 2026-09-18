# Troubleshooting

## Import says the entry is ambiguous

Choose exactly one `.cir`, `.sp`, `.spi`, or `.scs` entry. If the selected
files include one `circuit.spi` or `circuit.scs`, it is preferred. Include every
local `.inc` or `.lib` file used by the entry.

## A crossing is not connected

This is intentional. Add a Junction dot at the connection. Never infer an
electrical join from geometry.

## A SPICE statement is reported as opaque

Opaque text is preserved exactly but is not editable circuit semantics yet.
Consult the compatibility matrix and keep the diagnostic when reporting a
missing vendor construct.

## Recovery copies

Safety copies live in the application's own IndexedDB and are never
authoritative — the file you opened is. Use **File / Recover Local Work…** to
browse them. A damaged latest copy offers the previous generation; a copy from a
newer Project schema cannot be restored here but can still be saved out.
Deleting one copy never deletes another Project's copy. If a warning says
recovery cannot be saved (storage full or unavailable), save the Project to disk
with the button in the warning. A reload immediately after an edit may miss that
very last edit — the copy lands within a fraction of a second; reloading after
that restores the latest committed state.

## Save does not ask where to put the file

That is **Save** working: it overwrites the file named in the File menu. Use
**Save As…** when you want a prompt. A Project with no file yet — a new Project
or one restored from a recovery copy — makes **Save** ask once, then remembers.

## PNG or PDF export fails

PNG needs Canvas 2D; both need the browser to allow a Blob download. SVG is the
canonical fallback and contains the same formal scene.

## Accessibility limits

Precise component placement, route-segment and endpoint selection, and Junction
insertion still require pointer input. The schematic does not expose a complete
object-by-object accessibility tree, focus follows DOM order, and shortcuts
cannot be customized. Keyboard-focusable controls and status announcements do
not remove those limitations. Future semantic canvas navigation must use typed
Edit Engine operations rather than simulated pointer events.
