<# Uploads the host scripts and unit files to s3://<artifacts>/scripts/ (bootstrap.sh downloads them from there). #>
[CmdletBinding()]
param([string]$Region = "ap-southeast-2")
$ErrorActionPreference = "Stop"
$account = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0) { throw "Not signed in to AWS. Run: aws login" }
$bucket = "somacue-artifacts-$account-$Region"
$dir = Join-Path $PSScriptRoot "instance"
aws s3 sync $dir "s3://$bucket/scripts/" --delete --region $Region --only-show-errors
if ($LASTEXITCODE -ne 0) { throw "upload failed" }
"scripts uploaded to s3://$bucket/scripts/"
