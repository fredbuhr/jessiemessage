$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../../scripts/JessieMessage-sauvegardes-055.ps1')
$jmTestRoot = Join-Path $env:RUNNER_TEMP ('jm-copy-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $jmTestRoot
$script:JmFixture = [Text.Encoding]::UTF8.GetBytes('Synthetic encrypted fixture, never a real backup.')
$script:JmCalls = New-Object Collections.Generic.List[string]
$script:JmCorrupt = $false
function Assert-True { param($Value, [string]$Message) if (-not $Value) { throw $Message } }
function Assert-Fails { param([scriptblock]$Operation) $jmFailed = $false; try { $null = & $Operation } catch { $jmFailed = $true }; Assert-True $jmFailed 'Operation should have failed.' }
function Invoke-JmApi {
    param([string]$Action, [string]$Token = '', $Body = $null, [string]$LocationId = '', [string]$CaptureId = '', [string]$OutputFile = '')
    $script:JmCalls.Add($Action)
    if ($Action -eq 'manifest') { return [pscustomobject]@{ version = 1; paused = $false; archives = @($script:JmArchive) } }
    if ($Action -eq 'archive') { if ($script:JmCorrupt) { [IO.File]::WriteAllText($OutputFile, 'corrupt') } else { [IO.File]::WriteAllBytes($OutputFile, $script:JmFixture) }; return }
    if ($Action -eq 'receipt') {
        Assert-True (Test-JmArchive (Join-Path $script:JmCurrentFolder $script:JmArchive.filename) $script:JmArchive) 'Receipt preceded verified final file.'
        Assert-True ($Body.sha256 -ceq $script:JmArchive.sha256) 'Wrong receipt hash.'
        return [pscustomobject]@{ recorded = $true }
    }
    throw 'Unexpected action.'
}
try {
    $jmHash = [Security.Cryptography.SHA256]::Create()
    try { $jmSha = ([BitConverter]::ToString($jmHash.ComputeHash($script:JmFixture))).Replace('-', '').ToLowerInvariant() } finally { $jmHash.Dispose() }
    $jmId = 'capture-1792340000000-cccccccccccccccc'
    $script:JmArchive = [pscustomobject]@{ id = $jmId; startedAt = 1792340000000L; bytes = $script:JmFixture.Length; sha256 = $jmSha; filename = ('JessieMessage-' + $jmId + '.tar.gz.gpg') }
    $script:JmCurrentFolder = Join-Path $jmTestRoot 'folder with spaces'
    $null = New-Item -ItemType Directory -Path $script:JmCurrentFolder
    $jmToken = 'A' * 43
    $jmCredential = New-Object Management.Automation.PSCredential(('1' * 32), (ConvertTo-SecureString $jmToken -AsPlainText -Force))
    $jmConfiguration = [pscustomobject]@{ Version = 1; DestinationId = '1' * 32; LocationId = '2' * 32; Folder = $script:JmCurrentFolder; Credential = $jmCredential }
    $null = Invoke-JmCopies $jmConfiguration
    Assert-True (($script:JmCalls -join ',') -ceq 'manifest,archive,receipt') 'Download and receipt ordering failed.'
    $script:JmCalls.Clear(); $null = Invoke-JmCopies $jmConfiguration
    Assert-True (($script:JmCalls -join ',') -ceq 'manifest,receipt') 'Verified copy downloaded again.'
    Remove-Item -LiteralPath (Join-Path $script:JmCurrentFolder $script:JmArchive.filename)
    $script:JmCalls.Clear(); $script:JmCorrupt = $true
    Assert-Fails { Invoke-JmCopies $jmConfiguration }
    Assert-True (-not $script:JmCalls.Contains('receipt')) 'Corrupt copy acknowledged.'
    Assert-True (@(Get-ChildItem -LiteralPath $script:JmCurrentFolder -Force).Count -eq 0) 'Partial copy left behind.'
    $script:JmCorrupt = $false
    [IO.File]::WriteAllText((Join-Path $script:JmCurrentFolder $script:JmArchive.filename), 'existing wrong file')
    $script:JmCalls.Clear(); Assert-Fails { Invoke-JmCopies $jmConfiguration }
    Assert-True (-not $script:JmCalls.Contains('archive') -and -not $script:JmCalls.Contains('receipt')) 'Mismatched existing file overwritten or acknowledged.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $script:JmCurrentFolder $script:JmArchive.filename)) -ceq 'existing wrong file') 'Existing file modified.'
    $jmPrivate = Join-Path $jmTestRoot 'private'
    Set-JmPrivateDirectory $jmPrivate
    Save-JmConfiguration -Configuration $jmConfiguration -Directory $jmPrivate
    $jmRestored = Read-JmConfiguration $jmPrivate
    Assert-True ($jmRestored.Credential.GetNetworkCredential().Password -ceq $jmToken) 'DPAPI credential reload failed.'
    Assert-True (-not ([IO.File]::ReadAllText((Join-Path $jmPrivate 'configuration.xml'))).Contains($jmToken)) 'Plaintext credential persisted.'
    $jmConfiguration.LocationId = '3' * 32
    Save-JmConfiguration -Configuration $jmConfiguration -Directory $jmPrivate
    Assert-True ((Read-JmConfiguration $jmPrivate).LocationId -ceq ('3' * 32)) 'Atomic settings replacement failed.'
    $jmTask = New-JmTaskDefinition (Join-Path $jmPrivate 'agent.ps1')
    Assert-True ($jmTask.Principal.LogonType -eq 3 -and $jmTask.Principal.RunLevel -eq 0) 'Unexpected task privilege or logon type.'
    Assert-True ($jmTask.Triggers.Count -eq 2 -and $jmTask.Triggers[0].Repetition.Interval -eq 'PT15M') 'Wrong task timing.'
    Write-Output 'Windows: hash, interrupted/corrupt copy, no overwrite, receipt ordering, DPAPI and task definition verified. No real endpoint or task registered.'
} finally { Remove-Item -LiteralPath $jmTestRoot -Recurse -Force }
