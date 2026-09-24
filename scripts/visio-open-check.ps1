# Opens a generated Visio package with Visio itself and reports what Visio found.
#
# This is the only check that can prove Visio accepts a package: the XML can be
# well formed, schema-plausible, and still open as a damaged file. It runs
# headless (Visio.InvisibleApp) and never shows a window.
#
# The file has to be staged on the Windows side before this runs, in a separate
# process. Visio's automation rejects a `\\wsl.localhost\...` file name, and
# copying the file from inside this script instead makes `Documents.Open` block
# on the copy it just made — Visio hits the still-settling destination file and
# waits on a dialog an invisible instance cannot show. PowerShell's execution
# policy also treats a script on the WSL share as remote, so copy this script
# over too rather than running it in place:
#
#   W="/mnt/c/Users/$USER/AppData/Local/Temp/icm-visio"
#   mkdir -p "$W" && cp scripts/visio-open-check.ps1 out.vsdx "$W/"
#   powershell.exe -File 'C:\...\Temp\icm-visio\visio-open-check.ps1' \
#                  -Path 'C:\...\Temp\icm-visio\out.vsdx'

param(
    [Parameter(Mandatory = $true)][string]$Path,
    # Report every master's shapes, connection points and geometry sections.
    # Off by default because a full symbol stencil prints 70 of them.
    [switch]$MasterDetail,
    # Report each page shape's placement, geometry rows and Shape Data rows —
    # the numbers the export computed, read back through Visio's own parser.
    [switch]$ShapeDetail,
    # Move one glued instance and check its wires follow. This is the only way
    # to tell a recorded `<Connect>` from a live glue: a line that is merely
    # drawn between two pins stays put when the pin moves. It also checks that
    # the wires kept the path they were given, which is the other half of the
    # contract — a glued end must follow without Visio re-routing the run — and
    # then drags a seam node to check that a corner is a handle: the links glued
    # to it move, and nothing else does.
    [switch]$GlueTest
)

$ErrorActionPreference = 'Stop'
$full = (Resolve-Path -LiteralPath $Path).Path

# ShapeSheet section indices, from the Visio type library.
$visSectionConnectionPts = 7
$visSectionFirstComponent = 10
$visSectionProp = 243

# A shape's geometry as formulas rather than results. The last vertex of a wire
# is written `Width*1`, so its result is meant to move with the endpoints while
# its formula stays put; every other vertex is a literal offset from the begin
# point. Re-routing rewrites these rows, so the string is a fingerprint of the
# path the export drew.
#
# Every cell of a row is read, not just X and Y: a line jump is an
# `EllipticalArcTo` whose A/B cells carry the point the arc passes through, and
# reading two cells would call a flattened hop an unchanged path.
function Read-GeometryRows($shape) {
    $parts = @()
    for ($s = 0; $s -lt $shape.GeometryCount; $s++) {
        $section = $visSectionFirstComponent + $s
        # Row 0 holds NoFill/NoLine/NoShow; the vertices start at row 1.
        for ($row = 1; $row -lt $shape.RowCount($section); $row++) {
            $type = $shape.RowType($section, $row)
            $cells = @()
            for ($c = 0; $c -lt $shape.RowsCellCount($section, $row); $c++) {
                $cells += $shape.CellsSRC($section, $row, $c).Formula
            }
            $parts += "$type($($cells -join ','))"
        }
    }
    return ($parts -join ' ')
}

$visio = New-Object -ComObject Visio.InvisibleApp
# IDNO: answer every dialog rather than blocking on one. A package Visio wants
# to repair therefore fails to open instead of being silently repaired.
$visio.AlertResponse = 7

