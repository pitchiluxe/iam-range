<#
.SYNOPSIS
    Verify a local Ollama instance is answering before anything else is built.

.DESCRIPTION
    Calls http://localhost:11434/api/tags. On success prints
      OLLAMA LOCAL INSTANCE VERIFIED: Training Instructor Integrated.
    and returns $true (exit code 0). On failure prints step-by-step
    instructions for starting Ollama on this platform and exits 1, so any
    script that calls it halts.

.PARAMETER Endpoint
    Ollama base URL. Default comes from ollama-instructor.config.json.

.PARAMETER Quiet
    Return $true/$false without printing (for callers that print themselves).
#>
[CmdletBinding()]
param([string]$Endpoint, [switch]$Quiet)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content -Raw (Join-Path $PSScriptRoot 'ollama-instructor.config.json') | ConvertFrom-Json
if (-not $Endpoint) { $Endpoint = $cfg.ollama.endpoint }
$tags = "$($Endpoint.TrimEnd('/'))$($cfg.ollama.tagsPath)"

try {
    $resp = Invoke-RestMethod -Uri $tags -Method Get -TimeoutSec 5
    $models = @($resp.models | ForEach-Object { $_.name })
    if (-not $Quiet) {
        Write-Host $cfg.verification.successMessage -ForegroundColor Green
        Write-Host ("Installed models: " + ($(if ($models.Count) { $models -join ', ' } else { '(none - run: ollama pull llama3)' })))
    }
    if ($Quiet) { return $true }
    exit 0
} catch {
    if ($Quiet) { return $false }
    Write-Host $cfg.verification.failureMessage -ForegroundColor Red
    Write-Host "Could not reach $tags : $($_.Exception.Message)`n"
    $onWindows = $env:OS -eq 'Windows_NT'
    $onMac = (-not $onWindows) -and (Test-Path '/System/Library/CoreServices/SystemVersion.plist')
    if ($onWindows) {
        Write-Host @'
Start Ollama on Windows:
  1. If it is not installed: download and run the installer from https://ollama.com/download/windows
  2. Start it: open the Start menu, type "Ollama" and launch it
     (a llama icon appears in the notification area), or in a terminal run:
         ollama serve
  3. Pull a model the instructor can use:
         ollama pull llama3
  4. Confirm it answers:
         Invoke-RestMethod http://localhost:11434/api/tags
  5. Re-run this lab build.
If port 11434 is in use by another program, stop it or set OLLAMA_HOST and pass -Endpoint.
'@
    } elseif ($onMac) {
        Write-Host @'
Start Ollama on macOS:
  1. If it is not installed: brew install ollama   (or the app from https://ollama.com/download/mac)
  2. Start it: open the Ollama app, or run:  brew services start ollama   (or: ollama serve)
  3. Pull a model:  ollama pull llama3
  4. Confirm:       curl -s http://localhost:11434/api/tags
  5. Re-run this lab build.
'@
    } else {
        Write-Host @'
Start Ollama on Linux:
  1. If it is not installed: curl -fsSL https://ollama.com/install.sh | sh
  2. Start the service:      sudo systemctl enable --now ollama
     (no systemd: run  ollama serve  in another terminal)
  3. Pull a model:           ollama pull llama3
  4. Confirm:                curl -s http://localhost:11434/api/tags
  5. Re-run this lab build.
'@
    }
    exit 1
}
