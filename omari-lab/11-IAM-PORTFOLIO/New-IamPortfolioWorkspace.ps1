<#
.SYNOPSIS
    Build the IAM-Portfolio-Labs workspace, after verifying local Ollama.

.DESCRIPTION
    1. Runs Test-OllamaInstructor.ps1. If Ollama is not answering, prints the
       start-up instructions and stops: nothing is created.
    2. Creates:
         IAM-Portfolio-Labs/
           00-Organization-Setup/ ... 10-SIEM-LogAuditing/   (README.md + scripts/)
           .ollama-instructor/config.json                   (+ system-prompt.txt)
    3. Resolves which installed model the instructor will use and records it
       in config.json as "selectedModel".

    Safe to re-run: existing README.md files are never overwritten (they hold
    your work). config.json is refreshed only with -Force.

.PARAMETER Root
    Parent folder. Default: your Documents folder.

.PARAMETER Force
    Rewrite .ollama-instructor/config.json and system-prompt.txt.
#>
[CmdletBinding()]
param(
    [string]$Root = [Environment]::GetFolderPath('MyDocuments'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# --- 1. Ollama verification pre-check (halts on failure) --------------------
& (Join-Path $PSScriptRoot 'Test-OllamaInstructor.ps1')
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nWorkspace NOT created. Start Ollama as shown above, then re-run this script." -ForegroundColor Yellow
    exit 1
}

# --- 2. File tree -----------------------------------------------------------
$source = Get-Content -Raw (Join-Path $PSScriptRoot 'ollama-instructor.config.json') | ConvertFrom-Json
$workspace = Join-Path $Root 'IAM-Portfolio-Labs'
$folders = @('00-Organization-Setup') + @($source.projects | Sort-Object number | ForEach-Object { $_.folder })

New-Item -ItemType Directory -Force -Path $workspace | Out-Null
foreach ($name in $folders) {
    $dir = Join-Path $workspace $name
    New-Item -ItemType Directory -Force -Path (Join-Path $dir 'scripts') | Out-Null
    $readme = Join-Path $dir 'README.md'
    if (-not (Test-Path $readme)) { New-Item -ItemType File -Path $readme | Out-Null }
    Write-Host "  $name/  (README.md, scripts/)"
}

# --- 3. Instructor configuration -------------------------------------------
$instructorDir = Join-Path $workspace '.ollama-instructor'
New-Item -ItemType Directory -Force -Path $instructorDir | Out-Null
$configPath = Join-Path $instructorDir 'config.json'
$promptPath = Join-Path $instructorDir 'system-prompt.txt'

if ($Force -or -not (Test-Path $configPath)) {
    $installed = @()
    try { $installed = @((Invoke-RestMethod "$($source.ollama.endpoint)$($source.ollama.tagsPath)" -TimeoutSec 5).models | ForEach-Object { $_.name }) } catch { }
    $selected = $null
    foreach ($p in $source.ollama.preferredModels) {
        $selected = $installed | Where-Object { $_ -eq $p -or $_ -eq "$p`:latest" -or $_ -like "$p`:*" } | Select-Object -First 1
        if ($selected) { break }
    }
    if (-not $selected) { $selected = $installed | Select-Object -First 1 }
    $source | Add-Member -NotePropertyName selectedModel -NotePropertyValue $selected -Force
    $source | Add-Member -NotePropertyName workspace -NotePropertyValue $workspace -Force
    $source | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8
    ($source.systemPrompt -join "`n") | Set-Content -Path $promptPath -Encoding UTF8
    Write-Host "  .ollama-instructor/config.json  (model: $(if ($selected) { $selected } else { 'none installed - run: ollama pull llama3' }))"
} else {
    Write-Host "  .ollama-instructor/config.json  (kept; use -Force to refresh)"
}

Write-Host "`nWorkspace ready: $workspace" -ForegroundColor Green
Write-Host 'Open IAM Range -> IAM Portfolio to work the projects with the instructor.'
