# Helper for running a shell script on the SomaCue instance through SSM Run Command.
# Usage:  . .\infra\aws\host.ps1 ; Invoke-Host 'systemctl is-active somacue'
# The instance is found by its tag (Name=somacue), so no instance id is stored in the repository.
function Get-SomacueInstanceId([string]$Region = 'ap-southeast-2') {
  $id = aws ec2 describe-instances --region $Region --filters 'Name=tag:Name,Values=somacue' 'Name=instance-state-name,Values=running' `
    --query 'Reservations[0].Instances[0].InstanceId' --output text
  if (-not $id -or $id -eq 'None') { throw 'No running instance tagged Name=somacue (are you signed in? aws login)' }
  $id
}
function Invoke-Host([string]$Script, [int]$TimeoutSec = 900, [string]$Region = 'ap-southeast-2') {
  $iid = Get-SomacueInstanceId $Region
  $pf = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($pf, (@{ commands = @($Script) } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  $id = aws ssm send-command --region $Region --instance-ids $iid --document-name AWS-RunShellScript --parameters "file://$pf" --timeout-seconds $TimeoutSec --query Command.CommandId --output text
  Remove-Item $pf -Force
  do { Start-Sleep 5; $st = aws ssm get-command-invocation --region $Region --command-id $id --instance-id $iid --query Status --output text 2>$null } while ($st -in 'Pending', 'InProgress', 'Delayed', '', $null)
  aws ssm get-command-invocation --region $Region --command-id $id --instance-id $iid --query StandardOutputContent --output text
  $err = aws ssm get-command-invocation --region $Region --command-id $id --instance-id $iid --query StandardErrorContent --output text
  if ($err -and $err -ne 'None') { '--- stderr'; ($err -split "`n" | Select-Object -Last 25) -join "`n" }
  "status: $st"
}
