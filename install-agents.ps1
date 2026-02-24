param(
    [Parameter(Position = 0)]
    [string]$TargetPath
)

$ErrorActionPreference = 'Stop'

$ScriptDir = $PSScriptRoot
$SourceDir = Join-Path $ScriptDir 'artifacts' 'agents'

if (-not (Test-Path $SourceDir)) {
    Write-Error "Agent prompt files not found at $SourceDir"
    exit 1
}

$Files = Get-ChildItem -Path $SourceDir -Filter '*.md'
if ($Files.Count -eq 0) {
    Write-Error "No .md files found in $SourceDir"
    exit 1
}

if ($TargetPath) {
    $Destination = Join-Path $TargetPath '.claude' 'agents'
} else {
    $Destination = Join-Path $HOME '.claude' 'agents'
}

Write-Host 'This will copy the following agent prompt files:'
Write-Host ''
foreach ($f in $Files) {
    Write-Host "  $($f.Name)"
}
Write-Host ''
Write-Host "Destination: $Destination"
Write-Host ''
$answer = Read-Host 'Continue? [Y/N]'

if ($answer -notin 'Y', 'y') {
    Write-Host 'Aborted.'
    exit 0
}

if (-not (Test-Path $Destination)) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
}

foreach ($f in $Files) {
    Copy-Item -Path $f.FullName -Destination $Destination
    Write-Host "Copied $($f.Name)"
}

Write-Host "Done. Agent prompts installed to $Destination"
