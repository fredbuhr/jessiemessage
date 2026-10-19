# The native worker never receives the server-side pairing fingerprint or a CRM key.
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
    # A real paired PC already has both scripts. The first update above only
    # exercises creation; replacing existing files must preserve its state too.
    $jmScripts = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent | Join-Path -ChildPath 'scripts'
    foreach ($jmName in @('JessieMessage-temoin-067.ps1', 'JessieMessage-sauvegardes-055.ps1')) {
        [IO.File]::WriteAllText((Join-Path $jmUpgrade $jmName), '# Previously installed synthetic version.')
    }
    $jmMarker = Join-Path $jmUpgrade 'witness-enrollment-attempt.json'
    [IO.File]::WriteAllText($jmMarker, 'Existing initialization marker remains unchanged.')
    $jmMarkerHash = (Get-FileHash -LiteralPath $jmMarker -Algorithm SHA256).Hash
    Invoke-JmAgentUpdate $jmUpgrade $jmScripts $jmConfig.DestinationId
    foreach ($jmName in @('JessieMessage-temoin-067.ps1', 'JessieMessage-sauvegardes-055.ps1')) {
        Assert-True ((Get-FileHash -LiteralPath (Join-Path $jmUpgrade $jmName) -Algorithm SHA256).Hash -ceq (Get-FileHash -LiteralPath (Join-Path $jmScripts $jmName) -Algorithm SHA256).Hash) 'Existing script was not replaced by the update.'
    }
    Assert-True ($script:JmTasks.Count -eq 2) 'Existing-file update did not complete.'
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $jmUpgrade 'configuration.xml') -Algorithm SHA256).Hash -ceq $jmBefore) 'Existing-file update rewrote DPAPI configuration.'
    Assert-True ((Get-FileHash -LiteralPath $jmMarker -Algorithm SHA256).Hash -ceq $jmMarkerHash) 'Existing-file update rewrote the initialization marker.'
    Assert-Fails { Invoke-JmAgentUpdate $jmUpgrade (Join-Path $jmRoot 'absent') $jmConfig.DestinationId }
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $jmUpgrade 'configuration.xml') -Algorithm SHA256).Hash -ceq $jmBefore) 'Failed update rewrote configuration.'
    $script:JmOriginalApi = (Get-Item function:Invoke-JmWitnessApi).ScriptBlock
    $script:JmOriginalInitialize = (Get-Item function:Initialize-JmWitness).ScriptBlock
    $script:JmInitCalls = 0; $script:JmApiCalls = 0; $script:JmConsumed = @{}; $script:JmRefuse = $false; $script:JmWrongMetadata = $false; $script:JmLoseResponse = $false; $script:JmInterrupt = $false
    function Initialize-JmWitness {
        param([string]$Directory, [string]$RegistryId)
        $script:JmInitCalls++
        if ($script:JmInterrupt) { throw 'Synthetic interruption after durable started marker.' }
        & $script:JmOriginalInitialize $Directory $RegistryId
    }
    function Invoke-JmWitnessApi {
        param([string]$Action, [string]$Token, $Body = $null)
        $script:JmApiCalls++
        Assert-True ($Action -ceq 'enroll' -and $Token -ceq ('A' * 43)) 'Enrollment replaced native capability.'
        Assert-JmWitnessFields ([pscustomobject]$Body) @('version', 'destinationId', 'attemptId')
        if ($script:JmRefuse) { throw 'Synthetic server rejection.' }
        $jmInitialize = -not $script:JmConsumed.ContainsKey($Body.attemptId)
        $script:JmConsumed[$Body.attemptId] = $true
        if ($script:JmLoseResponse) { throw 'Synthetic lost response after consumption.' }
        return [pscustomobject][ordered]@{ version = 1; initialize = $jmInitialize; destinationId = $Body.destinationId; attemptId = $Body.attemptId;
            contractSha256 = ('c' * 64); contractId = ('d' * 64); registryId = $jmFixture.empty.registryId;
            initialSnapshotSha256 = $(if ($script:JmWrongMetadata) { 'e' * 64 } else { $jmFixture.emptyHash }) }
    }
    function New-EnrollmentPc {
        $jmDirectory = Join-Path $jmRoot ('pc-' + [Guid]::NewGuid().ToString('N'))
        Set-JmPrivateDirectory $jmDirectory
        Save-JmConfiguration $jmConfig $jmDirectory
        [IO.File]::WriteAllText((Join-Path $jmDirectory 'dernier-etat.txt'), 'Existing receipt remains byte-for-byte unchanged.')
        return $jmDirectory
    }
    $jmEnrollment = New-EnrollmentPc
    $jmConfigurationHash = (Get-FileHash -LiteralPath (Join-Path $jmEnrollment 'configuration.xml') -Algorithm SHA256).Hash
    $jmReceiptHash = (Get-FileHash -LiteralPath (Join-Path $jmEnrollment 'dernier-etat.txt') -Algorithm SHA256).Hash
    $jmResult = Invoke-JmWitnessEnrollment $jmEnrollment $jmConfig.DestinationId
    Assert-True ($jmResult.initialized -and -not $jmResult.resumed -and $script:JmInitCalls -eq 1) 'Explicit enrollment did not initialize exactly once.'
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $jmEnrollment 'configuration.xml') -Algorithm SHA256).Hash -ceq $jmConfigurationHash) 'Enrollment rewrote DPAPI configuration.'
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $jmEnrollment 'dernier-etat.txt') -Algorithm SHA256).Hash -ceq $jmReceiptHash) 'Enrollment rewrote archive receipt.'
    $jmResult = Invoke-JmWitnessEnrollment $jmEnrollment $jmConfig.DestinationId
    Assert-True ($jmResult.resumed -and $script:JmInitCalls -eq 1 -and $script:JmApiCalls -eq 2) 'Resume initialized again or skipped the live service.'
    $jmWitness = Join-Path $jmEnrollment 'temoin'
    $null = Exchange $jmWitness $jmFixture.first
    Assert-True ((Invoke-JmWitnessEnrollment $jmEnrollment $jmConfig.DestinationId).resumed) 'Valid advanced witness lost its original genesis.'
    Remove-Item -LiteralPath (Join-Path $jmWitness 'registry-head.json')
    Assert-Fails { Invoke-JmWitnessEnrollment $jmEnrollment $jmConfig.DestinationId }
    Assert-True ($script:JmInitCalls -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $jmWitness 'registry-head.json'))) 'Lost head was reinitialized.'
    $jmPartial = New-EnrollmentPc; $script:JmInterrupt = $true
    Assert-Fails { Invoke-JmWitnessEnrollment $jmPartial $jmConfig.DestinationId }
    $script:JmInterrupt = $false; $jmCalls = $script:JmInitCalls
    Assert-True (Test-Path -LiteralPath (Join-Path $jmPartial 'witness-enrollment-started.json')) 'Interrupted initialization lost its durable marker.'
    Assert-Fails { Invoke-JmWitnessEnrollment $jmPartial $jmConfig.DestinationId }
    Assert-True ($script:JmInitCalls -eq $jmCalls) 'Partial initialization was restarted.'
    $jmRejected = New-EnrollmentPc; $script:JmRefuse = $true
    Assert-Fails { Invoke-JmWitnessEnrollment $jmRejected $jmConfig.DestinationId }
    $script:JmRefuse = $false
    Assert-True (Test-Path -LiteralPath (Join-Path $jmRejected 'witness-enrollment-attempt.json')) 'Failed request lost its persistent nonce.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $jmRejected 'temoin'))) 'Rejected enrollment created a witness.'
    Assert-True ((Invoke-JmWitnessEnrollment $jmRejected $jmConfig.DestinationId).initialized) 'Unconsumed attempt could not retry.'
    $jmLost = New-EnrollmentPc; $script:JmLoseResponse = $true
    Assert-Fails { Invoke-JmWitnessEnrollment $jmLost $jmConfig.DestinationId }
    $script:JmLoseResponse = $false; $jmCalls = $script:JmInitCalls
    Assert-Fails { Invoke-JmWitnessEnrollment $jmLost $jmConfig.DestinationId }
    Assert-True ($script:JmInitCalls -eq $jmCalls -and -not (Test-Path -LiteralPath (Join-Path $jmLost 'temoin'))) 'Lost permit response authorized a later reset.'
    $jmWrong = New-EnrollmentPc; $script:JmWrongMetadata = $true
    Assert-Fails { Invoke-JmWitnessEnrollment $jmWrong $jmConfig.DestinationId }
    $script:JmWrongMetadata = $false
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $jmWrong 'witness-enrollment-permit.json'))) 'Invalid empty snapshot was accepted.'
    $jmValidReply = [pscustomobject][ordered]@{ version = 1; initialize = $false; destinationId = $jmConfig.DestinationId; attemptId = ('a' * 32);
        contractSha256 = ('c' * 64); contractId = ('d' * 64); registryId = $jmFixture.empty.registryId; initialSnapshotSha256 = $jmFixture.emptyHash }
    foreach ($jmChange in @(
        { param($Value) $Value.version = '1' },
        { param($Value) $Value.initialize = 'false' },
        { param($Value) $Value.attemptId = ('b' * 32) },
        { param($Value) $Value.destinationId = ('2' * 32) },
        { param($Value) $Value.contractId = 'invalid' },
        { param($Value) Add-Member -InputObject $Value -NotePropertyName extra -NotePropertyValue $true }
    )) {
        $jmInvalidReply = Get-JmWitnessJson $jmValidReply | ConvertFrom-Json
        & $jmChange $jmInvalidReply
        Assert-Fails { Assert-JmWitnessEnrollmentReply $jmInvalidReply $jmConfig.DestinationId ('a' * 32) }
    }
    foreach ($jmLockName in @('agent.lock', 'witness-agent.lock')) {
        $jmLocked = New-EnrollmentPc; $jmCalls = $script:JmApiCalls
        $jmHeld = New-Object IO.FileStream((Join-Path $jmLocked $jmLockName), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try {
            Assert-Fails { Invoke-JmWitnessEnrollment $jmLocked $jmConfig.DestinationId }
            Assert-Fails { Invoke-JmAgentUpdate $jmLocked (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent | Join-Path -ChildPath 'scripts') $jmConfig.DestinationId }
            Assert-True ($script:JmApiCalls -eq $jmCalls) 'Busy enrollment performed a network operation.'
        } finally { $jmHeld.Dispose() }
    }
    $jmDormant = New-EnrollmentPc; $jmCalls = $script:JmApiCalls
    Start-JmWitnessWorker $jmDormant
    Assert-True ($script:JmApiCalls -eq $jmCalls) 'Ordinary worker initialized or contacted the service without a head.'
    Set-Item function:Initialize-JmWitness -Value $script:JmOriginalInitialize
    Set-Item function:Invoke-JmWitnessApi -Value $script:JmOriginalApi
    # Observe assigned request deadlines at GetResponse without waiting for
    # wall-clock time. Enrollment includes managed stop/restart maintenance;
    # ordinary poll and publication keep their shorter transport deadline.
    $script:JmRequestDeadlines = @()
    function New-JmWitnessRequest {
        param([string]$Action)
        $jmRequest = [pscustomobject]@{ Action = $Action; AllowAutoRedirect = $true; Timeout = 0; ReadWriteTimeout = 0; KeepAlive = $true;
            Headers = @{}; Method = 'GET'; ContentType = ''; ContentLength = 0 }
        Add-Member -InputObject $jmRequest -MemberType ScriptMethod -Name GetRequestStream -Value { return (New-Object IO.MemoryStream) }
        Add-Member -InputObject $jmRequest -MemberType ScriptMethod -Name GetResponse -Value {
            $script:JmRequestDeadlines += [pscustomobject]@{ action = $this.Action; timeout = $this.Timeout; readWriteTimeout = $this.ReadWriteTimeout }
            throw 'Synthetic request captured before network.'
        }
        Add-Member -InputObject $jmRequest -MemberType ScriptMethod -Name Abort -Value { }
        return $jmRequest
    }
    foreach ($jmAction in @('enroll', 'poll', 'response')) {
        Assert-Fails { Invoke-JmWitnessApi $jmAction ('A' * 43) $(if ($jmAction -ceq 'poll') { $null } else { [ordered]@{ version = 1 } }) }
    }
    Assert-True ($script:JmRequestDeadlines.Count -eq 3) 'Native API did not reach the request boundary for every action.'
    foreach ($jmDeadline in $script:JmRequestDeadlines) {
        $jmExpected = $(if ($jmDeadline.action -ceq 'enroll') { 90000 } else { 30000 })
        Assert-True ($jmDeadline.timeout -eq $jmExpected -and $jmDeadline.readWriteTimeout -eq $jmExpected) ('Wrong transport deadline for ' + $jmDeadline.action)
    }
    # Exercise the real HttpWebRequest implementation against a disposable
    # Node loopback fixture. Only the request constructor is substituted here;
    # the production constructor retains fixed primary HTTPS and system TLS.
    $jmNode = (Get-Command node).Source
    $jmPortFile = Join-Path $jmRoot 'enrollment-http-port.txt'
    $jmNodeScript = Join-Path $PSScriptRoot '../fixtures/witness-enrollment-windows.mjs'
    $jmServer = Start-Process -FilePath $jmNode -ArgumentList @(('"' + $jmNodeScript + '"'), ('"' + $jmPortFile + '"')) -PassThru -NoNewWindow
    try {
        $jmDeadline = [DateTime]::UtcNow.AddSeconds(20)
        while (-not (Test-Path -LiteralPath $jmPortFile)) {
            if ($jmServer.HasExited -or [DateTime]::UtcNow -gt $jmDeadline) { throw 'Synthetic Node HTTP fixture did not start.' }
            Start-Sleep -Milliseconds 50
        }
        $script:JmHttpPort = [int]([IO.File]::ReadAllText($jmPortFile))
        function New-JmWitnessRequest {
            param([string]$Action)
            return [Net.HttpWebRequest]::Create('http://127.0.0.1:' + $script:JmHttpPort + '/api/backup-copy/witness/' + $Action)
        }
        $jmNetwork = New-EnrollmentPc
        Assert-True ((Invoke-JmWitnessEnrollment $jmNetwork $jmConfig.DestinationId).initialized) 'Real Windows to Node enrollment did not initialize.'
        Assert-True ((Invoke-JmWitnessEnrollment $jmNetwork $jmConfig.DestinationId).resumed) 'Real Windows to Node retry did not validate existing witness.'
        Assert-Fails { Invoke-JmWitnessApi enroll ('B' * 43) ([ordered]@{ version = 1; destinationId = $jmConfig.DestinationId; attemptId = ('f' * 32) }) }
        Assert-Fails { Invoke-JmWitnessApi enroll ('A' * 43) ([ordered]@{ version = 1; destinationId = ('2' * 32); attemptId = ('f' * 32) }) }
        foreach ($jmAttemptCharacter in @('b', 'c', 'd', 'e', 'f')) {
            Assert-Fails { Invoke-JmWitnessApi enroll ('A' * 43) ([ordered]@{ version = 1; destinationId = $jmConfig.DestinationId; attemptId = ($jmAttemptCharacter * 32) }) }
        }
    } finally { if (-not $jmServer.HasExited) { Stop-Process -Id $jmServer.Id -Force }; $jmServer.Dispose() }
    Write-Output ('Windows witness: ' + $script:JmAssertions + ' assertions; real durable NTFS files, Node interoperability, DPAPI-preserving update and enrollment, lost/partial initialization blocked, live retry and real Windows-Node loopback HTTP. No real endpoint or task registered; production TLS unchanged.')
} finally { Remove-Item -LiteralPath $jmRoot -Recurse -Force }