try {
    $doc = $visio.Documents.Open($full)
    Write-Output "opened: $($doc.Name)"
    Write-Output "masters: $($doc.Masters.Count)"
    if ($MasterDetail) {
        foreach ($master in $doc.Masters) {
            $group = $master.Shapes.Item(1)
            $children = if ($group.Shapes) { $group.Shapes.Count } else { 0 }
            $geometry = 0
            foreach ($child in $group.Shapes) { $geometry += $child.GeometryCount }
            Write-Output ("  master '{0}': {1} connection points, {2} child shapes, {3} geometry sections, {4} x {5} in" -f `
                    $master.NameU, $group.RowCount($visSectionConnectionPts), $children, $geometry, `
                    $master.PageSheet.CellsU('PageWidth').ResultIU, `
                    $master.PageSheet.CellsU('PageHeight').ResultIU)
        }
    }
    Write-Output "pages: $($doc.Pages.Count)"
    foreach ($page in $doc.Pages) {
        $sheet = $page.PageSheet
        Write-Output ("page '{0}': {1} shapes, {2} connects, {3} x {4} in, scale {5}" -f `
                $page.NameU, $page.Shapes.Count, $page.Connects.Count, `
                $sheet.CellsU('PageWidth').ResultIU, $sheet.CellsU('PageHeight').ResultIU, `
                $sheet.CellsU('DrawingScale').ResultIU)
        foreach ($shape in $page.Shapes) {
            $master = if ($shape.Master) { $shape.Master.NameU } else { '(local)' }
            if ($ShapeDetail) {
                $rows = 0
                for ($i = 0; $i -lt $shape.GeometryCount; $i++) {
                    $rows += $shape.RowCount($visSectionFirstComponent + $i)
                }
                Write-Output ("  shape {0} '{1}' master={2} pin=({3:n4},{4:n4}) angle={5:n2}deg flip=({6},{7}) geometry={8}rows data={9}rows connects={10}" -f `
                        $shape.ID, $shape.NameU, $master, `
                        $shape.CellsU('PinX').ResultIU, $shape.CellsU('PinY').ResultIU, `
                        $shape.CellsU('Angle').Result('deg'), `
                        $shape.CellsU('FlipX').ResultIU, $shape.CellsU('FlipY').ResultIU, `
                        $rows, $shape.RowCount($visSectionProp), $shape.Connects.Count)
            }
            else {
                Write-Output ("  shape {0} '{1}' master={2}" -f $shape.ID, $shape.NameU, $master)
            }
        }

        if ($GlueTest) {
            # The busiest instance: the most glued connectors makes the strongest
            # statement when they all follow.
            $target = $null
            $best = 0
            foreach ($shape in $page.Shapes) {
                if ($shape.OneD -ne 0) { continue }
                $held = @($page.Connects | Where-Object { $_.ToSheet.ID -eq $shape.ID })
                if ($held.Count -gt $best) { $best = $held.Count; $target = $shape }
            }
            if (-not $target) {
                Write-Output 'glue test: no glued instance on this page'
            }
            else {
                $held = @($page.Connects | Where-Object { $_.ToSheet.ID -eq $target.ID })
                $before = @{}
                $bends = @{}
                foreach ($connect in $held) {
                    $wire = $connect.FromSheet
                    $before[$connect.FromCell] = @(
                        $wire.CellsU('BeginX').ResultIU, $wire.CellsU('BeginY').ResultIU,
                        $wire.CellsU('EndX').ResultIU, $wire.CellsU('EndY').ResultIU)
                    $bends[$wire.ID] = Read-GeometryRows $wire
                }
                $shift = 0.5
                # A label is held by a formula rather than by a Connect, so the
                # followers have to be found by reading the formula. Visio
                # resolves the `Sheet.31!PinX` the file was written with to the
                # shape's own name — `ota_5t.31!PinX` — so the name is what the
                # formula has to be matched against, and a name carrying spaces
                # or punctuation comes back quoted: `'Integrator (1/s).5'!PinX`.
                $reference = [regex]::Escape($target.NameU) + "'?!"
                $labels = @()
                foreach ($shape in $page.Shapes) {
                    if ($shape.OneD -ne 0 -or $shape.Master) { continue }
                    if ($shape.CellsU('PinX').Formula -notmatch $reference) { continue }
                    $labels += , @($shape, $shape.CellsU('PinX').ResultIU)
                }
                $target.CellsU('PinX').ResultIU = $target.CellsU('PinX').ResultIU + $shift
                $moved = 0
                foreach ($connect in $held) {
                    $wire = $connect.FromSheet
                    $was = $before[$connect.FromCell]
                    $isBegin = $connect.FromPart -eq 9
                    $x = if ($isBegin) { $wire.CellsU('BeginX').ResultIU } else { $wire.CellsU('EndX').ResultIU }
                    $wasX = if ($isBegin) { $was[0] } else { $was[2] }
                    if ([math]::Abs(($x - $wasX) - $shift) -lt 0.001) { $moved++ }
                    else {
                        Write-Output ("  glue MISSED: wire {0} {1} moved {2:n4} in, expected {3:n4}" -f `
                                $wire.ID, $connect.FromCell, ($x - $wasX), $shift)
                    }
                }
                Write-Output ("glue test: moved shape {0} '{1}' by {2} in; {3} of {4} glued ends followed" -f `
                        $target.ID, $target.NameU, $shift, $moved, $held.Count)
                # A glued end following is only half the claim. A wire is a
                # drawn line segment, so Visio must not have touched the path
                # itself: every bend stays where the schematic put it, in the
                # wire's own frame. A dynamic connector would have recomputed
                # the whole run and changed both the row count and the bends.
                $kept = 0
                foreach ($connect in $held) {
                    $wire = $connect.FromSheet
                    $was = $bends[$wire.ID]
                    $now = Read-GeometryRows $wire
                    if ($was -eq $now) { $kept++ }
                    else {
                        Write-Output ("  path REROUTED: wire {0} was [{1}], now [{2}]" -f `
                                $wire.ID, $was, $now)
                    }
                }
                Write-Output ("path test: {0} of {1} wires kept the path they were given" -f `
                        $kept, $held.Count)
                $followed = 0
                foreach ($label in $labels) {
                    $now = $label[0].CellsU('PinX').ResultIU
                    if ([math]::Abs(($now - $label[1]) - $shift) -lt 0.001) { $followed++ }
                    else {
                        Write-Output ("  label MISSED: shape {0} moved {1:n4} in, expected {2:n4}" -f `
                                $label[0].ID, ($now - $label[1]), $shift)
                    }
                }
                Write-Output ("label test: {0} of {1} labels of that shape followed" -f `
                        $followed, $labels.Count)

                # A wire is a chain of links joined at node shapes, which is the
                # only thing that makes a corner draggable: a one-dimensional
                # Visio shape has two ends and no handle in between. Dragging a
                # seam has to move exactly the links glued to it, so this both
                # proves the handle works and proves it is local — a chain that
                # dragged a whole wire along would be no better than one shape.
                $seam = $null
                foreach ($shape in $page.Shapes) {
                    if ($shape.OneD -ne 0 -or -not $shape.Master) { continue }
                    if ($shape.Master.NameU -ne 'Node') { continue }
                    # A node holding one link is where a wire ends, not where it
                    # turns; two or more is a seam and therefore a handle.
                    $on = @($page.Connects | Where-Object { $_.ToSheet.ID -eq $shape.ID })
                    if ($on.Count -lt 2) { continue }
                    $seam = $shape
                    break
                }
                if (-not $seam) {
                    Write-Output 'seam test: no wire on this page turns a corner'
                }
                else {
                    $links = @($page.Connects | Where-Object { $_.ToSheet.ID -eq $seam.ID })
                    $seamBefore = @{}
                    foreach ($shape in $page.Shapes) {
                        if ($shape.OneD -eq 0) { continue }
                        $seamBefore[$shape.ID] = @(
                            $shape.CellsU('BeginX').ResultIU, $shape.CellsU('BeginY').ResultIU,
                            $shape.CellsU('EndX').ResultIU, $shape.CellsU('EndY').ResultIU)
                    }
                    $seam.CellsU('PinY').ResultIU = $seam.CellsU('PinY').ResultIU + $shift
                    $heldBySeam = 0
                    foreach ($link in $links) {
                        $wire = $link.FromSheet
                        $was = $seamBefore[$wire.ID]
                        $isBegin = $link.FromPart -eq 9
                        $y = if ($isBegin) { $wire.CellsU('BeginY').ResultIU } else { $wire.CellsU('EndY').ResultIU }
                        $wasY = if ($isBegin) { $was[1] } else { $was[3] }
                        if ([math]::Abs(($y - $wasY) - $shift) -lt 0.001) { $heldBySeam++ }
                        else {
                            Write-Output ("  seam MISSED: link {0} {1} moved {2:n4} in, expected {3:n4}" -f `
                                    $wire.ID, $link.FromCell, ($y - $wasY), $shift)
                        }
                    }
                    $strayed = 0
                    $glued = @($links | ForEach-Object { $_.FromSheet.ID })
                    foreach ($shape in $page.Shapes) {
                        if ($shape.OneD -eq 0 -or $glued -contains $shape.ID) { continue }
                        $was = $seamBefore[$shape.ID]
                        $now = @(
                            $shape.CellsU('BeginX').ResultIU, $shape.CellsU('BeginY').ResultIU,
                            $shape.CellsU('EndX').ResultIU, $shape.CellsU('EndY').ResultIU)
                        for ($i = 0; $i -lt 4; $i++) {
                            if ([math]::Abs($now[$i] - $was[$i]) -ge 0.001) {
                                Write-Output ("  seam STRAYED: link {0} moved with a seam it is not glued to" -f $shape.ID)
                                $strayed++
                                break
                            }
                        }
                    }
                    Write-Output ("seam test: moved node {0} by {1} in; {2} of {3} glued link ends followed, {4} unglued links moved" -f `
                            $seam.ID, $shift, $heldBySeam, $links.Count, $strayed)
                }
            }
        }
    }
    # Nothing here is worth keeping, and an unsaved document would otherwise ask.
    $doc.Saved = $true
    $doc.Close()
}
finally {
    $visio.Quit()
}
