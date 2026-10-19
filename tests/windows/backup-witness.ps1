$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../../scripts/JessieMessage-sauvegardes-055.ps1')
$jmRoot = Join-Path $env:RUNNER_TEMP ('jm-witness-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $jmRoot
$jmFixture = Get-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'jm-witness-fixture.json') -Raw | ConvertFrom-Json
$script:JmAssertions = 0
function Assert-True { param($Value, [string]$Message) $script:JmAssertions++; if (-not $Value) { throw $Message } }
function Assert-Fails { param([scriptblock]$Operation) $jmFailed = $false; try { $null = & $Operation } catch { $jmFailed = $true }; Assert-True $jmFailed 'Operation should have failed.' }
function New-Witness {
    $jmDirectory = Join-Path $jmRoot ([Guid]::NewGuid().ToString('N'))
    Set-JmPrivateDirectory $jmDirectory
    Initialize-JmWitness $jmDirectory $jmFixture.empty.registryId
    return $jmDirectory
}
function Exchange {
    param([string]$Directory, $Snapshot = $null, [string]$RegistryId = $jmFixture.empty.registryId)
    return (Invoke-JmWitnessExchange $Directory ([pscustomobject]@{ version = 1; registryId = $RegistryId; challenge = 'c' * 64; snapshot = $Snapshot }))
}
try {
    Initialize-JmWitnessNative
    $jmDirectory = New-Witness
    $jmFirst = Exchange $jmDirectory $jmFixture.first
    Assert-True ($jmFirst.revision -eq 2 -and $jmFirst.sha256 -ceq $jmFixture.firstHash) 'Node/Windows snapshot or SHA differs.'
    Assert-True ((Get-JmWitnessJson $jmFirst.snapshot) -ceq $jmFixture.firstJson) 'Canonical JSON differs from Node.'
    Assert-True ((Exchange $jmDirectory $jmFixture.first).revision -eq 2) 'Identical snapshot published twice.'
    Assert-Fails { Exchange $jmDirectory $jmFixture.empty }
    Assert-Fails { Exchange $jmDirectory $jmFixture.third }
    Assert-Fails { Exchange $jmDirectory $null ('d' * 64) }
    Assert-Fails { Initialize-JmWitness $jmDirectory $jmFixture.empty.registryId }
    $jmHead = [IO.File]::ReadAllBytes((Join-Path $jmDirectory 'registry-head.json'))
    $jmSecond = Exchange $jmDirectory $jmFixture.second
    Assert-True ($jmSecond.revision -eq 3) 'Consecutive publication failed.'
    Assert-Fails { Exchange $jmDirectory $jmFixture.first }
    [IO.File]::WriteAllBytes((Join-Path $jmDirectory 'registry-head.json'), $jmHead)
    Assert-True ((Exchange $jmDirectory).revision -eq 3) 'Complete interrupted publication not finished safely.'
    Remove-Item -LiteralPath (Join-Path $jmDirectory 'registry-head.json')
    Assert-Fails { Exchange $jmDirectory }
    Assert-True (@(Get-ChildItem -LiteralPath $jmDirectory -Filter 'registry-head.json').Count -eq 0) 'Lost witness automatically initialized.'
    $jmDirectory = New-Witness
    $jmPartial = Join-Path $jmDirectory ('registry-0000000000000002-' + ('e' * 64) + '.json')
    [IO.File]::WriteAllText($jmPartial, 'partial')
    Assert-Fails { Exchange $jmDirectory }
    $jmDirectory = New-Witness
    $jmCurrent = Get-ChildItem -LiteralPath $jmDirectory -Filter 'registry-0000000000000001-*'
    $null = New-Item -ItemType HardLink -Path (Join-Path $jmRoot 'hardlinked-publication') -Target $jmCurrent.FullName
    Assert-Fails { Exchange $jmDirectory }
    $jmDirectory = New-Witness
    $jmCurrent = Get-ChildItem -LiteralPath $jmDirectory -Filter 'registry-0000000000000001-*'
    $jmCurrent.Delete()
    Assert-Fails { Exchange $jmDirectory }
    $jmDirectory = New-Witness
    $null = New-Item -ItemType File -Path (Join-Path $jmDirectory 'head-uncertain.pending')
    Assert-Fails { Exchange $jmDirectory }
    $jmDirectory = New-Witness
    $jmLock = New-Object IO.FileStream((Join-Path $jmDirectory 'witness.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try { Assert-Fails { Exchange $jmDirectory } } finally { $jmLock.Dispose() }
    $jmTask = New-JmTaskDefinition 'C:\synthetic\agent.ps1' -WitnessTask
    Assert-True ($jmTask.Principal.LogonType -eq 3 -and $jmTask.Principal.RunLevel -eq 0) 'Witness elevated or noninteractive.'
    Assert-True ([Xml.XmlConvert]::ToTimeSpan($jmTask.Triggers[0].Repetition.Interval).TotalMinutes -eq 1) 'Wrong witness timing.'
    # Actual update helper with real DPAPI configuration; task registration is
    # captured instead of altering a runner/user's scheduled tasks.
    $jmUpgrade = Join-Path $jmRoot 'existing-pc'; Set-JmPrivateDirectory $jmUpgrade
    $jmConfig = [pscustomobject]@{ Version = 1; DestinationId = '1' * 32; LocationId = '2' * 32; Folder = 'C:\original backup folder';
        Credential = (New-Object Management.Automation.PSCredential(('1' * 32), (ConvertTo-SecureString ('A' * 43) -AsPlainText -Force))) }
    Save-JmConfiguration $jmConfig $jmUpgrade
    $jmBefore = (Get-FileHash -LiteralPath (Join-Path $jmUpgrade 'configuration.xml') -Algorithm SHA256).Hash
    $script:JmTasks = @()
    function Register-JmAgentTasks { param([string]$Directory, [string]$DestinationId) $script:JmTasks += $DestinationId }
    Invoke-JmAgentUpdate $jmUpgrade (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent | Join-Path -ChildPath 'scripts') $jmConfig.DestinationId
    Assert-True ($script:JmTasks.Count -eq 1 -and $script:JmTasks[0] -ceq $jmConfig.DestinationId) 'Update did not retain destination.'
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $jmUpgrade 'configuration.xml') -Algorithm SHA256).Hash -ceq $jmBefore) 'Update rewrote DPAPI pairing or folder.'
    Assert-True ((Read-JmConfiguration $jmUpgrade).Credential.GetNetworkCredential().Password -ceq ('A' * 43)) 'Update lost existing capability.'
    Assert-True (Test-Path -LiteralPath (Join-Path $jmUpgrade 'JessieMessage-temoin-067.ps1')) 'Updated witness library missing.'
    Assert-Fails { Invoke-JmAgentUpdate $jmUpgrade (Join-Path $jmRoot 'absent') $jmConfig.DestinationId }
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $jmUpgrade 'configuration.xml') -Algorithm SHA256).Hash -ceq $jmBefore) 'Failed update rewrote configuration.'
    Write-Output ('Windows witness: ' + $script:JmAssertions + ' assertions; real durable NTFS files, Node interoperability, missing/old/partial/hardlinked publication, locking, DPAPI-preserving upgrade. No real endpoint or task registered.')
} finally { Remove-Item -LiteralPath $jmRoot -Recurse -Force }
