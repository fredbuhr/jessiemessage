param([switch]$Setup, [switch]$Settings, [switch]$Run)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:JmOrigin = 'https://jessiemessage.com'
$script:JmScriptFile = $PSCommandPath
$script:JmCopyDeadline = $null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Assert-JmDirectory {
    param([string]$Path)
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path.Contains('"')) { throw 'Dossier non valide.' }
    $jmDirectory = Get-Item -LiteralPath $Path -Force
    while ($null -ne $jmDirectory) {
        if ($jmDirectory -isnot [IO.DirectoryInfo] -or ($jmDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Choisir un dossier sans lien ni jonction.' }
        $jmDirectory = $jmDirectory.Parent
    }
}
function Set-JmPrivateDirectory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { $null = New-Item -ItemType Directory -Path $Path }
    Assert-JmDirectory $Path
    $jmSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $jmAcl = New-Object Security.AccessControl.DirectorySecurity
    $jmAcl.SetOwner($jmSid)
    $jmAcl.SetAccessRuleProtection($true, $false)
    foreach ($jmAllowed in @($jmSid, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $jmRule = New-Object Security.AccessControl.FileSystemAccessRule($jmAllowed, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $null = $jmAcl.AddAccessRule($jmRule)
    }
    Set-Acl -LiteralPath $Path -AclObject $jmAcl
}
function Save-JmConfiguration {
    param($Configuration, [string]$Directory)
    Assert-JmDirectory $Directory
    $jmTarget = Join-Path $Directory 'configuration.xml'
    if (Test-Path -LiteralPath $jmTarget) {
        if ((Get-Item -LiteralPath $jmTarget -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Configuration non valide.' }
    }
    $jmTemporary = Join-Path $Directory ([Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $Configuration | Export-Clixml -LiteralPath $jmTemporary -Depth 5
        if (Test-Path -LiteralPath $jmTarget) { [IO.File]::Replace($jmTemporary, $jmTarget, $null) }
        else { [IO.File]::Move($jmTemporary, $jmTarget) }
    } finally { if (Test-Path -LiteralPath $jmTemporary) { Remove-Item -LiteralPath $jmTemporary -Force } }
}
function Read-JmConfiguration {
    param([string]$Directory)
    Assert-JmDirectory $Directory
    $jmFile = Get-Item -LiteralPath (Join-Path $Directory 'configuration.xml') -Force
    if ($jmFile.Length -gt 32768 -or ($jmFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Configuration non valide.' }
    $jmConfig = Import-Clixml -LiteralPath $jmFile.FullName
    if ($jmConfig.Version -ne 1 -or $jmConfig.DestinationId -notmatch '^[a-f0-9]{32}$' -or $jmConfig.LocationId -notmatch '^[a-f0-9]{32}$' -or
        $jmConfig.Credential -isnot [Management.Automation.PSCredential] -or $jmConfig.Credential.UserName -ne $jmConfig.DestinationId) { throw 'Raccordement non valide.' }
    return $jmConfig
}
function Invoke-JmApi {
    param([string]$Action, [string]$Token = '', $Body = $null, [string]$LocationId = '', [string]$CaptureId = '', [string]$OutputFile = '')
    $jmPaths = @{ pair = '/api/backup-copy/pair'; manifest = '/api/backup-copy/manifest'; receipt = '/api/backup-copy/receipt' }
    if ($Action -eq 'archive') {
        if ($CaptureId -notmatch '^capture-[1-9][0-9]{0,14}-[a-f0-9]{16}$' -or [string]::IsNullOrEmpty($OutputFile)) { throw 'Archive non valide.' }
        $jmPath = '/api/backup-copy/archives/' + $CaptureId
    } elseif ($jmPaths.ContainsKey($Action)) { $jmPath = $jmPaths[$Action] }
    else { throw 'Action non valide.' }
    if ($script:JmOrigin -ne 'https://jessiemessage.com') { throw 'Origine non valide.' }
    $jmRequest = [Net.HttpWebRequest]::Create($script:JmOrigin + $jmPath)
    $jmRequest.AllowAutoRedirect = $false
    $jmRequest.Timeout = 30000
    $jmRequest.ReadWriteTimeout = 30000
    $jmRequest.KeepAlive = $false
    $jmRequest.Headers.Add('X-Jessie-Backup', '1')
    if ($Action -ne 'pair') {
        if ($Token -cnotmatch '^[A-Za-z0-9_-]{43}$') { throw 'Autorisation non valide.' }
        $jmRequest.Headers.Add('Authorization', ('Bearer ' + $Token))
    }
    if ($Action -eq 'manifest') { $jmRequest.Headers.Add('X-Backup-Location', $LocationId) }
    if ($null -ne $Body) {
        $jmRequest.Method = 'POST'
        $jmRequest.ContentType = 'application/json; charset=utf-8'
        $jmBodyBytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
        $jmRequest.ContentLength = $jmBodyBytes.Length
        $jmRequestStream = $jmRequest.GetRequestStream()
        try { $jmRequestStream.Write($jmBodyBytes, 0, $jmBodyBytes.Length) }
        finally { $jmRequestStream.Dispose(); [Array]::Clear($jmBodyBytes, 0, $jmBodyBytes.Length) }
    }
    $jmResponse = $null; $jmInput = $null; $jmOutput = $null
    try {
        $jmResponse = $jmRequest.GetResponse()
        if ([int]$jmResponse.StatusCode -ne 200) { throw 'Reponse non valide.' }
        $jmInput = $jmResponse.GetResponseStream()
        $jmMaximum = 2097152L
        if ($Action -eq 'archive') {
            $jmMaximum = 2151677952L
            if ($jmResponse.ContentLength -lt 1 -or $jmResponse.ContentLength -gt $jmMaximum) { throw 'Taille non valide.' }
            $jmOutput = New-Object IO.FileStream($OutputFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        } else { $jmOutput = New-Object IO.MemoryStream }
        $jmBuffer = New-Object byte[] 65536
        $jmTotal = 0L; $jmDeadline = [DateTime]::UtcNow.AddMinutes(9)
        if ($null -ne $script:JmCopyDeadline -and $script:JmCopyDeadline -lt $jmDeadline) { $jmDeadline = $script:JmCopyDeadline }
        while (($jmRead = $jmInput.Read($jmBuffer, 0, $jmBuffer.Length)) -gt 0) {
            $jmTotal += $jmRead
            if ($jmTotal -gt $jmMaximum -or [DateTime]::UtcNow -gt $jmDeadline) { throw 'Transfert incomplet.' }
            $jmOutput.Write($jmBuffer, 0, $jmRead)
        }
        if ($Action -eq 'archive') {
            if ($jmTotal -ne $jmResponse.ContentLength) { throw 'Transfert incomplet.' }
            $jmOutput.Flush($true)
        } else { return ([Text.Encoding]::UTF8.GetString($jmOutput.ToArray()) | ConvertFrom-Json) }
    } catch { throw 'La connexion de sauvegarde a echoue. Reessayer ou raccorder de nouveau depuis le site.' }
    finally {
        if ($null -ne $jmOutput) { $jmOutput.Dispose() }
        if ($null -ne $jmInput) { $jmInput.Dispose() }
        if ($null -ne $jmResponse) { $jmResponse.Dispose() }
        $jmRequest.Abort()
    }
}
function Test-JmArchive {
    param([string]$File, $Archive)
    if (-not (Test-Path -LiteralPath $File)) { return $false }
    $jmInfo = Get-Item -LiteralPath $File -Force
    if ($jmInfo.PSIsContainer -or ($jmInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $jmInfo.Length -ne $Archive.bytes) { return $false }
    return ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $Archive.sha256)
}
function Assert-JmArchive {
    param($Archive)
    if ($Archive.id -cnotmatch '^capture-[1-9][0-9]{0,14}-[a-f0-9]{16}$' -or $Archive.sha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $Archive.bytes -lt 1 -or $Archive.bytes -gt 2151677952L -or
        $Archive.filename -cne ('JessieMessage-' + $Archive.id + '.tar.gz.gpg')) { throw 'Catalogue non valide.' }
}
function Copy-JmArchive {
    param([string]$Directory, $Archive, [string]$Token)
    Assert-JmArchive $Archive
    Assert-JmDirectory $Directory
    $jmFinal = Join-Path $Directory $Archive.filename
    if (Test-JmArchive $jmFinal $Archive) { return $false }
    # An existing mismatched file is preserved for examination, never overwritten.
    if (Test-Path -LiteralPath $jmFinal) { throw 'Un fichier du meme nom a une empreinte differente. Le conserver et choisir un autre dossier.' }
    $jmPartial = Join-Path $Directory ('.JessieMessage-' + [Guid]::NewGuid().ToString('N') + '.part')
    try {
        $null = Invoke-JmApi -Action archive -Token $Token -CaptureId $Archive.id -OutputFile $jmPartial
        Assert-JmDirectory $Directory
        if (-not (Test-JmArchive $jmPartial $Archive)) { throw 'Empreinte de copie incorrecte. Aucun recu envoye.' }
        [IO.File]::Move($jmPartial, $jmFinal)
        if (-not (Test-JmArchive $jmFinal $Archive)) { throw 'La relecture de la copie a echoue.' }
        return $true
    } finally { if (Test-Path -LiteralPath $jmPartial) { Remove-Item -LiteralPath $jmPartial -Force } }
}
function Invoke-JmCopies {
    param($Configuration)
    Assert-JmDirectory $Configuration.Folder
    $script:JmCopyDeadline = [DateTime]::UtcNow.AddMinutes(10)
    $jmToken = $Configuration.Credential.GetNetworkCredential().Password
    try {
        $jmManifest = Invoke-JmApi -Action manifest -Token $jmToken -LocationId $Configuration.LocationId
        if ($jmManifest.version -ne 1 -or $jmManifest.paused -isnot [bool]) { throw 'Catalogue non valide.' }
        if ($jmManifest.paused) { return 'Copies suspendues depuis le site.' }
        $jmArchives = @($jmManifest.archives)
        if ($jmArchives.Count -gt 2000) { throw 'Catalogue trop grand.' }
        $jmCount = 0; $jmPrevious = 0L; $jmDeadline = [DateTime]::UtcNow.AddMinutes(10); $jmLastVerified = $null; $jmMore = $false
        foreach ($jmArchive in $jmArchives) {
            Assert-JmArchive $jmArchive
            if ($jmArchive.startedAt -le $jmPrevious -or $jmArchive.startedAt -ne [long]($jmArchive.id.Split('-')[1])) { throw 'Ordre du catalogue non valide.' }
            $jmPrevious = $jmArchive.startedAt
            if ($jmCount -ge 20 -or [DateTime]::UtcNow -gt $jmDeadline) { $jmMore = $true; break }
            if (Copy-JmArchive -Directory $Configuration.Folder -Archive $jmArchive -Token $jmToken) { $jmCount++ }
            $jmLastVerified = $jmArchive
        }
        if ($null -ne $jmLastVerified) {
            $jmReceipt = Invoke-JmApi -Action receipt -Token $jmToken -Body @{ captureId = $jmLastVerified.id; bytes = $jmLastVerified.bytes; sha256 = $jmLastVerified.sha256; locationId = $Configuration.LocationId }
            if ($jmReceipt.recorded -ne $true) { throw 'Le recu de copie n''est pas confirme.' }
        }
        if ($jmMore) { return 'La suite des copies sera reprise au prochain passage.' }
        return 'Copies chiffrees verifiees. Le dechiffrement reste une verification distincte.'
    } finally { $jmToken = $null; $script:JmCopyDeadline = $null }
}
function Select-JmFolder {
    param([string]$Current, [bool]$Installing)
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $jmForm = New-Object Windows.Forms.Form
    $jmForm.Text = 'JessieMessage - Sauvegardes'
    $jmForm.Size = New-Object Drawing.Size(600, 310)
    $jmForm.MinimumSize = $jmForm.Size; $jmForm.StartPosition = 'CenterScreen'
    $jmForm.AutoScaleMode = 'Dpi'
    $jmLabel = New-Object Windows.Forms.Label
    $jmLabel.Text = "Dossier des archives chiffrees : PC, disque externe, dossier Drive synchronise ou partage reseau accessible. Les copies ont lieu toutes les 15 minutes quand votre session Windows est ouverte."
    $jmLabel.SetBounds(20, 20, 540, 75); $jmForm.Controls.Add($jmLabel)
    $jmPathBox = New-Object Windows.Forms.TextBox
    $jmPathBox.ReadOnly = $true; $jmPathBox.Text = $Current; $jmPathBox.SetBounds(20, 105, 540, 30); $jmForm.Controls.Add($jmPathBox)
    $jmBrowse = New-Object Windows.Forms.Button
    $jmBrowse.Text = 'Parcourir...'; $jmBrowse.SetBounds(20, 150, 145, 38)
    $jmBrowse.Add_Click({
        $jmDialog = New-Object Windows.Forms.FolderBrowserDialog
        $jmDialog.Description = 'Choisir le dossier des copies JessieMessage'
        $jmDialog.SelectedPath = $jmPathBox.Text
        try { if ($jmDialog.ShowDialog() -eq 'OK') { $jmPathBox.Text = $jmDialog.SelectedPath } }
        finally { $jmDialog.Dispose() }
    })
    $jmForm.Controls.Add($jmBrowse)
    $jmSave = New-Object Windows.Forms.Button
    $jmSave.Text = 'Enregistrer'; if ($Installing) { $jmSave.Text = 'Activer les copies' }
    $jmSave.SetBounds(345, 210, 215, 40); $jmSave.DialogResult = 'OK'; $jmForm.AcceptButton = $jmSave; $jmForm.Controls.Add($jmSave)
    try { if ($jmForm.ShowDialog() -eq 'OK') { return $jmPathBox.Text }; return $null }
    finally { $jmForm.Dispose() }
}
function New-JmTaskDefinition {
    param([string]$Script)
    if ($Script.Contains('"')) { throw 'Chemin non valide.' }
    $jmIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $jmAction = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Script + '" -Run')
    $jmTimer = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
    $jmLogon = New-ScheduledTaskTrigger -AtLogOn -User $jmIdentity.Name
    $jmPrincipal = New-ScheduledTaskPrincipal -UserId $jmIdentity.User.Value -LogonType Interactive -RunLevel Limited
    $jmSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 12)
    return (New-ScheduledTask -Action $jmAction -Trigger @($jmTimer, $jmLogon) -Principal $jmPrincipal -Settings $jmSettings -Description 'Copies des archives chiffrees JessieMessage, session Windows ouverte.')
}
function Start-JmBackup {
    $jmLock = $null
    try {
        if ($Setup) {
            $jmPairFile = Get-Item -LiteralPath (Join-Path $PSScriptRoot 'raccordement.json') -Force
            if ($jmPairFile.Length -gt 4096 -or ($jmPairFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Kit non valide.' }
            $jmPair = Get-Content -LiteralPath $jmPairFile.FullName -Raw | ConvertFrom-Json
            if ($jmPair.version -ne 1 -or $jmPair.destinationId -cnotmatch '^[a-f0-9]{32}$' -or $jmPair.pairingCode -cnotmatch '^[A-Za-z0-9_-]{43}$' -or
                $jmPair.origin -cne $script:JmOrigin -or $jmPair.expiresAt -lt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) { throw 'Kit expire. Telecharger un nouveau kit depuis Sauvegardes sur le site.' }
            $jmFolder = Select-JmFolder -Current (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'JessieMessage-sauvegardes') -Installing $true
            if ([string]::IsNullOrWhiteSpace($jmFolder)) { return }
            $jmDirectory = Join-Path $env:LOCALAPPDATA ('JessieMessage\Sauvegardes\' + $jmPair.destinationId)
            Set-JmPrivateDirectory $jmDirectory
            $jmLock = New-Object IO.FileStream((Join-Path $jmDirectory 'agent.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            if (-not (Test-Path -LiteralPath $jmFolder)) { $null = New-Item -ItemType Directory -Path $jmFolder }
            Assert-JmDirectory $jmFolder
            $jmConnected = Invoke-JmApi -Action pair -Body @{ destinationId = $jmPair.destinationId; pairingCode = $jmPair.pairingCode }
            if ($jmConnected.version -ne 1 -or $jmConnected.destinationId -cne $jmPair.destinationId -or $jmConnected.token -cnotmatch '^[A-Za-z0-9_-]{43}$') { throw 'Autorisation non valide.' }
            $jmSecret = ConvertTo-SecureString $jmConnected.token -AsPlainText -Force
            $jmConfig = [pscustomobject]@{ Version = 1; DestinationId = $jmPair.destinationId; LocationId = [Guid]::NewGuid().ToString('N'); Folder = $jmFolder; Credential = (New-Object Management.Automation.PSCredential($jmPair.destinationId, $jmSecret)) }
            Save-JmConfiguration -Configuration $jmConfig -Directory $jmDirectory
            $jmConnected = $null; $jmPair = $null
            $jmInstalled = Join-Path $jmDirectory 'JessieMessage-sauvegardes-055.ps1'
            Copy-Item -LiteralPath $script:JmScriptFile -Destination $jmInstalled -Force
            $jmTask = New-JmTaskDefinition $jmInstalled
            $null = Register-ScheduledTask -TaskName ('JessieMessage-Sauvegardes-' + $jmConfig.DestinationId) -InputObject $jmTask -Force
            $jmShell = New-Object -ComObject WScript.Shell
            $jmShortcut = $jmShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) ('JessieMessage - Sauvegardes-' + $jmConfig.DestinationId.Substring(0, 6) + '.lnk')))
            $jmShortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
            $jmShortcut.Arguments = '-NoProfile -STA -ExecutionPolicy Bypass -File "' + $jmInstalled + '" -Settings'
            $jmShortcut.Save()
        } else {
            $jmDirectory = $PSScriptRoot
            Assert-JmDirectory $jmDirectory
            $jmLock = New-Object IO.FileStream((Join-Path $jmDirectory 'agent.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            $jmConfig = Read-JmConfiguration $jmDirectory
            if ($Settings) {
                $jmFolder = Select-JmFolder -Current $jmConfig.Folder -Installing $false
                if ([string]::IsNullOrWhiteSpace($jmFolder)) { return }
                if (-not (Test-Path -LiteralPath $jmFolder)) { $null = New-Item -ItemType Directory -Path $jmFolder }
                Assert-JmDirectory $jmFolder
                if ($jmFolder -ne $jmConfig.Folder) { $jmConfig.LocationId = [Guid]::NewGuid().ToString('N') }
                $jmConfig.Folder = $jmFolder
                Save-JmConfiguration -Configuration $jmConfig -Directory $jmDirectory
            }
        }
        $jmStatus = Invoke-JmCopies $jmConfig
        [IO.File]::WriteAllText((Join-Path $jmDirectory 'dernier-etat.txt'), ([DateTime]::UtcNow.ToString('o') + "`r`n" + $jmStatus), [Text.Encoding]::UTF8)
        if ($Setup -or $Settings) { $null = [Windows.Forms.MessageBox]::Show($jmStatus + "`r`nLe raccourci du Bureau permet de changer le dossier.", 'JessieMessage') }
    } catch {
        if ($Setup -or $Settings) {
            Add-Type -AssemblyName System.Windows.Forms
            $null = [Windows.Forms.MessageBox]::Show('La mise en place ou la copie n''est pas confirmee. Si le kit a deja ete utilise, telecharger un nouveau kit depuis le site. Les fichiers existants sont conserves.', 'JessieMessage')
        }
        Write-Output 'JESSIEMESSAGE_COPIE_NON_CONFIRMEE'
        exit 1
    } finally { if ($null -ne $jmLock) { $jmLock.Dispose() } }
}

# Dot sourcing loads functions for isolated Windows verification without network,
# scheduling, graphical dialogs or any access to a user's recovery key.
if ($MyInvocation.InvocationName -ne '.') { Start-JmBackup }
