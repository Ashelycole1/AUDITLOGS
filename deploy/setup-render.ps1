# Connects Claude Code to Render's MCP server and prepares the staging values Render asks for.
# Run it yourself in PowerShell, from the repository root:   .\deploy\setup-render.ps1
# The API key is typed into a hidden prompt, so it never appears on screen or in a chat.
$ErrorActionPreference = "Stop"

Write-Host "1/2  Connect Render to Claude Code" -ForegroundColor Cyan
Write-Host "     Create a key in Render: Account Settings > API Keys > Create API Key."
$secure = Read-Host "     Paste the Render API key (hidden)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if ([string]::IsNullOrWhiteSpace($key)) { throw "No key entered. Nothing was changed." }
if ($key -notmatch '^rnd_') { Write-Warning "Render API keys normally start with rnd_. Check that you copied the whole key." }

# Replace an earlier entry if there is one, then add the server for this project only.
claude mcp remove render 2>$null | Out-Null
claude mcp add --transport http render https://mcp.render.com/mcp --header "Authorization: Bearer $key"
Remove-Variable key
Write-Host "     Render is connected for this project." -ForegroundColor Green

Write-Host ""
Write-Host "2/2  Staging values for Render (dummy data only)" -ForegroundColor Cyan
$python = Join-Path $PSScriptRoot "..\backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }
$fernet = & $python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
$seed = & $python -c "import secrets; print(secrets.token_urlsafe(16))"
$file = Join-Path $HOME "auditlogs-staging-secrets.txt"
@"
AuditLogs staging on Render. DUMMY DATA ONLY. Keep this file private; do not commit it.
Created $(Get-Date -Format "yyyy-MM-dd HH:mm")

EVIDENCE_ENCRYPTION_KEY=$fernet
DEV_SEED_PASSWORD=$seed

Paste both into the Render dashboard when the Blueprint asks for them (deploy/STAGING.md, step 1).
DEV_SEED_PASSWORD is the password for the 7 demo accounts.
"@ | Set-Content -Path $file -Encoding utf8
Write-Host "     Saved to $file" -ForegroundColor Green
Write-Host "     Open it, and paste the two values into Render when the Blueprint asks."

Write-Host ""
Write-Host "Done. Now restart Claude Code (type /exit, then run: claude) so it loads the Render connection." -ForegroundColor Cyan
