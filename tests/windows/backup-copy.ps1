$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../../scripts/JessieMessage-sauvegardes-055.ps1')
$jmTestRoot = Join-Path $env:RUNNER_TEMP ('jm-copy-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $jmTestRoot
$script:JmFixture = [Text.Encoding]::UTF8.GetBytes('Synthetic encrypted fixture, never a real backup.')
$script:JmCalls = New-Object Collections.Generic.List[string]
$script:JmDownloads = New-Object Collections.Generic.List[string]
$script:JmReceipts = New-Object Collections.Generic.List[string]
$script:JmCorrupt = $false
$script:JmArchives = @()
$script:JmManifestOverride = $null
function Assert-True { param($Value, [string]$Message) if (-not $Value) { throw $Message } }
function Assert-Fails { param([scriptblock]$Operation) $jmFailed = $false; try { $null = & $Operation } catch { $jmFailed = $true }; Assert-True $jmFailed 'Operation should have failed.' }
function Invoke-JmApi {
    param([string]$Action, [string]$Token = '', $Body = $null, [string]$LocationId = '', [string]$CaptureId = '', [string]$OutputFile = '')
    $script:JmCalls.Add($Action)
    if ($Action -eq 'manifest') {
        if ($null -ne $script:JmManifestOverride) { return $script:JmManifestOverride }
        return [pscustomobject]@{ version = 1; paused = $false; archives = @($script:JmArchives) }
    }
    if ($Action -eq 'archive') {
        Assert-True (@($script:JmArchives.Where({ $_.id -ceq $CaptureId })).Count -eq 1) 'Download is not in the validated fixture catalogue.'
        $script:JmDownloads.Add($CaptureId)
        if ($script:JmCorrupt) { [IO.File]::WriteAllText($OutputFile, 'corrupt') } else { [IO.File]::WriteAllBytes($OutputFile, $script:JmFixture) }; return
    }
    if ($Action -eq 'receipt') {
        $jmReceived = @($script:JmArchives.Where({ $_.id -ceq $Body.captureId }))
        Assert-True ($jmReceived.Count -eq 1) 'Receipt is not in the validated fixture catalogue.'
        Assert-True (Test-JmArchive (Join-Path $script:JmCurrentFolder $jmReceived[0].filename) $jmReceived[0]) 'Receipt preceded verified final file.'
        Assert-True ($Body.sha256 -ceq $jmReceived[0].sha256 -and $Body.bytes -eq $jmReceived[0].bytes) 'Wrong receipt hash or size.'
        $script:JmReceipts.Add($Body.captureId)
        return [pscustomobject]@{ recorded = $true }
    }
    throw 'Unexpected action.'
}
try {
    $jmHash = [Security.Cryptography.SHA256]::Create()
    try { $jmSha = ([BitConverter]::ToString($jmHash.ComputeHash($script:JmFixture))).Replace('-', '').ToLowerInvariant() } finally { $jmHash.Dispose() }
    $jmId = 'capture-1792340000000-cccccccccccccccc'
    $script:JmArchive = [pscustomobject]@{ id = $jmId; startedAt = 1792340000000L; bytes = $script:JmFixture.Length; sha256 = $jmSha; filename = ('JessieMessage-' + $jmId + '.tar.gz.gpg') }
    $script:JmArchives = @($script:JmArchive)
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

    # A full new catalogue takes several real copy/hash passes. Even when a new
    # archive arrives between passes, it is copied and acknowledged first; the
    # older tail cannot replace that receipt or force a repeated download.
    function New-JmArchiveFixture {
        param([int]$Number)
        $jmStarted = 1792340000000L + $Number
        $jmArchiveId = 'capture-' + $jmStarted + '-cccccccccccccccc'
        return [pscustomobject]@{ id = $jmArchiveId; startedAt = $jmStarted; bytes = $script:JmFixture.Length; sha256 = $jmSha; filename = ('JessieMessage-' + $jmArchiveId + '.tar.gz.gpg') }
    }
    $script:JmCurrentFolder = Join-Path $jmTestRoot 'multiple passes'
    $null = New-Item -ItemType Directory -Path $script:JmCurrentFolder
    $jmConfiguration.Folder = $script:JmCurrentFolder
    $script:JmArchives = @(1..45 | ForEach-Object { New-JmArchiveFixture $_ })
    $script:JmCalls.Clear(); $script:JmDownloads.Clear(); $script:JmReceipts.Clear()
    $null = Invoke-JmCopies $jmConfiguration
    Assert-True ($script:JmDownloads.Count -eq 20 -and $script:JmDownloads[0] -ceq $script:JmArchives[-1].id) 'First pass did not prioritize the latest within its twenty-download bound.'
    Assert-True ($script:JmReceipts.Count -eq 1 -and $script:JmReceipts[0] -ceq $script:JmArchives[-1].id) 'An older file replaced the newest receipt.'
    $script:JmArchives += New-JmArchiveFixture 46
    $jmBeforeDownloads = $script:JmDownloads.Count
    $null = Invoke-JmCopies $jmConfiguration
    Assert-True ($script:JmDownloads.Count -eq $jmBeforeDownloads + 20 -and $script:JmDownloads[$jmBeforeDownloads] -ceq $script:JmArchives[-1].id) 'A new arrival did not progress first on the next pass.'
    Assert-True ($script:JmReceipts[-1] -ceq $script:JmArchives[-1].id) 'New arrival was not acknowledged.'
    $null = Invoke-JmCopies $jmConfiguration
    Assert-True ($script:JmDownloads.Count -eq 46 -and @($script:JmDownloads | Select-Object -Unique).Count -eq 46) 'Multiple passes failed to copy each archive exactly once.'
    Assert-True (@(Get-ChildItem -LiteralPath $script:JmCurrentFolder -File).Count -eq 46) 'The old archive tail was not completed.'
    Assert-True ($script:JmReceipts.Count -eq 3 -and $script:JmReceipts[-1] -ceq $script:JmArchives[-1].id) 'The completed old tail rolled the receipt back.'

    # Model an arbitrarily costly existing old prefix through the internal
    # clock only. The real local file hashing and download/receipt checks stay
    # unchanged. No ten-minute sleep or network endpoint is involved.
    $script:JmNativeArchiveTest = (Get-Command Test-JmArchive).ScriptBlock
    $script:JmSlowOldArchive = $script:JmArchives[0].id
    $script:JmSyntheticNow = [DateTime]::UtcNow
    $script:JmSlowHashAt = $script:JmSyntheticNow.AddMinutes(9).AddSeconds(1)
    function Test-JmArchive {
        param([string]$File, $Archive)
        $jmValid = & $script:JmNativeArchiveTest $File $Archive
        if ($Archive.id -ceq $script:JmSlowOldArchive) {
            Assert-True ($script:JmReceipts[-1] -ceq $script:JmArchives[-1].id) 'Older hashing started before the latest receipt.'
            $script:JmSyntheticNow = $script:JmSlowHashAt
        }
        return $jmValid
    }
    $script:JmSlowOldArchive = $script:JmArchives[-2].id
    $script:JmArchives += New-JmArchiveFixture 47
    $jmBeforeDownloads = $script:JmDownloads.Count
    $jmStatus = Invoke-JmCopies $jmConfiguration -Clock { $script:JmSyntheticNow }
    Assert-True ($script:JmDownloads.Count -eq $jmBeforeDownloads + 1 -and $script:JmDownloads[-1] -ceq $script:JmArchives[-1].id) 'An expensive existing prefix prevented the latest copy.'
    Assert-True ($script:JmReceipts[-1] -ceq $script:JmArchives[-1].id -and $jmStatus.Contains('prochain passage')) 'Budget exhaustion lost the latest receipt.'
    $script:JmSyntheticNow = [DateTime]::UtcNow; $script:JmSlowHashAt = $script:JmSyntheticNow.AddMinutes(9).AddSeconds(1)
    $script:JmArchives += New-JmArchiveFixture 48
    $jmBeforeDownloads = $script:JmDownloads.Count
    $null = Invoke-JmCopies $jmConfiguration -Clock { $script:JmSyntheticNow }
    Assert-True ($script:JmDownloads.Count -eq $jmBeforeDownloads + 1 -and $script:JmReceipts[-1] -ceq $script:JmArchives[-1].id) 'The same expensive old prefix starved a later arrival.'
    Set-Item -LiteralPath Function:Test-JmArchive -Value $script:JmNativeArchiveTest

    # Reject the whole catalogue before an otherwise valid early archive can
    # trigger a download, local rename or receipt.
    $jmFirst = New-JmArchiveFixture 100; $jmSecond = New-JmArchiveFixture 101
    foreach ($jmBadCatalogue in @(
        @($jmSecond, $jmFirst), @($jmFirst, $jmFirst),
        @($jmFirst, [pscustomobject]@{ id = $jmSecond.id; startedAt = $jmSecond.startedAt; bytes = 0; sha256 = $jmSecond.sha256; filename = $jmSecond.filename }),
        @($jmFirst, [pscustomobject]@{ id = $jmSecond.id; startedAt = $jmSecond.startedAt; bytes = 2151677953L; sha256 = $jmSecond.sha256; filename = $jmSecond.filename }),
        @($jmFirst, [pscustomobject]@{ id = $jmSecond.id; startedAt = $jmSecond.startedAt + 1; bytes = $jmSecond.bytes; sha256 = $jmSecond.sha256; filename = $jmSecond.filename }),
        @($jmFirst, [pscustomobject]@{ id = $jmSecond.id; startedAt = $jmSecond.startedAt; bytes = 1.5; sha256 = $jmSecond.sha256; filename = $jmSecond.filename }),
        @($jmFirst, [pscustomobject]@{ id = $jmSecond.id; startedAt = $jmSecond.startedAt; bytes = $jmSecond.bytes; sha256 = $jmSecond.sha256; filename = $jmSecond.filename; extra = $true })
    )) {
        $script:JmArchives = $jmBadCatalogue
        $script:JmCalls.Clear(); $jmFilesBefore = @(Get-ChildItem -LiteralPath $script:JmCurrentFolder -File).Count
        Assert-Fails { Invoke-JmCopies $jmConfiguration }
        Assert-True (($script:JmCalls -join ',') -ceq 'manifest') 'A malformed or unordered catalogue touched an archive or receipt.'
        Assert-True (@(Get-ChildItem -LiteralPath $script:JmCurrentFolder -File).Count -eq $jmFilesBefore) 'A rejected catalogue changed local files.'
    }
    foreach ($jmBadManifest in @(
        [pscustomobject]@{ version = 1; paused = $false; archives = @(); latestCaptureId = $jmSecond.id },
        [pscustomobject]@{ version = '1'; paused = $false; archives = @() },
        [pscustomobject]@{ version = 1; paused = $false; archives = $jmFirst },
        [pscustomobject]@{ version = 1; paused = $true; archives = @($jmFirst) },
        [pscustomobject]@{ version = 1; paused = $false; archives = @(1..2001 | ForEach-Object { New-JmArchiveFixture $_ }) }
    )) {
        $script:JmManifestOverride = $jmBadManifest
        $script:JmCalls.Clear(); Assert-Fails { Invoke-JmCopies $jmConfiguration }
        Assert-True (($script:JmCalls -join ',') -ceq 'manifest') 'An invalid manifest or catalogue bound was accepted.'
    }
    $script:JmManifestOverride = [pscustomobject]@{ version = 1; paused = $true; archives = @() }
    $script:JmCalls.Clear(); $null = Invoke-JmCopies $jmConfiguration
    Assert-True (($script:JmCalls -join ',') -ceq 'manifest') 'Paused copies accessed an archive or receipt.'
    $script:JmManifestOverride = [pscustomobject]@{ version = 1; paused = $false; archives = @() }
    $script:JmCalls.Clear(); $null = Invoke-JmCopies $jmConfiguration
    Assert-True (($script:JmCalls -join ',') -ceq 'manifest') 'An empty catalogue produced an unsupported receipt.'
    $script:JmManifestOverride = $null

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
    Assert-True ($jmTask.Triggers.Count -eq 2 -and [Xml.XmlConvert]::ToTimeSpan($jmTask.Triggers[0].Repetition.Interval).TotalMinutes -eq 15) 'Wrong task timing.'
    Write-Output 'Windows: hash, corrupt/interrupted copy, no overwrite, twenty-download multi-pass catch-up, latest-first progress across an expensive old prefix, canonical catalogue refusal, newest receipt, DPAPI and task definition verified. No real endpoint or task registered.'
} finally { Remove-Item -LiteralPath $jmTestRoot -Recurse -Force }
