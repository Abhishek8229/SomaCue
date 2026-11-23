<#
 Writes the production configuration to SSM Parameter Store as SecureStrings under /somacue/prod/.
  - Copies the third-party values (Google, AI, Razorpay, promo codes, public business details) from apps/web/.env.
  - Generates fresh SESSION_SECRET, database passwords, X_ORIGIN_VERIFY and BACKUP_PASSPHRASE. An existing generated
    value is kept, so running this twice never rotates a secret by accident (use -Rotate <name> for that).
 No value is ever printed or written to a tracked file. Each value passes through a temp file that is deleted at once.
#>
[CmdletBinding()]
param(
  [string]$Region = "ap-southeast-2",
  [string]$Domain = "somacue.abhishekt.dev",
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\..\apps\web\.env"),
  [string[]]$Rotate = @()
)
$ErrorActionPreference = "Stop"
$account = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0) { throw "Not signed in to AWS. Run: aws login" }
$uploads = "somacue-uploads-$account-$Region"

function Read-DotEnv([string]$path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $map[$Matches[1]] = $value
  }
  $map
}
function New-RandomString([int]$length) {
  $chars = [char[]](48..57 + 65..90 + 97..122)
  -join (1..$length | ForEach-Object { $chars[[Security.Cryptography.RandomNumberGenerator]::GetInt32($chars.Length)] })
}
function New-Base64Url([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function Test-Parameter([string]$name) {
  aws ssm get-parameter --name "/somacue/prod/$name" --region $Region --query Parameter.Name --output text 2>$null | Out-Null
  $LASTEXITCODE -eq 0
}
function Get-Parameter([string]$name) {
  aws ssm get-parameter --name "/somacue/prod/$name" --with-decryption --region $Region --query Parameter.Value --output text
}
function Set-Parameter([string]$name, [string]$value) {
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, $value, (New-Object Text.UTF8Encoding($false)))
    aws ssm put-parameter --name "/somacue/prod/$name" --type SecureString --overwrite --region $Region --value "file://$tmp" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "put-parameter failed for $name" }
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

$local = Read-DotEnv $EnvFile
$copy = @(
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "PROMO_CODES",
  "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_PRO_PLAN_ID",
  "RAZORPAY_PRO_PLAN_2M_ID", "RAZORPAY_PRO_PLAN_3M_ID",
  "NEXT_PUBLIC_BUSINESS_LEGAL_NAME", "NEXT_PUBLIC_SUPPORT_EMAIL", "NEXT_PUBLIC_SUPPORT_PHONE",
  "NEXT_PUBLIC_BUSINESS_ADDRESS", "NEXT_PUBLIC_EMERGENCY_NUMBER"
)
$required = @("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "PROMO_CODES",
  "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET")
$missing = $required | Where-Object { -not $local[$_] }
if ($missing) { throw "Missing in $EnvFile : $($missing -join ', ')" }

$written = [System.Collections.Generic.List[string]]::new()
foreach ($name in $copy) {
  if ($local[$name]) { Set-Parameter $name $local[$name]; $written.Add("$name (from .env)") }
}

$generated = [ordered]@{
  SESSION_SECRET    = { New-Base64Url 48 }
  DB_APP_PASSWORD   = { New-RandomString 32 }
  DB_OWNER_PASSWORD = { New-RandomString 32 }
  X_ORIGIN_VERIFY   = { New-RandomString 40 }
  BACKUP_PASSPHRASE = { New-RandomString 48 }
}
foreach ($name in $generated.Keys) {
  if ((Test-Parameter $name) -and ($Rotate -notcontains $name)) { $written.Add("$name (kept)"); continue }
  Set-Parameter $name (& $generated[$name]); $written.Add("$name (generated)")
}

Set-Parameter "DATABASE_URL" ("postgresql://somacue_app:{0}@127.0.0.1:5432/somacue" -f (Get-Parameter "DB_APP_PASSWORD"))
Set-Parameter "NEXT_PUBLIC_APP_URL" "https://$Domain"
Set-Parameter "UPLOADS_BUCKET" $uploads
Set-Parameter "AWS_REGION" $Region
$written.Add("DATABASE_URL, NEXT_PUBLIC_APP_URL, UPLOADS_BUCKET, AWS_REGION (derived)")

$written | ForEach-Object { "  /somacue/prod/$_" }
