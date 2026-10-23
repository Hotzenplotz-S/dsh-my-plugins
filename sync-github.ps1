# sync-github.ps1 — 把本目录（plugins/）整体同步到 GitHub 仓库（走 REST API，无需安装 git）。
# 用法：  $env:GITHUB_TOKEN = "<你的 PAT>";  .\sync-github.ps1 [-Owner X] [-Repo Y] [-Message "..."]
# 若被执行策略拦截：  powershell -ExecutionPolicy Bypass -File sync-github.ps1
# token 只从环境变量读取，绝不写入磁盘或仓库。
[CmdletBinding()]
param(
  [string]$Owner = "Hotzenplotz-S",
  [string]$Repo = "dsh-my-plugins",
  [string]$Branch = "main",
  [string]$Message = "同步工作区插件"
)

$ErrorActionPreference = "Stop"
$token = $env:GITHUB_TOKEN
if (-not $token) { throw "请先设置 `$env:GITHUB_TOKEN（需要 repo 权限的 PAT）。" }

$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent"           = "dsh-my-plugins-sync"
}
$api = "https://api.github.com"

# 1. 确认仓库存在（首次运行时自动创建公开仓库）。
$repoExists = $true
try {
  $null = Invoke-RestMethod -Uri "$api/repos/$Owner/$Repo" -Headers $headers
} catch {
  $repoExists = $false
}
if (-not $repoExists) {
  $body = @{
    name        = $Repo
    description = "MY 系列自研 DeepSeek Harness 插件合集（窗口记忆、划词引用、图片气泡……）"
    private     = $false
    auto_init   = $true
  } | ConvertTo-Json
  $null = Invoke-RestMethod -Method Post -Uri "$api/user/repos" -Headers $headers -Body $body
  Write-Host "已创建仓库 $Owner/$Repo（public）"
  Start-Sleep -Seconds 2
}

# 2. 枚举本脚本所在目录下的所有文件（跳过 node_modules / .git）。
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

  # 远端已存在同名文件时，必须带上它的 sha 才能更新。
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
Write-Host "完成：$ok 个已上传，$fail 个失败 -> https://github.com/$Owner/$Repo"
