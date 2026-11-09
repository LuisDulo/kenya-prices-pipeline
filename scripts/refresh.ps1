<#
.SYNOPSIS
Runs the pipeline and pushes the curated data when it changed. The scheduled task calls this.

.DESCRIPTION
EPRA refuses requests from cloud servers, so the daily run happens on a home connection.
Each run writes a log to logs\refresh-YYYY-MM-DD.log and keeps the last 30.
#>
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$logs = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$day = Get-Date -Format "yyyy-MM-dd"
$log = Join-Path $logs "refresh-$day.log"

function Write-Log([string]$message) {
    "$(Get-Date -Format s) $message" | Add-Content -Path $log -Encoding ascii
}

# Native commands run through cmd so their output, including warnings on stderr, goes to the
# log without PowerShell treating it as an error. Only the exit code decides success.
function Invoke-Step([string]$name, [string]$command) {
    Write-Log $name
    cmd /c "$command >> `"$log`" 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "$name failed with exit code $LASTEXITCODE" }
}

try {
    Write-Log "Refresh started"
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($branch -ne "main") {
        throw "The repository is on branch $branch. Switch to main so the refresh does not touch other work."
    }
    if (-not (Test-Path ".env")) { throw "No .env file. Run scripts\setup-laptop.ps1 first." }
    foreach ($line in Get-Content ".env") {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
        }
    }

    Invoke-Step "Pulling the latest code" "git pull --ff-only --quiet origin main"
    $lock = Get-Item "package-lock.json"
    $installed = Get-Item "node_modules\.package-lock.json" -ErrorAction SilentlyContinue
    if (-not $installed -or $installed.LastWriteTime -lt $lock.LastWriteTime) {
        Invoke-Step "Installing dependencies" "npm ci --no-audit --no-fund"
    }
    Invoke-Step "Running the pipeline" "npm run pipeline"

    git add data/curated
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Log "No change in the data"
    } else {
        Invoke-Step "Committing the new data" "git commit --quiet -m `"chore(data): Refresh curated data for $day`""
        Invoke-Step "Pushing" "git push --quiet origin main"
    }
    Write-Log "Refresh finished"
} catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    exit 1
} finally {
    Get-ChildItem $logs -Filter "refresh-*.log" | Sort-Object Name -Descending |
        Select-Object -Skip 30 | Remove-Item -ErrorAction SilentlyContinue
}
