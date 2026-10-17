# Run on the owner's Windows PC. Never upload the private directory or key.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Windows PowerShell 5.1 treats redirected native stderr as ErrorRecord objects.
# A harmless GPG warning must not abort a command whose actual exit code is zero.
function Get-JmGpgOutput {
    param([string[]]$GpgArguments)
    $jmPreviousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $jmNativeOutput = @(& $script:jmGpg @GpgArguments 2>$null)
        $jmNativeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $jmPreviousPreference
    }
    if ($jmNativeExitCode -ne 0) { throw 'La lecture locale GPG a echoue. Aucun fichier prive n''a ete transmis.' }
    return $jmNativeOutput
}

try {
    $jmGpg = (Get-Command gpg -CommandType Application -ErrorAction Stop).Source
    $jmDownloads = Join-Path $env:USERPROFILE 'Downloads'
    $jmHome = Join-Path $jmDownloads 'JessieMessage-recuperation-052'
    $jmPublic = Join-Path $jmDownloads 'JessieMessage-cle-publique-052.asc'
    $jmPrivateCopy = Join-Path $jmHome 'NE-PAS-PARTAGER-cle-privee.asc'
    if (-not (Test-Path -LiteralPath $jmHome)) {
        New-Item -ItemType Directory -Path $jmHome -ErrorAction Stop | Out-Null
    }
    if (-not (Test-Path -LiteralPath $jmHome -PathType Container)) {
        throw 'Le dossier de recuperation n''est pas disponible.'
    }
    $jmBase = @('--no-options', '--homedir', $jmHome, '--no-auto-key-retrieve', '--auto-key-locate', 'clear')
    $jmListing = @(Get-JmGpgOutput -GpgArguments ($jmBase + @('--with-colons', '--fingerprint', '--list-secret-keys')))
    $jmPrimary = @($jmListing | Where-Object { $_ -match '^sec:' })
    if ($jmPrimary.Count -gt 1) { throw 'Plusieurs cles locales : aucune modification effectuee. Transmettre ce message.' }
    if ($jmPrimary.Count -eq 0) {
        Write-Host ''
        Write-Host 'GPG va demander une NOUVELLE phrase secrete pour la recuperation des sauvegardes.'
        Write-Host 'Choisis une phrase longue et unique, conserve-la personnellement et ne la transmets pas.'
        & $jmGpg @jmBase --quick-generate-key 'JessieMessage sauvegardes 0.52' rsa3072 encr 0
        if ($LASTEXITCODE -ne 0) { throw 'Creation interrompue. Aucune cle publique n''a ete transmise.' }
        $jmListing = @(Get-JmGpgOutput -GpgArguments ($jmBase + @('--with-colons', '--fingerprint', '--list-secret-keys')))
    }
    $jmPrimary = @($jmListing | Where-Object { $_ -match '^sec:' })
    $jmFingerprints = @($jmListing | Where-Object { $_ -match '^fpr:' })
    if ($jmPrimary.Count -ne 1 -or $jmFingerprints.Count -ne 1) { throw 'Une seule cle de recuperation est attendue.' }
    $jmFingerprint = ($jmFingerprints[0] -split ':')[9]
    if ($jmFingerprint -notmatch '^[A-F0-9]{40}$') { throw 'Empreinte de recuperation inattendue.' }
    # GPG writes the files itself: PowerShell must not change their encoding.
    if (-not (Test-Path -LiteralPath $jmPublic)) {
        & $jmGpg @jmBase --armor --output $jmPublic --export $jmFingerprint
        if ($LASTEXITCODE -ne 0) { throw 'Export PUBLIC interrompu.' }
    }
    $jmShown = @(Get-JmGpgOutput -GpgArguments ($jmBase + @('--with-colons', '--fingerprint', '--show-keys', $jmPublic)))
    if (@($jmShown | Where-Object { $_ -match '^pub:' }).Count -ne 1 -or
        @($jmShown | Where-Object { $_ -match '^(sec|ssb):' }).Count -ne 0 -or
        @($jmShown | Where-Object { $_ -match ('^fpr:.*:' + $jmFingerprint + ':') }).Count -ne 1) {
        throw 'Le fichier public existant ne correspond pas : conserver les fichiers et transmettre ce message.'
    }
    if (-not (Test-Path -LiteralPath $jmPrivateCopy)) {
        & $jmGpg @jmBase --armor --output $jmPrivateCopy --export-secret-keys $jmFingerprint
        if ($LASTEXITCODE -ne 0) { throw 'La copie privee locale n''est pas confirmee.' }
    }
    if ((Get-Item -LiteralPath $jmPublic).Length -lt 100 -or (Get-Item -LiteralPath $jmPrivateCopy).Length -lt 100) {
        throw 'Les exports locaux ne sont pas complets.'
    }
    # Prove local recovery with harmless fixed bytes before approving the public export.
    $jmProofDirectory = Join-Path $jmHome ('verification-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $jmProofDirectory -ErrorAction Stop | Out-Null
    $jmProofHome = Join-Path $jmProofDirectory 'trousseau-verification'
    New-Item -ItemType Directory -Path $jmProofHome -ErrorAction Stop | Out-Null
    $jmProofBase = @('--no-options', '--homedir', $jmProofHome, '--no-auto-key-retrieve', '--auto-key-locate', 'clear')
    & $jmGpg @jmProofBase --import $jmPrivateCopy
    if ($LASTEXITCODE -ne 0) { throw 'La copie privee ne peut pas etre importee dans le trousseau de verification.' }
    $jmProofSecret = @(Get-JmGpgOutput -GpgArguments ($jmProofBase + @('--with-colons', '--fingerprint', '--list-secret-keys')))
    if (@($jmProofSecret | Where-Object { $_ -match '^sec:' }).Count -ne 1 -or
        @($jmProofSecret | Where-Object { $_ -match ('^fpr:.*:' + $jmFingerprint + ':') }).Count -ne 1) {
        throw 'La copie privee locale ne correspond pas. Aucun fichier existant n''a ete remplace.'
    }
    $jmProofSource = Join-Path $jmProofDirectory 'original.bin'
    $jmProofEncrypted = Join-Path $jmProofDirectory 'verification.gpg'
    $jmProofRestored = Join-Path $jmProofDirectory 'restaure.bin'
    [System.IO.File]::WriteAllBytes($jmProofSource, [System.Text.Encoding]::UTF8.GetBytes('JessieMessage recovery verification 0.52'))
    & $jmGpg @jmBase --trust-model always --recipient-file $jmPublic --cipher-algo AES256 --compress-algo none --force-mdc --output $jmProofEncrypted --encrypt $jmProofSource
    if ($LASTEXITCODE -ne 0) { throw 'Le chiffrement de verification a echoue.' }
    & $jmGpg @jmProofBase --output $jmProofRestored --decrypt $jmProofEncrypted
    if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $jmProofSource -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $jmProofRestored -Algorithm SHA256).Hash) {
        throw 'Le dechiffrement personnel de verification n''est pas confirme.'
    }
    $jmSha = (Get-FileHash -LiteralPath $jmPublic -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host ''
    Write-Host 'CLE_PUBLIQUE_052_PRETE'
    Write-Host 'VERIFICATION_CLE_052_OK'
    Write-Host ('Fichier PUBLIC a joindre dans la discussion : ' + $jmPublic)
    Write-Host ('SHA-256 public : ' + $jmSha)
    Write-Host ('Empreinte OpenPGP publique : ' + $jmFingerprint)
    Write-Host ''
    Write-Host 'Conserve personnellement le dossier JessieMessage-recuperation-052 et une copie hors de ce PC.'
    Write-Host 'Ne partage jamais NE-PAS-PARTAGER-cle-privee.asc, le dossier complet ou ta phrase secrete.'
} catch {
    Write-Host ''
    Write-Host ('Preparation interrompue : ' + $_.Exception.Message)
    exit 1
}
