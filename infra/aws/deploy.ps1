<#
 Builds a release in CodeBuild (ARM) and deploys it to the instance through SSM Run Command.
 Steps: zip the working tree -> S3 -> CodeBuild -> release.tgz in S3 -> SSM runs deploy.sh (migrate, switch, health
 check, automatic rollback).   Usage: .\infra\aws\deploy.ps1 [-SkipBuild -ReleaseKey releases/<id>/release.tgz]
#>
[CmdletBinding()]
param(
  [string]$Region = "ap-southeast-2",
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\..\apps\web\.env"),
  [switch]$SkipBuild,
  [string]$ReleaseKey
)
$ErrorActionPreference = "Stop"
$account = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0) { throw "Not signed in to AWS. Run: aws login" }
$bucket = "somacue-artifacts-$account-$Region"

if (-not $SkipBuild) {
  $zip = & (Join-Path $PSScriptRoot "package-source.ps1")
  aws s3 cp $zip "s3://$bucket/source/source.zip" --region $Region --only-show-errors
  if ($LASTEXITCODE -ne 0) { throw "source upload failed" }

  $sha = (git rev-parse --short HEAD).Trim()
  $ReleaseKey = "releases/{0}-{1}/release.tgz" -f (Get-Date -Format "yyyyMMddHHmmss"), $sha

  # Public values that are compiled into the browser bundle (not secret).
  $public = @{}
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match '^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=(.*)$') { $public[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
  }
  $public["NEXT_PUBLIC_APP_URL"] = "https://somacue.abhishekt.dev"
  $overrides = @(@{ name = "RELEASE_KEY"; value = $ReleaseKey; type = "PLAINTEXT" })
  foreach ($k in $public.Keys) { if ($public[$k]) { $overrides += @{ name = $k; value = $public[$k]; type = "PLAINTEXT" } } }
  $json = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($json, ($overrides | ConvertTo-Json -AsArray -Compress), (New-Object Text.UTF8Encoding($false)))
    $buildId = aws codebuild start-build --project-name somacue-release --region $Region `
      --environment-variables-override "file://$json" --query build.id --output text
  } finally { Remove-Item $json -Force -ErrorAction SilentlyContinue }
  if ($LASTEXITCODE -ne 0) { throw "could not start the build" }
  Write-Host "build $buildId started, release $ReleaseKey"

  do {
    Start-Sleep -Seconds 15
    $status = aws codebuild batch-get-builds --ids $buildId --region $Region --query "builds[0].[buildStatus,currentPhase]" --output text
    Write-Host "  $status"
  } while ($status -match "IN_PROGRESS")
  if ($status -notmatch "^SUCCEEDED") {
    aws codebuild batch-get-builds --ids $buildId --region $Region --query "builds[0].phases[?phaseStatus=='FAILED'].contexts[].message" --output text
    throw "build failed: $status (logs: CloudWatch /aws/codebuild/somacue-release)"
  }
}
if (-not $ReleaseKey) { throw "-SkipBuild needs -ReleaseKey" }

$instance = aws ec2 describe-instances --region $Region --filters "Name=tag:Name,Values=somacue" "Name=instance-state-name,Values=running" `
  --query "Reservations[0].Instances[0].InstanceId" --output text
if (-not $instance -or $instance -eq "None") { throw "no running instance tagged Name=somacue" }
$params = @{ commands = @("/opt/somacue/bin/deploy.sh $ReleaseKey") } | ConvertTo-Json -Compress
$pf = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($pf, $params, (New-Object Text.UTF8Encoding($false)))
  $cmd = aws ssm send-command --region $Region --instance-ids $instance --document-name AWS-RunShellScript `
    --parameters "file://$pf" --timeout-seconds 900 --query Command.CommandId --output text
} finally { Remove-Item $pf -Force -ErrorAction SilentlyContinue }
Write-Host "deploying on $instance (command $cmd)"
do {
  Start-Sleep -Seconds 5
  $state = aws ssm get-command-invocation --region $Region --command-id $cmd --instance-id $instance --query Status --output text 2>$null
} while ($state -in @("Pending", "InProgress", "Delayed", $null, ""))
aws ssm get-command-invocation --region $Region --command-id $cmd --instance-id $instance --query "StandardOutputContent" --output text
if ($state -ne "Success") {
  aws ssm get-command-invocation --region $Region --command-id $cmd --instance-id $instance --query "StandardErrorContent" --output text
  throw "deploy $state"
}
Write-Host "deployed $ReleaseKey"
