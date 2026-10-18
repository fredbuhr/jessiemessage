$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../../scripts/JessieMessage-verifier-056.ps1')
function Assert-True { param($Value, [string]$Message) if (-not $Value) { throw $Message } }
function Assert-Fails { param([scriptblock]$Operation) $failed = $false; try { $null = & $Operation } catch { $failed = $true }; Assert-True $failed 'Operation should have failed.' }
function Invoke-FixtureGpg {
    param([string[]]$Arguments)
    $previous = $ErrorActionPreference
    try { $ErrorActionPreference = 'Continue'; $output = @(& $script:FixtureGpg @Arguments 2>&1); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { throw ('Synthetic CI GPG fixture failed: ' + ($output -join ' ')) }
    return @($output | Where-Object { $_ -is [string] })
}
$root = Join-Path $env:RUNNER_TEMP ('jm-verify-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$script:FixtureGpg = Find-JmVerificationGpg
$keyHome = Join-Path $root ('key home ' + [char]0xe9)
$null = New-Item -ItemType Directory -Path $keyHome
$base = @('--no-options', '--homedir', $keyHome, '--no-auto-key-retrieve', '--auto-key-locate', 'clear')
try {
    Initialize-JmVerificationRuntime
    $null = Invoke-FixtureGpg ($base + @('--batch', '--pinentry-mode', 'loopback', '--passphrase=', '--quick-generate-key', 'JessieMessage synthetic CI only', 'rsa2048', 'encr', '0'))
    $listing = @(Invoke-FixtureGpg ($base + @('--with-colons', '--fingerprint', '--list-secret-keys')))
    $fingerprint = (@($listing | Where-Object { $_ -match '^fpr:' })[0] -split ':')[9]
    $plain = Join-Path $root 'synthetic.bin'
    $content = New-Object byte[] 150000
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($content) } finally { $random.Dispose() }
    [IO.File]::WriteAllBytes($plain, $content)
    $sourceHash = (Get-FileHash -LiteralPath $plain -Algorithm SHA256).Hash.ToLowerInvariant()
    $id = 'capture-1792340000000-cccccccccccccccc'
    $cipher = Join-Path $root ('JessieMessage-' + $id + '.tar.gz.gpg')
    # --force-mdc is ignored by modern GPG. Select the legacy standard only in
    # this synthetic fixture, then separately exercise modern OCB below.
    $null = Invoke-FixtureGpg ($base + @('--batch', '--trust-model', 'always', '--rfc4880', '--cipher-algo', 'AES256', '--output', $cipher, '--recipient', $fingerprint, '--encrypt', '--', $plain))
    $aead = Join-Path $root 'synthetic-ocb.gpg'
    $null = Invoke-FixtureGpg ($base + @('--batch', '--trust-model', 'always', '--force-ocb', '--cipher-algo', 'AES256', '--output', $aead, '--recipient', $fingerprint, '--encrypt', '--', $plain))
    Remove-Item -LiteralPath $plain
    $cipherHash = (Get-FileHash -LiteralPath $cipher -Algorithm SHA256).Hash.ToLowerInvariant()
    $cipherBytes = (Get-Item -LiteralPath $cipher).Length
    $record = [pscustomobject]@{ format = 'jessiemessage-backup-verification'; version = 1;
        archive = [pscustomobject]@{ id = $id; startedAt = 1792340000000L; filename = [IO.Path]::GetFileName($cipher); bytes = $cipherBytes; sha256 = $cipherHash };
        source = [pscustomobject]@{ bytes = $content.Length; sha256 = $sourceHash }; recipient = [pscustomobject]@{ fingerprint = $fingerprint }; protection = 'mdc' }
    $metadata = Join-Path $root 'verification.json'
    [IO.File]::WriteAllText($metadata, ($record | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false))
    Assert-True ((Read-JmVerification $metadata).archive.id -ceq $id) 'Native kit reader rejected valid metadata.'
    Start-JmVerificationWindow -MetadataPath $metadata -CheckLayout
    $before = @(Get-ChildItem -LiteralPath $root -File).Name -join ','
    $result = [JessieMessage.BackupVerifier056]::Verify($script:FixtureGpg, $keyHome, $cipher, $cipherBytes, $cipherHash,
        $content.Length, $sourceHash, $fingerprint, 'mdc', 30000, [Threading.CancellationToken]::None)
    Assert-True ($result.Bytes -eq $content.Length -and $result.Sha256 -ceq $sourceHash) 'Real GPG binary stream hash failed.'
    $aeadHash = (Get-FileHash -LiteralPath $aead -Algorithm SHA256).Hash.ToLowerInvariant()
    $aeadResult = [JessieMessage.BackupVerifier056]::Verify($script:FixtureGpg, $keyHome, $aead, (Get-Item -LiteralPath $aead).Length, $aeadHash,
        $content.Length, $sourceHash, $fingerprint, 'ocb-aead', 30000, [Threading.CancellationToken]::None)
    Assert-True ($aeadResult.Sha256 -ceq $sourceHash) 'Real OCB decryption verification failed.'
    Assert-True ((@(Get-ChildItem -LiteralPath $root -File).Name -join ',') -ceq $before) 'Verifier created a plaintext or result file.'
    $task = [JessieMessage.BackupVerifier056]::Start($script:FixtureGpg, $keyHome, $cipher, $cipherBytes, $cipherHash,
        $content.Length, $sourceHash, $fingerprint, 'mdc', 30000, [Threading.CancellationToken]::None)
    Assert-True ($task.GetAwaiter().GetResult().Sha256 -ceq $sourceHash) 'Asynchronous UI job failed.'
    Assert-Fails { [JessieMessage.BackupVerifier056]::Verify($script:FixtureGpg, $keyHome, $cipher, $cipherBytes, ('0' * 64), $content.Length, $sourceHash, $fingerprint, 'mdc', 30000, [Threading.CancellationToken]::None) }
    Assert-Fails { [JessieMessage.BackupVerifier056]::Verify($script:FixtureGpg, $keyHome, $cipher, $cipherBytes, $cipherHash, $content.Length, ('0' * 64), $fingerprint, 'mdc', 30000, [Threading.CancellationToken]::None) }
    Assert-Fails { [JessieMessage.BackupVerifier056]::Verify($script:FixtureGpg, $keyHome, $cipher, $cipherBytes, $cipherHash, $content.Length, $sourceHash, ('B' * 40), 'mdc', 30000, [Threading.CancellationToken]::None) }
    Assert-Fails { [JessieMessage.BackupVerifier056]::Verify($script:FixtureGpg, $keyHome, $cipher, $cipherBytes, $cipherHash, $content.Length, $sourceHash, $fingerprint, 'ocb-aead', 30000, [Threading.CancellationToken]::None) }
    $empty = Join-Path $root 'empty key home'; $null = New-Item -ItemType Directory -Path $empty
    Assert-Fails { [JessieMessage.BackupVerifier056]::Verify($script:FixtureGpg, $empty, $cipher, $cipherBytes, $cipherHash, $content.Length, $sourceHash, $fingerprint, 'mdc', 30000, [Threading.CancellationToken]::None) }
    $corrupt = Join-Path $root 'corrupt.gpg'; $data = [IO.File]::ReadAllBytes($cipher); $data[$data.Length - 12] = $data[$data.Length - 12] -bxor 1; [IO.File]::WriteAllBytes($corrupt, $data)
    $corruptHash = (Get-FileHash -LiteralPath $corrupt -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Fails { [JessieMessage.BackupVerifier056]::Verify($script:FixtureGpg, $keyHome, $corrupt, $data.Length, $corruptHash, $content.Length, $sourceHash, $fingerprint, 'mdc', 30000, [Threading.CancellationToken]::None) }
    $cancel = [Threading.CancellationTokenSource]::new(); $cancel.Cancel()
    try { Assert-Fails { [JessieMessage.BackupVerifier056]::Verify($script:FixtureGpg, $keyHome, $cipher, $cipherBytes, $cipherHash, $content.Length, $sourceHash, $fingerprint, 'mdc', 30000, $cancel.Token) } } finally { $cancel.Dispose() }
    $record | Add-Member -NotePropertyName token -NotePropertyValue 'must not be accepted'
    [IO.File]::WriteAllText($metadata, ($record | ConvertTo-Json -Depth 5 -Compress))
    Assert-Fails { Read-JmVerification $metadata }
    $junction = Join-Path $root 'junction'; $null = New-Item -ItemType Junction -Path $junction -Target $keyHome
    Assert-Fails { Assert-JmVerificationDirectory $junction }
    [IO.Directory]::Delete($junction)
    # Bounded process failure tests use only a synthetic executable, never GPG keys.
    $stub = Join-Path $root 'fixture.exe'
    Add-Type -OutputAssembly $stub -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.Threading;
class Fixture {
    static void Main(string[] args) {
        string mode = args[Array.IndexOf(args, "--homedir") + 1];
        if (mode == "hang") { Thread.Sleep(10000); return; }
        if (mode == "status-overflow") { Console.Error.Write(new string('x', 20000)); return; }
        if (mode == "output-overflow") { Console.OpenStandardOutput().Write(new byte[4096], 0, 4096); Thread.Sleep(10000); return; }
        byte[] bytes = new byte[] { 0, 1, 2, 255, 13, 10 };
        Console.OpenStandardOutput().Write(bytes, 0, bytes.Length);
        if (mode != "missing-status") {
            Console.Error.WriteLine("[GNUPG:] DECRYPTION_KEY " + new string('B', 40) + " " + new string('B', 40) + " u");
            Console.Error.WriteLine("[GNUPG:] DECRYPTION_INFO 2 9 0");
            Console.Error.WriteLine("[GNUPG:] DECRYPTION_OKAY");
        }
        if (mode == "nonzero") Environment.Exit(1);
    }
}
'@
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $stubHash = ([BitConverter]::ToString($hash.ComputeHash([byte[]]@(0, 1, 2, 255, 13, 10)))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
    foreach ($mode in @('hang', 'status-overflow', 'output-overflow', 'missing-status', 'nonzero')) {
        $watch = [Diagnostics.Stopwatch]::StartNew()
        Assert-Fails { [JessieMessage.BackupVerifier056]::Verify($stub, $mode, $cipher, $cipherBytes, $cipherHash, 6, $stubHash, ('B' * 40), 'mdc', 500, [Threading.CancellationToken]::None) }
        Assert-True ($watch.ElapsedMilliseconds -lt 7000) 'Process deadline was not bounded.'
    }
    Assert-True ((Get-FileHash -LiteralPath $cipher -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $cipherHash) 'Original encrypted copy changed.'
    Write-Output 'Windows 5.1: native window layout, real GPG binary decryption, async job, no plaintext file, wrong key/hash/protection, corruption, cancellation, process/status bounds and path guards passed. Synthetic CI key only.'
} finally {
    # Stop only the two synthetic per-test agents so their handles do not impede cleanup.
    $gpgconf = Join-Path ([IO.Path]::GetDirectoryName($script:FixtureGpg)) 'gpgconf.exe'
    if (Test-Path -LiteralPath $gpgconf) {
        $ErrorActionPreference = 'Continue'
        foreach ($directory in @($keyHome, (Join-Path $root 'empty key home'))) { & $gpgconf --homedir $directory --kill gpg-agent 2>$null }
        $ErrorActionPreference = 'Stop'
    }
    Remove-Item -LiteralPath $root -Recurse -Force
}
