# sync-github.ps1 - Upload this folder (plugins/) to the GitHub repo via REST API.
# Usage:  $env:GITHUB_TOKEN = "<pat>";  .\sync-github.ps1 [-Owner X] [-Repo Y] [-Message "..."]
# The token is read from the environment only; it is never written to disk.
[CmdletBinding()]
param(
  [string]$Owner = "Hotzenplotz-S",
  [string]$Repo = "dsh-my-plugins",
  [string]$Branch = "main",
  [string]$Message = "sync plugins from workspace"
)

$ErrorActionPreference = "Stop"
$token = $env:GITHUB_TOKEN
if (-not $token) { throw "Set `$env:GITHUB_TOKEN first (repo-scope PAT)." }

$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent"           = "dsh-my-plugins-sync"
}
$api = "https://api.github.com"

# 1. Ensure the repo exists (create a public repo on first run).
$repoExists = $true
try {
  $null = Invoke-RestMethod -Uri "$api/repos/$Owner/$Repo" -Headers $headers
} catch {
  $repoExists = $false
}
if (-not $repoExists) {
  $body = @{
    name        = $Repo
    description = "MY-series self-made DeepSeek Harness plugins (window bounds memory, selection quote, ...)"
    private     = $false
    auto_init   = $true
  } | ConvertTo-Json
  $null = Invoke-RestMethod -Method Post -Uri "$api/user/repos" -Headers $headers -Body $body
  Write-Host "Created repo $Owner/$Repo (public)"
  Start-Sleep -Seconds 2
}

# 2. Enumerate files under this script's directory.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$skip = @("node_modules", ".git")
$files = Get-ChildItem $root -Recurse -File | Where-Object {
  $rel = $_.FullName.Substring($root.Length + 1)
  $parts = $rel -split "[\\/]"
  -not ($parts | Where-Object { $skip -contains $_ })
}

$ok = 0; $fail = 0
foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1) -replace "\\", "/"
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $b64 = [System.Convert]::ToBase64String($bytes)

  # Existing remote file? Then its sha is required for update.
  $sha = $null
  try {
    $cur = Invoke-RestMethod -Uri "$api/repos/$Owner/$Repo/contents/$rel" -Headers $headers
    $sha = $cur.sha
  } catch { }

  $payload = @{ message = "${Message}: $rel"; content = $b64; branch = $Branch }
  if ($sha) { $payload.sha = $sha }
  $json = $payload | ConvertTo-Json -Compress

  try {
    $null = Invoke-RestMethod -Method Put -Uri "$api/repos/$Owner/$Repo/contents/$rel" -Headers $headers -Body $json
    $ok++
    Write-Host ("  ok   " + $rel)
  } catch {
    $fail++
    Write-Host ("  FAIL " + $rel + " : " + $_.Exception.Message)
  }
}
Write-Host ""
Write-Host "Done. $ok uploaded, $fail failed -> https://github.com/$Owner/$Repo"
