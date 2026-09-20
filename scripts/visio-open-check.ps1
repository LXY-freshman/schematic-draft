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
    [switch]$MasterDetail
)

$ErrorActionPreference = 'Stop'
$full = (Resolve-Path -LiteralPath $Path).Path

# ShapeSheet section indices, from the Visio type library.
$visSectionConnectionPts = 7

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
            Write-Output ("  shape {0} '{1}' master={2}" -f $shape.ID, $shape.NameU, $master)
        }
    }
    $doc.Close()
}
finally {
    $visio.Quit()
}
