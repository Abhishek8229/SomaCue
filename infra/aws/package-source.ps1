<#
 Zips the working tree (tracked and untracked files that .gitignore does not exclude) into a source.zip that CodeBuild
 reads from S3. Secrets are never included: .env files, node_modules and build output are ignored by git.
#>
[CmdletBinding()]
param([string]$Out = (Join-Path $env:TEMP "somacue-source.zip"))
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = (git rev-parse --show-toplevel).Trim()
Push-Location $root
try {
  $skip = '^(\.kiro|\.agents|\.claude|\.cursor|\.devin|\.hallmark|\.git)/|^docs/(screenshots|3d-|benchmarks)|^start\.log$|(^|/)\.env($|\.)'
  $files = git ls-files -co --exclude-standard | Where-Object { $_ -notmatch $skip -and (Test-Path -LiteralPath $_ -PathType Leaf) }
  if (Test-Path $Out) { Remove-Item $Out -Force }
  $zip = [IO.Compression.ZipFile]::Open($Out, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $files) {
      $entry = $zip.CreateEntry($file.Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal)
      $in = [IO.File]::OpenRead((Join-Path $root $file)); $outStream = $entry.Open()
      try { $in.CopyTo($outStream) } finally { $outStream.Dispose(); $in.Dispose() }
    }
  } finally { $zip.Dispose() }
  $sizeMb = [math]::Round((Get-Item $Out).Length / 1MB, 1)
  Write-Host "source zip: $($files.Count) files, $sizeMb MB"
  if ($files -match '(^|/)\.env') { throw "refusing: an env file is in the archive" }
} finally { Pop-Location }
$Out
