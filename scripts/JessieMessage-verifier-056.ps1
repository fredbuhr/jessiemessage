# Offline Windows PowerShell 5.1 verification. GPG alone handles the existing key.
# Decrypted bytes go directly from the process pipe to SHA-256, never to a file.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-JmVerificationGpg {
    # Prefer the native Windows installation over Git's MSYS-only executable.
    foreach ($folder in @([Environment]::GetFolderPath('ProgramFilesX86'), [Environment]::GetFolderPath('ProgramFiles'))) {
        if (-not $folder) { continue }
        $candidate = Join-Path $folder 'GnuPG\bin\gpg.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return (Get-Command gpg -CommandType Application -ErrorAction Stop).Source
}
function Assert-JmVerificationDirectory {
    param([string]$Path)
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path -match '["\x00-\x1f]') { throw 'DOSSIER_INDISPONIBLE' }
    $item = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($Path))
    while ($null -ne $item) {
        if (-not $item.Exists -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'DOSSIER_INDISPONIBLE' }
        $item = $item.Parent
    }
}
function Assert-JmVerificationFields {
    param($Value, [string[]]$Names)
    if ($null -eq $Value -or $Value -isnot [pscustomobject]) { throw 'KIT_INVALIDE' }
    $properties = @($Value.PSObject.Properties.Name)
    if ($properties.Count -ne $Names.Count) { throw 'KIT_INVALIDE' }
    foreach ($name in $properties) { if ($Names -cnotcontains $name) { throw 'KIT_INVALIDE' } }
}
function Read-JmVerification {
    param([string]$Path)
    Assert-JmVerificationDirectory ([IO.Path]::GetDirectoryName($Path))
    $file = Get-Item -LiteralPath $Path -Force
    if ($file -isnot [IO.FileInfo] -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 4096 -or $file.Length -lt 1) { throw 'KIT_INVALIDE' }
    $record = [IO.File]::ReadAllText($file.FullName, [Text.UTF8Encoding]::new($false, $true)) | ConvertFrom-Json
    Assert-JmVerificationFields $record @('format', 'version', 'archive', 'source', 'recipient', 'protection')
    Assert-JmVerificationFields $record.archive @('id', 'startedAt', 'filename', 'bytes', 'sha256')
    Assert-JmVerificationFields $record.source @('bytes', 'sha256')
    Assert-JmVerificationFields $record.recipient @('fingerprint')
    foreach ($text in @($record.format, $record.archive.id, $record.archive.filename, $record.archive.sha256, $record.source.sha256, $record.recipient.fingerprint, $record.protection)) {
        if ($text -isnot [string]) { throw 'KIT_INVALIDE' }
    }
    if ($record.format -cne 'jessiemessage-backup-verification' -or $record.version -isnot [int] -or $record.version -ne 1 -or
        $record.archive.id -cnotmatch '^capture-[1-9][0-9]{0,14}-[a-f0-9]{16}$' -or
        $record.archive.filename -cne ('JessieMessage-' + $record.archive.id + '.tar.gz.gpg') -or
        $record.recipient.fingerprint -cnotmatch '^(?:[A-F0-9]{40}|[A-F0-9]{64})$' -or
        @('mdc', 'ocb-aead') -cnotcontains $record.protection) { throw 'KIT_INVALIDE' }
    foreach ($item in @($record.archive, $record.source)) {
        if (($item.bytes -isnot [int] -and $item.bytes -isnot [long]) -or $item.bytes -lt 1 -or $item.bytes -gt 2151677952 -or
            $item.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'KIT_INVALIDE' }
    }
    if (($record.archive.startedAt -isnot [int] -and $record.archive.startedAt -isnot [long]) -or
        $record.archive.startedAt -ne [long]($record.archive.id.Split('-')[1]) -or $record.archive.startedAt -gt 253402300799999) { throw 'KIT_INVALIDE' }
    return $record
}
function Initialize-JmVerificationRuntime {
    if ('JessieMessage.BackupVerifier056' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
namespace JessieMessage {
    public sealed class VerificationResult056 {
        public long Bytes;
        public string Sha256;
    }
    public static class BackupVerifier056 {
        // Windows CreateProcess quoting, including a trailing backslash.
        public static string Quote(string value) {
            var text = new StringBuilder("\""); int slashes = 0;
            foreach (char c in value) {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') { text.Append('\\', slashes * 2 + 1); text.Append(c); }
                else { text.Append('\\', slashes); text.Append(c); }
                slashes = 0;
            }
            text.Append('\\', slashes * 2); return text.Append('"').ToString();
        }
        public static Task<VerificationResult056> Start(string gpg, string home, string file,
            long cipherBytes, string cipherHash, long sourceBytes, string sourceHash,
            string fingerprint, string protection, int timeoutMs, CancellationToken cancel) {
            return Task.Factory.StartNew(() => Verify(gpg, home, file, cipherBytes, cipherHash,
                sourceBytes, sourceHash, fingerprint, protection, timeoutMs, cancel));
        }
        static string Hash(Stream input) {
            using (var hash = SHA256.Create()) { return BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant(); }
        }
        static void FileReady(string path, long size) {
            var info = new FileInfo(path);
            if (!info.Exists || (info.Attributes & FileAttributes.ReparsePoint) != 0 || info.Length != size)
                throw new InvalidDataException("COPIE_NON_CONFORME");
        }
        public static VerificationResult056 Verify(string gpg, string home, string file,
            long cipherBytes, string cipherHash, long sourceBytes, string sourceHash,
            string fingerprint, string protection, int timeoutMs, CancellationToken cancel) {
            if (timeoutMs < 1 || timeoutMs > 600000 || cipherBytes < 1 || cipherBytes > 2151677952L || sourceBytes < 1 || sourceBytes > 2151677952L)
                throw new InvalidDataException("KIT_INVALIDE");
            cancel.ThrowIfCancellationRequested(); FileReady(file, cipherBytes);
            // Deny writes and deletion while hashing and while GPG reads the same file.
            using (var pinned = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                if (pinned.Length != cipherBytes || Hash(pinned) != cipherHash) throw new InvalidDataException("COPIE_NON_CONFORME");
                FileReady(file, cipherBytes); cancel.ThrowIfCancellationRequested();
                using (var process = new Process()) {
                    var arguments = new string[] { "--no-options", "--homedir", home, "--no-auto-key-retrieve", "--auto-key-locate", "clear",
                        "--no-tty", "--pinentry-mode", "ask", "--status-fd", "2", "--output", "-", "--decrypt", "--", file };
                    process.StartInfo = new ProcessStartInfo { FileName = gpg, Arguments = String.Join(" ", Array.ConvertAll(arguments, Quote)),
                        UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true };
                    Task<VerificationResult056> output = null; Task<string> status = null;
                    var watch = Stopwatch.StartNew(); bool started = false;
                    try {
                        started = process.Start(); if (!started) throw new IOException("GPG_INDISPONIBLE");
                        process.StandardInput.Close();
                        output = Task.Factory.StartNew(() => {
                            byte[] chunk = new byte[65536]; long total = 0;
                            try {
                                using (var hash = SHA256.Create()) {
                                    int count;
                                    while ((count = process.StandardOutput.BaseStream.Read(chunk, 0, chunk.Length)) > 0) {
                                        cancel.ThrowIfCancellationRequested(); total += count;
                                        if (total > sourceBytes) throw new InvalidDataException("CONTENU_NON_CONFORME");
                                        hash.TransformBlock(chunk, 0, count, chunk, 0);
                                        Array.Clear(chunk, 0, count);
                                    }
                                    hash.TransformFinalBlock(new byte[0], 0, 0);
                                    return new VerificationResult056 { Bytes = total, Sha256 = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant() };
                                }
                            } finally { Array.Clear(chunk, 0, chunk.Length); }
                        });
                        status = Task.Factory.StartNew(() => {
                            var text = new StringBuilder(); char[] chunk = new char[1024]; int count; bool overflow = false;
                            while ((count = process.StandardError.Read(chunk, 0, chunk.Length)) > 0) {
                                if (text.Length + count <= 16384) text.Append(chunk, 0, count); else overflow = true;
                                Array.Clear(chunk, 0, count);
                            }
                            if (overflow) throw new InvalidDataException("GPG_NON_CONFIRME");
                            return text.ToString();
                        });
                        while (!process.HasExited || !output.IsCompleted || !status.IsCompleted) {
                            cancel.ThrowIfCancellationRequested();
                            if (watch.ElapsedMilliseconds > timeoutMs) throw new TimeoutException("VERIFICATION_INTERROMPUE");
                            if (output.IsFaulted || status.IsFaulted) throw new InvalidDataException("GPG_NON_CONFIRME");
                            Thread.Sleep(30);
                        }
                        var result = output.GetAwaiter().GetResult(); string diagnostics = status.GetAwaiter().GetResult();
                        if (process.ExitCode != 0 || result.Bytes != sourceBytes || result.Sha256 != sourceHash ||
                            Regex.Matches(diagnostics, @"(?m)^\[GNUPG:\] DECRYPTION_OKAY\r?$").Count != 1 ||
                            Regex.Matches(diagnostics, @"(?m)^\[GNUPG:\] DECRYPTION_KEY [A-F0-9]+ " + Regex.Escape(fingerprint) + @" [^\r\n]+\r?$").Count != 1 ||
                            Regex.IsMatch(diagnostics, @"(?m)^\[GNUPG:\] (?:DECRYPTION_FAILED|FAILURE|ERROR|BADMDC|ERRMDC|NODATA)(?: |\r?$)"))
                            throw new InvalidDataException("DECHIFFREMENT_NON_CONFIRME");
                        string info = protection == "mdc" ? @"2 9(?: 0)?" : @"0 9 2";
                        if (Regex.Matches(diagnostics, @"(?m)^\[GNUPG:\] DECRYPTION_INFO " + info + @"(?: 0)?\r?$").Count != 1)
                            throw new InvalidDataException("PROTECTION_NON_CONFIRMEE");
                        pinned.Position = 0;
                        if (Hash(pinned) != cipherHash) throw new InvalidDataException("COPIE_NON_CONFORME");
                        FileReady(file, cipherBytes); return result;
                    } finally {
                        if (started && !process.HasExited) { process.Kill(); process.WaitForExit(5000); }
                        try { if (output != null && status != null) Task.WaitAll(new Task[] { output, status }, 5000); } catch { }
                    }
                }
            }
        }
    }
}
'@
}
function Start-JmVerificationWindow {
    param([string]$MetadataPath = (Join-Path $PSScriptRoot 'verification.json'), [switch]$CheckLayout)
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    $record = Read-JmVerification $MetadataPath
    Initialize-JmVerificationRuntime
    $gpg = Find-JmVerificationGpg
    $form = [Windows.Forms.Form]::new()
    $form.Text = 'JessieMessage - Verifier une sauvegarde'
    $form.ClientSize = [Drawing.Size]::new(680, 500)
    $form.MinimumSize = [Drawing.Size]::new(600, 500)
    $form.StartPosition = 'CenterScreen'
    $layout = [Windows.Forms.TableLayoutPanel]::new()
    $layout.Dock = 'Fill'; $layout.Padding = [Windows.Forms.Padding]::new(18); $layout.ColumnCount = 2; $layout.RowCount = 8
    for ($row = 0; $row -lt 8; $row++) { $layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::AutoSize)) | Out-Null }
    $layout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Percent, 100)) | Out-Null
    $layout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Absolute, 115)) | Out-Null
    $form.Controls.Add($layout)
    $intro = [Windows.Forms.Label]::new(); $intro.AutoSize = $true; $intro.MaximumSize = [Drawing.Size]::new(620, 0)
    $intro.Text = "Verifier la copie du " + [DateTimeOffset]::FromUnixTimeMilliseconds($record.archive.startedAt).ToLocalTime().ToString('dd/MM/yyyy HH:mm') + ".`r`nLe contenu est dechiffre en memoire, puis compare a la capture du site."
    $layout.Controls.Add($intro, 0, 0); $layout.SetColumnSpan($intro, 2)
    $fileLabel = [Windows.Forms.Label]::new(); $fileLabel.AutoSize = $true; $fileLabel.Text = 'Copie chiffree : ' + $record.archive.filename
    $layout.Controls.Add($fileLabel, 0, 1); $layout.SetColumnSpan($fileLabel, 2)
    $file = [Windows.Forms.TextBox]::new(); $file.ReadOnly = $true; $file.Dock = 'Fill'
    $chooseFile = [Windows.Forms.Button]::new(); $chooseFile.Text = 'Choisir le fichier'; $chooseFile.AutoSize = $true
    $layout.Controls.Add($file, 0, 2); $layout.Controls.Add($chooseFile, 1, 2)
    $keyHomeLabel = [Windows.Forms.Label]::new(); $keyHomeLabel.AutoSize = $true; $keyHomeLabel.Text = 'Dossier de recuperation existant (contenant le trousseau GPG)'
    $layout.Controls.Add($keyHomeLabel, 0, 3); $layout.SetColumnSpan($keyHomeLabel, 2)
    $keyHome = [Windows.Forms.TextBox]::new(); $keyHome.ReadOnly = $true; $keyHome.Dock = 'Fill'
    $keyHome.Text = Join-Path (Join-Path $env:USERPROFILE 'Downloads') 'JessieMessage-recuperation-052'
    $chooseHome = [Windows.Forms.Button]::new(); $chooseHome.Text = 'Changer'; $chooseHome.AutoSize = $true
    $layout.Controls.Add($keyHome, 0, 4); $layout.Controls.Add($chooseHome, 1, 4)
    $instructions = [Windows.Forms.Label]::new(); $instructions.AutoSize = $true; $instructions.MaximumSize = [Drawing.Size]::new(620, 0)
    $instructions.Text = "GPG peut demander la phrase secrete dans sa propre fenetre locale.`r`nCette verification ne transmet rien et ne restaure aucune donnee dans l'application."
    $layout.Controls.Add($instructions, 0, 5); $layout.SetColumnSpan($instructions, 2)
    $status = [Windows.Forms.Label]::new(); $status.AutoSize = $true; $status.MaximumSize = [Drawing.Size]::new(620, 0)
    $status.Text = 'Choisir la copie chiffree deja recue sur le PC.'
    $layout.Controls.Add($status, 0, 6); $layout.SetColumnSpan($status, 2)
    $verify = [Windows.Forms.Button]::new(); $verify.Text = 'Verifier'; $verify.AutoSize = $true
    $cancel = [Windows.Forms.Button]::new(); $cancel.Text = 'Fermer'; $cancel.AutoSize = $true
    $layout.Controls.Add($verify, 0, 7); $layout.Controls.Add($cancel, 1, 7)
    $form.Add_Resize({
        $width = [Math]::Max(100, $layout.ClientSize.Width - $layout.Padding.Horizontal)
        foreach ($label in @($intro, $fileLabel, $keyHomeLabel, $instructions, $status)) { $label.MaximumSize = [Drawing.Size]::new($width, 0) }
    })
    $work = @{ Task = $null; Cancellation = $null }
    $chooseFile.Add_Click({
        $dialog = [Windows.Forms.OpenFileDialog]::new()
        try {
            $dialog.Title = 'Choisir la copie chiffree a verifier'; $dialog.Filter = 'Archive chiffree (*.gpg)|*.gpg'
            $dialog.FileName = $record.archive.filename
            if ($dialog.ShowDialog($form) -eq [Windows.Forms.DialogResult]::OK) { $file.Text = $dialog.FileName }
        } finally { $dialog.Dispose() }
    })
    $chooseHome.Add_Click({
        $dialog = [Windows.Forms.FolderBrowserDialog]::new()
        try {
            $dialog.Description = 'Choisir le dossier du trousseau GPG existant, pas le fichier de cle privee.'
            $dialog.SelectedPath = $keyHome.Text; $dialog.ShowNewFolderButton = $false
            if ($dialog.ShowDialog($form) -eq [Windows.Forms.DialogResult]::OK) { $keyHome.Text = $dialog.SelectedPath }
        } finally { $dialog.Dispose() }
    })
    $timer = [Windows.Forms.Timer]::new(); $timer.Interval = 150
    $verify.Add_Click({
        try {
            Assert-JmVerificationDirectory $keyHome.Text
            Assert-JmVerificationDirectory ([IO.Path]::GetDirectoryName($file.Text))
            $cipher = Get-Item -LiteralPath $file.Text -Force
            if ($cipher -isnot [IO.FileInfo] -or $cipher.Name -cne $record.archive.filename) { throw 'COPIE_NON_CONFORME' }
            $work.Cancellation = [Threading.CancellationTokenSource]::new()
            $work.Task = [JessieMessage.BackupVerifier056]::Start($gpg, $keyHome.Text, $cipher.FullName,
                $record.archive.bytes, $record.archive.sha256, $record.source.bytes, $record.source.sha256,
                $record.recipient.fingerprint, $record.protection, 600000, $work.Cancellation.Token)
            $verify.Enabled = $false; $chooseFile.Enabled = $false; $chooseHome.Enabled = $false
            $cancel.Text = 'Annuler'; $status.Text = 'Verification en cours. Repondre a la fenetre locale GPG si elle apparait.'
            $timer.Start()
        } catch { $status.Text = 'Verification non lancee. Choisir le fichier demande et le dossier de recuperation existant.' }
    })
    $timer.Add_Tick({
        if ($null -eq $work.Task -or -not $work.Task.IsCompleted) { return }
        $timer.Stop()
        try {
            $null = $work.Task.GetAwaiter().GetResult()
            $status.Text = 'DECHIFFREMENT_VERIFIE - copie conforme et contenu dechiffre identique a la capture. Cette preuve concerne cette archive uniquement.'
            [Windows.Forms.MessageBox]::Show($form, $status.Text, 'JessieMessage', [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Information) | Out-Null
        } catch { $status.Text = 'DECHIFFREMENT_NON_CONFIRME - verification interrompue ou copie, cle, phrase ou contenu non conformes. Aucun fichier existant n''a ete remplace.' }
        finally {
            $work.Task = $null; $work.Cancellation.Dispose(); $work.Cancellation = $null
            $verify.Enabled = $true; $chooseFile.Enabled = $true; $chooseHome.Enabled = $true; $cancel.Text = 'Fermer'
        }
    })
    $cancel.Add_Click({ if ($null -ne $work.Task) { $work.Cancellation.Cancel(); $status.Text = 'Annulation en cours...' } else { $form.Close() } })
    try {
        if ($CheckLayout) {
            # Native CI opens only the empty form, without a file chooser or GPG.
            $form.Show()
            foreach ($width in @(680, 600)) {
                $form.ClientSize = [Drawing.Size]::new($width, 500); $layout.PerformLayout()
                foreach ($control in $layout.Controls) {
                    if ($control.Left -lt 0 -or $control.Top -lt 0 -or $control.Right -gt $layout.ClientSize.Width -or $control.Bottom -gt $layout.ClientSize.Height) { throw 'WINDOW_LAYOUT_INVALID' }
                }
            }
            $form.Close(); return
        }
        $null = $form.ShowDialog()
    }
    finally {
        $timer.Stop(); $timer.Dispose()
        if ($null -ne $work.Cancellation) {
            $work.Cancellation.Cancel()
            try { $null = $work.Task.Wait(6000) } catch { }
            $work.Cancellation.Dispose()
        }
        $form.Dispose()
    }
}

# Dot-sourcing exposes only the functions for hermetic native Windows tests.
if ($MyInvocation.InvocationName -ne '.') {
    try { Start-JmVerificationWindow }
    catch {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show('Verification indisponible. Extraire tout le kit et verifier que GPG est installe et le trousseau existant disponible.', 'JessieMessage') | Out-Null
        exit 1
    }
}
