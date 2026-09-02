# Is the built app older than the code it was built from?
#
# The launcher used to rebuild only when the exe was missing, which is not the
# same question at all: after a pull or an edit the old one is still there and
# starts perfectly happily, and nothing says the version on screen is not the
# version on disk. That is the worst kind of wrong — everything works, and it is
# the wrong thing working.
#
# Exits 1 when something needs building, 0 when what is there is current.
# Written as a script rather than a line inside the .bat because quoting a
# multi-clause PowerShell command through cmd is a way to be silently wrong.

param(
    [Parameter(Mandatory = $true)][string] $Exe,
    [Parameter(Mandatory = $true)][string] $Root
)

if (-not (Test-Path $Exe)) {
    Write-Output "nothing built yet"
    exit 1
}

$builtAt = (Get-Item $Exe).LastWriteTime

# Only the places code actually lives. Scanning the whole tree would mean
# walking node_modules and target — tens of thousands of files, seconds of wait,
# every single launch.
$watch = @(
    "apps\desktop\src",
    "apps\desktop\src-tauri\src",
    "apps\desktop\src-tauri\Cargo.toml",
    "apps\desktop\src-tauri\tauri.conf.json",
    "apps\desktop\index.html",
    "apps\desktop\package.json",
    "apps\desktop\vite.config.ts",
    "packages\core\src",
    "packages\providers\src",
    "package.json"
) | ForEach-Object { Join-Path $Root $_ } | Where-Object { Test-Path $_ }

$newest = $null
foreach ($path in $watch) {
    $item = Get-Item $path
    $candidates = if ($item.PSIsContainer) {
        Get-ChildItem -Path $path -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\(node_modules|target|dist)\\' }
    } else {
        @($item)
    }

    foreach ($file in $candidates) {
        if ($null -eq $newest -or $file.LastWriteTime -gt $newest.LastWriteTime) {
            $newest = $file
        }
    }
}

if ($null -eq $newest) {
    # No sources found at all. Not this script's business to guess why; the
    # build itself will say something more useful than a rebuild loop would.
    exit 0
}

if ($newest.LastWriteTime -gt $builtAt) {
    # Name the file, because "something changed" leaves you wondering whether
    # the check itself is broken.
    $name = $newest.FullName.Replace("$Root\", "")
    Write-Output "$name is newer than the last build"
    exit 1
}

exit 0
