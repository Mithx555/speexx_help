# ตรวจความพร้อมของ Chrome Extension โดยไม่แก้ไขไฟล์ใด ๆ
# ใช้ก่อน commit หรือสร้าง GitHub Release: .\scripts\validate-extension.ps1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot 'extension'
$requiredFiles = @('manifest.json', 'content.js', 'content.css', 'popup.html', 'popup.js', 'popup.css', 'background.js', 'icons/graduation-cap.png')
$failed = $false

# แสดงผลแบบเดียวกันทุกข้อ เพื่อให้หาไฟล์ที่ขาดหรือเสียได้รวดเร็ว
function Write-CheckResult {
  param([string]$Name, [bool]$Passed, [string]$Detail = '')
  $state = if ($Passed) { 'PASS' } else { 'FAIL' }
  $color = if ($Passed) { 'Green' } else { 'Red' }
  Write-Host "[$state] $Name $Detail" -ForegroundColor $color
}

Write-Host 'Checking Speexx Helper extension...' -ForegroundColor Cyan

# ตรวจไฟล์ที่จำเป็นตามโครงสร้างของ extension
foreach ($relativePath in $requiredFiles) {
  $exists = Test-Path -LiteralPath (Join-Path $extensionRoot $relativePath) -PathType Leaf
  Write-CheckResult "Required file: $relativePath" $exists
  if (-not $exists) { $failed = $true }
}

# ตรวจว่า manifest เป็น JSON ถูกต้องและมีข้อมูลหลักสำหรับ Chrome Extension
try {
  $manifestPath = Join-Path $extensionRoot 'manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $manifestOk = $manifest.manifest_version -eq 3 -and -not [string]::IsNullOrWhiteSpace($manifest.name) -and -not [string]::IsNullOrWhiteSpace($manifest.version)
  Write-CheckResult 'Manifest structure' $manifestOk "(v$($manifest.version))"
  if (-not $manifestOk) { $failed = $true }
} catch {
  Write-CheckResult 'Manifest structure' $false $_.Exception.Message
  $failed = $true
}

# ใช้ Node ตรวจไวยากรณ์ JavaScript หากเครื่องมี Node.js ติดตั้งอยู่
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  foreach ($scriptName in @('content.js', 'popup.js', 'background.js')) {
    & $node.Source --check (Join-Path $extensionRoot $scriptName)
    $syntaxOk = $LASTEXITCODE -eq 0
    Write-CheckResult "JavaScript syntax: $scriptName" $syntaxOk
    if (-not $syntaxOk) { $failed = $true }
  }
} else {
  Write-Host '[SKIP] JavaScript syntax: Node.js is not installed' -ForegroundColor Yellow
}

if ($failed) {
  Write-Host 'Validation failed.' -ForegroundColor Red
  exit 1
}

Write-Host 'Validation passed.' -ForegroundColor Green
