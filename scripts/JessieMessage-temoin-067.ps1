# Loaded by the existing DPAPI collector. Never reads a CRM or GPG private key.
Set-StrictMode -Version Latest
function Initialize-JmWitnessNative {
    if ('JessieMessageWitness067.Files' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace JessieMessageWitness067 {
  public static class Files {
    [StructLayout(LayoutKind.Sequential)] struct Info {
      public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
      public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file, out Info info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool MoveFileExW(string from, string to, uint flags);
    static void Check(SafeFileHandle file, long maximum) {
      Info info;
      if (file.IsInvalid || !GetFileInformationByHandle(file, out info) || (info.Attributes & 0x410) != 0 || info.Links != 1 || info.SizeHigh != 0 || info.SizeLow > maximum)
        throw new IOException("Unsafe witness file.");
    }
    public static byte[] Read(string path, int maximum) {
      using (SafeFileHandle file = CreateFileW(path, 0xC0000000, 1, IntPtr.Zero, 3, 0x80200000, IntPtr.Zero)) {
        Check(file, maximum);
        using (FileStream stream = new FileStream(file, FileAccess.ReadWrite)) {
          byte[] bytes = new byte[stream.Length]; int offset = 0, count;
          while (offset < bytes.Length && (count = stream.Read(bytes, offset, bytes.Length - offset)) > 0) offset += count;
          if (offset != bytes.Length || stream.ReadByte() != -1) throw new IOException("Witness file changed.");
          stream.Flush(true); Check(file, maximum); return bytes;
        }
      }
    }
    public static void WriteNew(string path, byte[] bytes) {
      using (SafeFileHandle file = CreateFileW(path, 0xC0000000, 0, IntPtr.Zero, 1, 0x80200000, IntPtr.Zero)) {
        Check(file, bytes.Length);
        using (FileStream stream = new FileStream(file, FileAccess.ReadWrite)) { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); Check(file, bytes.Length); }
      }
    }
    public static void Replace(string source, string target) {
      if (!MoveFileExW(source, target, 9)) throw new IOException("Witness publication not confirmed.");
    }
  }
}
'@
}
function Assert-JmWitnessFields {
    param($Value, [string[]]$Fields)
    if ($null -eq $Value -or $Value -isnot [pscustomobject]) { throw 'Temoin non valide.' }
    $jmNames = @($Value.PSObject.Properties.Name)
    if ($jmNames.Count -ne $Fields.Count) { throw 'Temoin non valide.' }
    foreach ($jmName in $Fields) { if (-not ($jmNames -ccontains $jmName)) { throw 'Temoin non valide.' } }
}
function Get-JmWitnessJson { param($Value) return (ConvertTo-Json -InputObject $Value -Depth 12 -Compress) }
function Get-JmWitnessHash {
    param($Value)
    $jmAlgorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($jmAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes((Get-JmWitnessJson $Value))))).Replace('-', '').ToLowerInvariant() }
    finally { $jmAlgorithm.Dispose() }
}
function ConvertFrom-JmWitnessBase64 {
    param($Value, [int]$Minimum, [int]$Maximum)
    if ($Value -isnot [string] -or $Value.Length -gt [Math]::Ceiling($Maximum * 4 / 3) -or $Value -cnotmatch '^[A-Za-z0-9_-]+$') { throw 'Enveloppe non valide.' }
    $jmEncoded = $Value.Replace('-', '+').Replace('_', '/')
    $jmBytes = [Convert]::FromBase64String($jmEncoded.PadRight($jmEncoded.Length + ((4 - $jmEncoded.Length % 4) % 4), '='))
    if ($jmBytes.Length -lt $Minimum -or $jmBytes.Length -gt $Maximum -or [Convert]::ToBase64String($jmBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') -cne $Value) { throw 'Enveloppe non valide.' }
    return ,$jmBytes
}
function Get-JmWitnessEnvelopeRevision {
    param($File)
    Assert-JmWitnessFields $File @('name', 'content')
    if ($File.name -isnot [string] -or $File.name -cnotmatch '^erasure-[a-f0-9]{64}\.json$') { throw 'Journal non valide.' }
    $jmBytes = ConvertFrom-JmWitnessBase64 $File.content 1 4096
    $jmText = (New-Object Text.UTF8Encoding($false, $true)).GetString($jmBytes)
    $jmState = ConvertFrom-Json -InputObject $jmText
    Assert-JmWitnessFields $jmState @('version', 'revision', 'envelope')
    Assert-JmWitnessFields $jmState.envelope @('iv', 'ciphertext', 'tag')
    if ($jmState.version -cne 1 -or $jmState.revision -isnot [long] -and $jmState.revision -isnot [int] -or $jmState.revision -lt 1 -or $jmState.revision -ge 9007199254740991L) { throw 'Revision non valide.' }
    $null = ConvertFrom-JmWitnessBase64 $jmState.envelope.iv 12 12
    $null = ConvertFrom-JmWitnessBase64 $jmState.envelope.ciphertext 1 2048
    $null = ConvertFrom-JmWitnessBase64 $jmState.envelope.tag 16 16
    $jmCanonical = [ordered]@{ version = 1; revision = $jmState.revision; envelope = [ordered]@{ iv = $jmState.envelope.iv; ciphertext = $jmState.envelope.ciphertext; tag = $jmState.envelope.tag } }
    if ((Get-JmWitnessJson $jmCanonical) + "`n" -cne $jmText) { throw 'Journal non canonique.' }
    return $jmState.revision
}
function ConvertTo-JmWitnessSnapshot {
    param($Value, [string]$RegistryId)
    Assert-JmWitnessFields $Value @('version', 'registryId', 'files')
    if ($Value.version -cne 1 -or $Value.registryId -cne $RegistryId -or $RegistryId -cnotmatch '^[a-f0-9]{64}$' -or $Value.files -isnot [array] -or $Value.files.Count -gt 9990) { throw 'Registre non valide.' }
    $jmFiles = New-Object Collections.Generic.List[object]
    $jmPrevious = ''; $jmLength = 0L
    foreach ($jmFile in $Value.files) {
        $null = Get-JmWitnessEnvelopeRevision $jmFile
        if ([string]::CompareOrdinal($jmFile.name, $jmPrevious) -le 0 -or ($jmLength += $jmFile.content.Length) -gt 58720256) { throw 'Registre non valide.' }
        $jmPrevious = $jmFile.name
        $jmFiles.Add([ordered]@{ name = $jmFile.name; content = $jmFile.content })
    }
    return [ordered]@{ version = 1; registryId = $RegistryId; files = @($jmFiles.ToArray()) }
}
function Assert-JmWitnessAdvance {
    param($Previous, $Next)
    $jmNew = @{}; foreach ($jmFile in $Next.files) { $jmNew[$jmFile.name] = $jmFile }
    foreach ($jmFile in $Previous.files) {
        if (-not $jmNew.ContainsKey($jmFile.name)) { throw 'Perte de journal refusee.' }
        $jmTarget = $jmNew[$jmFile.name]
        if ($jmTarget.content -cne $jmFile.content -and (Get-JmWitnessEnvelopeRevision ([pscustomobject]$jmTarget)) -ne (Get-JmWitnessEnvelopeRevision ([pscustomobject]$jmFile)) + 1) { throw 'Retour ou saut de revision refuse.' }
        $jmNew.Remove($jmFile.name)
    }
    foreach ($jmFile in $jmNew.Values) { if ((Get-JmWitnessEnvelopeRevision ([pscustomobject]$jmFile)) -ne 1) { throw 'Intention initiale absente.' } }
}
function Assert-JmWitnessDirectory {
    param([string]$Directory)
    Assert-JmDirectory $Directory
    $jmDrive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($Directory))
    if ($jmDrive.DriveType -ne [IO.DriveType]::Fixed -or $jmDrive.DriveFormat -cne 'NTFS') { throw 'Le temoin requiert le disque NTFS local.' }
    $jmAcl = Get-Acl -LiteralPath $Directory
    $jmSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if (-not $jmAcl.AreAccessRulesProtected -or $jmAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $jmSid) { throw 'Dossier prive requis.' }
    foreach ($jmRule in $jmAcl.Access) {
        if ($jmRule.AccessControlType -eq 'Allow' -and $jmRule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -cnotin @($jmSid, 'S-1-5-18')) { throw 'Dossier prive requis.' }
    }
}
function Read-JmWitnessJson {
    param([string]$Path, [int]$Maximum = 67108864)
    $jmBytes = [JessieMessageWitness067.Files]::Read($Path, $Maximum)
    if ($jmBytes.Length -eq 0) { throw 'Publication incomplete.' }
    $jmText = (New-Object Text.UTF8Encoding($false, $true)).GetString($jmBytes)
    return [pscustomobject]@{ Text = $jmText; Value = (ConvertFrom-Json -InputObject $jmText) }
}
function Write-JmWitnessHead {
    param([string]$Directory, $Head)
    $jmTemporary = Join-Path $Directory ('head-' + [Guid]::NewGuid().ToString('N') + '.pending')
    [JessieMessageWitness067.Files]::WriteNew($jmTemporary, [Text.Encoding]::UTF8.GetBytes((Get-JmWitnessJson $Head) + "`n"))
    [JessieMessageWitness067.Files]::Replace($jmTemporary, (Join-Path $Directory 'registry-head.json'))
    $jmRead = Read-JmWitnessJson (Join-Path $Directory 'registry-head.json') 1024
    if ($jmRead.Text -cne (Get-JmWitnessJson $Head) + "`n") { throw 'Publication non confirmee.' }
}
function Get-JmWitnessName { param([long]$Revision, [string]$Sha256) return ('registry-' + $Revision.ToString('D16') + '-' + $Sha256 + '.json') }
function Read-JmWitnessSnapshot {
    param([string]$Directory, [long]$Revision, [string]$Sha256, [string]$RegistryId)
    $jmRead = Read-JmWitnessJson (Join-Path $Directory (Get-JmWitnessName $Revision $Sha256))
    $jmValue = ConvertTo-JmWitnessSnapshot $jmRead.Value $RegistryId
    if ($jmRead.Text -cne (Get-JmWitnessJson $jmValue) + "`n" -or (Get-JmWitnessHash $jmValue) -cne $Sha256) { throw 'Publication alteree.' }
    return $jmValue
}
function Initialize-JmWitness {
    param([string]$Directory, [string]$RegistryId)
    # Explicit first-use operation only. The worker NEVER calls this function
    # when a head disappears. A future operator-owned genesis contract must
    # authorize this against the original complete, empty application registry.
    Initialize-JmWitnessNative
    Assert-JmWitnessDirectory $Directory
    if ($RegistryId -cnotmatch '^[a-f0-9]{64}$' -or @(Get-ChildItem -LiteralPath $Directory -Force).Count -ne 0) { throw 'Initialisation refusee.' }
    $jmSnapshot = [ordered]@{ version = 1; registryId = $RegistryId; files = @() }
    $jmSha = Get-JmWitnessHash $jmSnapshot
    [JessieMessageWitness067.Files]::WriteNew((Join-Path $Directory (Get-JmWitnessName 1 $jmSha)), [Text.Encoding]::UTF8.GetBytes((Get-JmWitnessJson $jmSnapshot) + "`n"))
    Write-JmWitnessHead $Directory ([ordered]@{ version = 1; revision = 1; registryId = $RegistryId; snapshotSha256 = $jmSha })
}
function Invoke-JmWitnessExchange {
    param([string]$Directory, $Request)
    Initialize-JmWitnessNative
    Assert-JmWitnessFields $Request @('version', 'registryId', 'challenge', 'snapshot')
    if ($Request.version -cne 1 -or $Request.registryId -cnotmatch '^[a-f0-9]{64}$' -or $Request.challenge -cnotmatch '^[a-f0-9]{64}$') { throw 'Requete non valide.' }
    Assert-JmWitnessDirectory $Directory
    $jmLock = $null
    try {
        $jmLock = New-Object IO.FileStream((Join-Path $Directory 'witness.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $jmEntries = @(Get-ChildItem -LiteralPath $Directory -Force)
        $jmPublications = @{}; $jmBytes = 0L
        foreach ($jmEntry in $jmEntries) {
            if ($jmEntry.Name -ceq 'witness.lock' -or $jmEntry.Name -ceq 'registry-head.json') { continue }
            if ($jmEntry.Name -cnotmatch '^registry-([0-9]{16})-([a-f0-9]{64})\.json$' -or $jmEntry.PSIsContainer -or ($jmEntry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Publication incertaine.' }
            $jmRevision = [long]$Matches[1]; $jmSha = $Matches[2]
            if ($jmRevision -lt 1 -or $jmRevision -gt 10000 -or $jmPublications.ContainsKey($jmRevision) -or ($jmBytes += $jmEntry.Length) -gt 1073741824) { throw 'Registre incomplet.' }
            $jmPublications[$jmRevision] = $jmSha
        }
        foreach ($jmRevision in $jmPublications.Keys) { if ($jmRevision -gt $jmPublications.Count) { throw 'Publication manquante.' } }
        $jmRead = Read-JmWitnessJson (Join-Path $Directory 'registry-head.json') 1024
        $jmHead = $jmRead.Value
        Assert-JmWitnessFields $jmHead @('version', 'revision', 'registryId', 'snapshotSha256')
        if ($jmHead.version -cne 1 -or $jmHead.registryId -cne $Request.registryId -or $jmHead.revision -isnot [int] -and $jmHead.revision -isnot [long] -or $jmHead.revision -lt 1 -or $jmHead.revision -gt 10000 -or $jmHead.snapshotSha256 -cnotmatch '^[a-f0-9]{64}$' -or $jmPublications[[long]$jmHead.revision] -cne $jmHead.snapshotSha256) { throw 'Tete non valide.' }
        $jmCurrent = Read-JmWitnessSnapshot $Directory $jmHead.revision $jmHead.snapshotSha256 $Request.registryId
        if ($jmPublications.Count -eq $jmHead.revision + 1) {
            $jmSha = $jmPublications[[long]($jmHead.revision + 1)]
            $jmNext = Read-JmWitnessSnapshot $Directory ($jmHead.revision + 1) $jmSha $Request.registryId
            Assert-JmWitnessAdvance $jmCurrent $jmNext
            $jmHead = [pscustomobject][ordered]@{ version = 1; revision = $jmHead.revision + 1; registryId = $Request.registryId; snapshotSha256 = $jmSha }
            Write-JmWitnessHead $Directory $jmHead
            $jmCurrent = $jmNext
        } elseif ($jmPublications.Count -ne $jmHead.revision) { throw 'Ancienne tete refusee.' }
        if ($null -ne $Request.snapshot) {
            $jmNext = ConvertTo-JmWitnessSnapshot $Request.snapshot $Request.registryId
            Assert-JmWitnessAdvance $jmCurrent $jmNext
            $jmSha = Get-JmWitnessHash $jmNext
            if ($jmSha -cne $jmHead.snapshotSha256) {
                if ($jmHead.revision -ge 10000 -or $jmBytes + [Text.Encoding]::UTF8.GetByteCount((Get-JmWitnessJson $jmNext) + "`n") -gt 1073741824) { throw 'Limite du temoin atteinte.' }
                [JessieMessageWitness067.Files]::WriteNew((Join-Path $Directory (Get-JmWitnessName ($jmHead.revision + 1) $jmSha)), [Text.Encoding]::UTF8.GetBytes((Get-JmWitnessJson $jmNext) + "`n"))
                $jmHead = [pscustomobject][ordered]@{ version = 1; revision = $jmHead.revision + 1; registryId = $Request.registryId; snapshotSha256 = $jmSha }
                Write-JmWitnessHead $Directory $jmHead
            }
        }
        $jmCurrent = Read-JmWitnessSnapshot $Directory $jmHead.revision $jmHead.snapshotSha256 $Request.registryId
        Assert-JmWitnessDirectory $Directory
        return [ordered]@{ version = 1; registryId = $Request.registryId; challenge = $Request.challenge; revision = $jmHead.revision; sha256 = $jmHead.snapshotSha256; snapshot = $jmCurrent }
    } finally { if ($null -ne $jmLock) { $jmLock.Dispose() } }
}
function Invoke-JmWitnessApi {
    param([string]$Action, [string]$Token, $Body = $null)
    if ($Action -cnotin @('poll', 'response') -or $Token -cnotmatch '^[A-Za-z0-9_-]{43}$') { throw 'Requete non valide.' }
    $jmRequest = [Net.HttpWebRequest]::Create('https://jessiemessage.com/api/backup-copy/witness/' + $Action)
    $jmRequest.AllowAutoRedirect = $false; $jmRequest.Timeout = 30000; $jmRequest.ReadWriteTimeout = 30000; $jmRequest.KeepAlive = $false
    $jmRequest.Headers['X-Jessie-Backup'] = '1'; $jmRequest.Headers['Authorization'] = 'Bearer ' + $Token
    $jmResponse = $null; $jmStream = $null; $jmMemory = $null
    try {
        if ($Action -ceq 'response') {
            $jmRequest.Method = 'POST'; $jmRequest.ContentType = 'application/json; charset=utf-8'
            $jmBytes = [Text.Encoding]::UTF8.GetBytes((Get-JmWitnessJson $Body))
            if ($jmBytes.Length -gt 67110912) { throw 'Reponse trop grande.' }
            $jmRequest.ContentLength = $jmBytes.Length
            $jmOutput = $jmRequest.GetRequestStream()
            try { $jmOutput.Write($jmBytes, 0, $jmBytes.Length) } finally { $jmOutput.Dispose(); [Array]::Clear($jmBytes, 0, $jmBytes.Length) }
        }
        $jmResponse = $jmRequest.GetResponse()
        if ([int]$jmResponse.StatusCode -ne 200 -or $null -ne $jmResponse.Headers['Set-Cookie']) { throw 'Reponse non valide.' }
        $jmStream = $jmResponse.GetResponseStream(); $jmMemory = New-Object IO.MemoryStream
        $jmBuffer = New-Object byte[] 65536
        while (($jmCount = $jmStream.Read($jmBuffer, 0, $jmBuffer.Length)) -gt 0) {
            if ($jmMemory.Length + $jmCount -gt 67110912) { throw 'Reponse trop grande.' }
            $jmMemory.Write($jmBuffer, 0, $jmCount)
        }
        return (ConvertFrom-Json -InputObject ((New-Object Text.UTF8Encoding($false, $true)).GetString($jmMemory.ToArray())))
    } finally { if ($null -ne $jmMemory) { $jmMemory.Dispose() }; if ($null -ne $jmStream) { $jmStream.Dispose() }; if ($null -ne $jmResponse) { $jmResponse.Dispose() }; $jmRequest.Abort() }
}
function Start-JmWitnessWorker {
    param([string]$Directory)
    $jmLock = $null
    try {
        Assert-JmDirectory $Directory
        if (-not (Test-Path -LiteralPath (Join-Path $Directory 'temoin\registry-head.json'))) { return }
        $jmLock = New-Object IO.FileStream((Join-Path $Directory 'witness-agent.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $jmUntil = [DateTime]::UtcNow.AddSeconds(40)
        do {
            $jmConfig = Read-JmConfiguration $Directory
            $jmPacket = Invoke-JmWitnessApi poll $jmConfig.Credential.GetNetworkCredential().Password
            if ($jmPacket.pending -ceq $false) { continue }
            Assert-JmWitnessFields $jmPacket @('version', 'pending', 'destinationId', 'provisioning', 'requestId', 'request')
            if ($jmPacket.version -cne 1 -or $jmPacket.pending -cne $true -or $jmPacket.destinationId -cne $jmConfig.DestinationId -or $jmPacket.requestId -cnotmatch '^[a-f0-9]{32}$') { throw 'Requete non valide.' }
            # There is deliberately no automatic initialization on this path.
            $jmResult = Invoke-JmWitnessExchange (Join-Path $Directory 'temoin') $jmPacket.request
            $jmAck = Invoke-JmWitnessApi response $jmConfig.Credential.GetNetworkCredential().Password ([ordered]@{ version = 1; requestId = $jmPacket.requestId; response = $jmResult })
            if ($jmAck.version -cne 1 -or $jmAck.recorded -cne $true) { throw 'Reponse non confirmee.' }
        } while ([DateTime]::UtcNow -lt $jmUntil)
    } catch { Write-Output 'JESSIEMESSAGE_TEMOIN_NON_CONFIRME'; exit 1 }
    finally { if ($null -ne $jmLock) { $jmLock.Dispose() } }
}
