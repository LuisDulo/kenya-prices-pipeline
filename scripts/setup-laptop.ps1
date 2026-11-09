<#
.SYNOPSIS
One-time setup for the daily refresh on a Windows laptop.

.DESCRIPTION
Asks for your PostgreSQL password, creates the kenya_prices database if it is missing, writes
the connection string to .env (which git ignores), and registers a scheduled task that runs
scripts\refresh.ps1 every day. The task runs only while you are signed in, so no Windows
password is stored, and it catches up after the laptop wakes if it missed its time.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\setup-laptop.ps1
#>
param(
    [string]$Time = "07:00",
    [string]$User = "postgres",
    [string]$DatabaseHost = "localhost",
    [int]$Port = 5432,
    [string]$Database = "kenya_prices",
    [string]$TaskName = "KenyaPricesPipeline"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

$psql = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $psql) { throw "psql.exe was not found under C:\Program Files\PostgreSQL." }

$secure = Read-Host "PostgreSQL password for $User" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}

$env:PGPASSWORD = $password
try {
    $exists = & $psql.FullName -h $DatabaseHost -p $Port -U $User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$Database'"
    if ($LASTEXITCODE -ne 0) { throw "Could not connect to PostgreSQL. Check the password and that the service is running." }
    if ("$exists".Trim() -ne "1") {
        & $psql.FullName -h $DatabaseHost -p $Port -U $User -d postgres -c "CREATE DATABASE $Database" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not create the $Database database." }
        Write-Host "Created the $Database database."
    } else {
        Write-Host "The $Database database already exists."
    }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

$envFile = Join-Path $repo ".env"
$url = "postgresql://$([Uri]::EscapeDataString($User)):$([Uri]::EscapeDataString($password))@${DatabaseHost}:$Port/$Database"
Set-Content -Path $envFile -Value "DATABASE_URL=$url" -Encoding ascii
# Only your Windows account can read the file that holds the password.
icacls $envFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
Write-Host "Wrote .env (ignored by git, readable only by you)."

$refresh = Join-Path $repo "scripts\refresh.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$refresh`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Refreshes kenya-prices-pipeline and pushes the curated data when it changes." -Force | Out-Null
Write-Host "Scheduled $TaskName for $Time every day. Run it now with: Start-ScheduledTask -TaskName $TaskName"
