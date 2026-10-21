#!/bin/bash
# Preparation 1.4.0 et repli de compatibilite 1.3.4, depuis la production 1.3.3.
# Les quatre pins cible sont issus des commits qualifies et publies.
# Usage : bash prepare-release140.sh <SHA_RELEASE134_EXACT> <SHA_RELEASE140_EXACT>
# Aucun start, redemarrage, changement Manager, migration ou checkpoint.
set +x
set -euo pipefail
trap 'printf "STAGING_REFUSED: shell_check_line_%s\n" "$LINENO" >&2' ERR
umask 077
jm_sha134="${1:?SHA 1.3.4 fusionne exact requis}"
jm_sha140="${2:?SHA 1.4.0 fusionne exact requis}"
[[ $# == 2 ]]
[[ "$jm_sha134" =~ ^[a-f0-9]{40}$ && "$jm_sha140" =~ ^[a-f0-9]{40}$ ]]
[[ "$jm_sha134" == 4538148660fbf1487807fb1518747d8f5753cd3b ]]
[[ "$jm_sha140" == 56d4595059df9292fc54ba4d4e948eeb793bae96 ]]
[[ "$jm_sha134" != "$jm_sha140" ]]
jm_tree134=248477f9c63064a57445e5b15023e58fdde8e02c
jm_tree140=8129e76c9817e79c062a4437eadee4b7ce4d90a1
[[ "$jm_tree134" =~ ^[a-f0-9]{40}$ && "$jm_tree140" =~ ^[a-f0-9]{40}$ ]]
jm_old=/srv/customer/jessiemessage-operator/production-133-ca0d4064
jm_oldsha=ca0d40648036d57fdee55b91d47d5d5a874a626e
jm_oldtree=b1fe882ede0450cbf135d2ff8cb19e780d18a0e5
jm_private=/srv/customer/jessiemessage-private
jm_node=$jm_private/runtime-node-v24.22.0/bin/node
jm_node_sha=67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c
jm_oldlauncher=$jm_private/start-primary-release133-ca0d4064.sh
jm_oldcheck=$jm_private/check-primary-release133-ca0d4064.sh
jm_target134=/srv/customer/jessiemessage-operator/production-134-${jm_sha134:0:8}
jm_launcher134=$jm_private/start-primary-release134-${jm_sha134:0:8}.sh
jm_check134=$jm_private/check-primary-release134-${jm_sha134:0:8}.sh
jm_log134=$jm_private/jm134-node2422.log
jm_prelog134=$jm_private/jm134-preflight-${jm_sha134:0:8}.log
jm_target140=/srv/customer/jessiemessage-operator/production-140-${jm_sha140:0:8}
jm_launcher140=$jm_private/start-primary-release140-${jm_sha140:0:8}.sh
jm_check140=$jm_private/check-primary-release140-${jm_sha140:0:8}.sh
jm_log140=$jm_private/jm140-node2422.log
jm_prelog140=$jm_private/jm140-preflight-${jm_sha140:0:8}.log
unset NODE_OPTIONS NODE_PATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
jm_git() { /usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$1" "${@:2}"; }
jm_source() {
  local jm_status
  [[ ! -L "$1" && $(jm_git "$1" rev-parse HEAD) == "$2" ]]
  [[ $(jm_git "$1" rev-parse 'HEAD^{tree}') == "$3" ]]
  jm_status=$(jm_git "$1" status --porcelain --untracked-files=normal)
  [[ -z "$jm_status" ]]
}
jm_old_pins() {
  jm_source "$jm_old" "$jm_oldsha" "$jm_oldtree"
  [[ $(sha256sum "$jm_oldlauncher" | cut -d' ' -f1) == 88aad7a731cc58a4367e808c9f4156b47c6f647f71b10f4b2e0fb65d093cea89 ]]
  [[ $(sha256sum "$jm_oldcheck" | cut -d' ' -f1) == 80bfd6dbeebacc4f550baf95d76921e85b3e196814b12554333c80561d155623 ]]
  [[ $(sha256sum "$jm_node" | cut -d' ' -f1) == "$jm_node_sha" ]]
  [[ $("$jm_node" --version) == v24.22.0 ]]
}
jm_old_pins
# Refuser toute repetition aveugle, y compris un staging partiel d'une cible.
for jm_path in "$jm_target134" "$jm_launcher134" "$jm_check134" "$jm_log134" "$jm_prelog134" "$jm_target140" "$jm_launcher140" "$jm_check140" "$jm_log140" "$jm_prelog140"; do
  [[ ! -e "$jm_path" && ! -L "$jm_path" ]]
done
jm_git "$jm_old" fetch --no-tags --no-recurse-submodules origin \
  refs/heads/main:refs/remotes/origin/main refs/tags/v1.3.4:refs/tags/v1.3.4 refs/tags/v1.4.0:refs/tags/v1.4.0 >/dev/null 2>&1
[[ $(jm_git "$jm_old" rev-parse 'refs/tags/v1.3.4^{commit}') == "$jm_sha134" ]]
[[ $(jm_git "$jm_old" rev-parse 'refs/tags/v1.4.0^{commit}') == "$jm_sha140" ]]
jm_git "$jm_old" cat-file -e "$jm_sha134^{commit}"
jm_git "$jm_old" cat-file -e "$jm_sha140^{commit}"
jm_git "$jm_old" merge-base --is-ancestor "$jm_oldsha" "$jm_sha134"
jm_git "$jm_old" merge-base --is-ancestor "$jm_sha134" "$jm_sha140"
jm_git "$jm_old" merge-base --is-ancestor "$jm_sha140" refs/remotes/origin/main
[[ $(jm_git "$jm_old" rev-parse "$jm_sha134^{tree}") == "$jm_tree134" ]]
[[ $(jm_git "$jm_old" rev-parse "$jm_sha140^{tree}") == "$jm_tree140" ]]
jm_git "$jm_old" worktree add --detach "$jm_target134" "$jm_sha134" >/dev/null 2>&1
jm_git "$jm_old" worktree add --detach "$jm_target140" "$jm_sha140" >/dev/null 2>&1
jm_source "$jm_target134" "$jm_sha134" "$jm_tree134"
jm_source "$jm_target140" "$jm_sha140" "$jm_tree140"
python3 - "$jm_old" "$jm_oldlauncher" "$jm_oldcheck" "$jm_oldsha" "$jm_oldtree" "$jm_sha134" "$jm_tree134" "$jm_target134" "$jm_launcher134" "$jm_check134" "$jm_log134" "$jm_prelog134" "$jm_sha140" "$jm_tree140" "$jm_target140" "$jm_launcher140" "$jm_check140" "$jm_log140" "$jm_prelog140" <<'PY'
import hashlib, json, os, pathlib, stat, sys
old, original, original_check = map(pathlib.Path, sys.argv[1:4])
oldsha, oldtree = sys.argv[4:6]
def release(version, values):
    sha, tree, target, normal, check, log, prelog = values
    return dict(version=version, sha=sha, tree=tree, target=pathlib.Path(target),
                normal=pathlib.Path(normal), check=pathlib.Path(check), log=pathlib.Path(log), prelog=pathlib.Path(prelog))
releases = [release('1.3.4', sys.argv[6:13]), release('1.4.0', sys.argv[13:20])]
def require(ok, label):
    if not ok: raise SystemExit('STAGING_REFUSED: ' + label)
def regular(path, mode):
    value = path.lstat()
    require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid() and value.st_nlink == 1
            and stat.S_IMODE(value.st_mode) == mode, 'file_metadata:' + path.name)
regular(original, 0o700)
regular(original_check, 0o700)
require(hashlib.sha256(original.read_bytes()).hexdigest() == '88aad7a731cc58a4367e808c9f4156b47c6f647f71b10f4b2e0fb65d093cea89', 'original_launcher_hash')
require(hashlib.sha256(original_check.read_bytes()).hexdigest() == '80bfd6dbeebacc4f550baf95d76921e85b3e196814b12554333c80561d155623', 'original_check_hash')
locks = []
for root, version in [(old, '1.3.3')] + [(value['target'], value['version']) for value in releases]:
    require(json.loads((root / 'package.json').read_text())['version'] == version, 'package_version:' + version)
    lock = json.loads((root / 'package-lock.json').read_text())
    require(lock['version'] == version and lock['packages']['']['version'] == version, 'lock_versions:' + version)
    del lock['version']; del lock['packages']['']['version']
    locks.append(lock)
require(locks[0] == locks[1] == locks[2], 'locked_dependencies')
def migrations(root):
    directory = root / 'db' / 'migrations'
    require(directory.is_dir() and not directory.is_symlink(), 'migration_directory')
    files = sorted(directory.iterdir())
    require(len(files) == 31 and all(path.name.endswith('.sql') and path.is_file()
            and not path.is_symlink() for path in files), 'schema31_files')
    return [(path.name, hashlib.sha256(path.read_bytes()).hexdigest()) for path in files]
require(migrations(old) == migrations(releases[0]['target']) == migrations(releases[1]['target']), 'migrations_changed')
deps = (old / 'node_modules').resolve(strict=True)
require(deps.is_dir() and deps.stat().st_uid == os.getuid(), 'old_dependencies_directory')
original_text = original.read_text()
require(original_text.count('start-local-closures') == 1 and original_text.count('check-local-closures') == 0, 'launcher_command')
plans = []
# Validate BOTH targets before creating any launchers, logs or dependency links.
for value in releases:
    link = value['target'] / 'node_modules'
    if link.is_symlink():
        require(link.lstat().st_uid == os.getuid() and link.resolve(strict=True) == deps, 'existing_dependencies_link')
    else:
        require(not link.exists(), 'unexpected_dependencies_directory')
    for name in ('normal', 'check', 'log', 'prelog'):
        require(not value[name].exists() and not value[name].is_symlink(), 'existing_output:' + value[name].name)
    text = original_text
    for label, before, after, count in (('commit', oldsha, value['sha'], 2), ('tree', oldtree, value['tree'], 2),
            ('directory', str(old), str(value['target']), 2), ('log', 'jm133-node2422.log', value['log'].name, 1)):
        require(text.count(before) == count, 'original_count:' + label)
        text = text.replace(before, after)
        require(before not in text and text.count(after) == count, 'replacement_count:' + label)
    precheck = text.replace('start-local-closures', 'check-local-closures')
    require(precheck.count(value['log'].name) == 1, 'precheck_log_count')
    precheck = precheck.replace(value['log'].name, value['prelog'].name)
    require('start-local-closures' not in precheck and precheck.count('check-local-closures') == 1, 'precheck_command')
    plans.append((value, link, text.encode(), precheck.encode()))
for value, link, text, precheck in plans:
    if not link.is_symlink(): link.symlink_to(deps, target_is_directory=True)
    for path, content, mode in ((value['normal'], text, 0o700), (value['check'], precheck, 0o700),
            (value['log'], b'', 0o600), (value['prelog'], b'', 0o600)):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'wb') as output:
            output.write(content); output.flush(); os.fsync(output.fileno())
        regular(path, mode)
        require(path.read_bytes() == content, 'written_file:' + path.name)
PY
jm_old_pins
jm_source "$jm_target134" "$jm_sha134" "$jm_tree134"
jm_source "$jm_target140" "$jm_sha140" "$jm_tree140"
for jm_script in "$jm_launcher134" "$jm_check134" "$jm_launcher140" "$jm_check140"; do bash -n "$jm_script"; done
# Seuls les deux lanceurs CHECK sont executes. Les journaux normaux restent vides.
timeout --signal=TERM --kill-after=5s 60s bash "$jm_check134" >>"$jm_prelog134" 2>&1
timeout --signal=TERM --kill-after=5s 60s bash "$jm_check140" >>"$jm_prelog140" 2>&1
jm_old_pins
jm_source "$jm_target134" "$jm_sha134" "$jm_tree134"
jm_source "$jm_target140" "$jm_sha140" "$jm_tree140"
python3 - "$jm_node" "$jm_node_sha" "$jm_oldlauncher" "$jm_oldcheck" "$jm_sha134" "$jm_tree134" "$jm_target134" "$jm_launcher134" "$jm_check134" "$jm_log134" "$jm_prelog134" "$jm_sha140" "$jm_tree140" "$jm_target140" "$jm_launcher140" "$jm_check140" "$jm_log140" "$jm_prelog140" <<'PY'
import hashlib, json, os, pathlib, stat, sys
node, node_sha, oldlauncher, oldcheck = sys.argv[1:5]
def fingerprint(path, mode, empty=False):
    path = pathlib.Path(path); value = path.lstat()
    if not (stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid() and value.st_nlink == 1
            and stat.S_IMODE(value.st_mode) == mode and (not empty or value.st_size == 0)):
        raise SystemExit('STAGING_REFUSED: final_file_metadata:' + path.name)
    return hashlib.sha256(path.read_bytes()).hexdigest()
if fingerprint(node, 0o700) != node_sha:
    raise SystemExit('STAGING_REFUSED: final_node_hash')
if fingerprint(oldlauncher, 0o700) != '88aad7a731cc58a4367e808c9f4156b47c6f647f71b10f4b2e0fb65d093cea89':
    raise SystemExit('STAGING_REFUSED: final_original_launcher_hash')
if fingerprint(oldcheck, 0o700) != '80bfd6dbeebacc4f550baf95d76921e85b3e196814b12554333c80561d155623':
    raise SystemExit('STAGING_REFUSED: final_original_check_hash')
def report(version, values):
    sha, tree, target, launcher, check, log, prelog = values
    receipts = []
    for line in pathlib.Path(prelog).read_text().splitlines():
        try: value = json.loads(line)
        except json.JSONDecodeError: continue
        if isinstance(value, dict) and value.get('type') == 'local_closure_precheck': receipts.append(value)
    if not (len(receipts) == 1 and receipts[0].get('status') == 'passed' and receipts[0].get('started') is False
            and receipts[0].get('erased') is False and isinstance(receipts[0].get('pendingClosures'), bool)):
        raise SystemExit('STAGING_REFUSED: precheck receipt not confirmed:' + version)
    return dict(status='staged_precheck_passed', version=version, tag='v'+version, source=sha, tree=tree, checkout=target,
        launcher=launcher, launcherSha256=fingerprint(launcher, 0o700), launcherMode='0700',
        checkLauncher=check, checkLauncherSha256=fingerprint(check, 0o700),
        log=log, logMode='0600', logSha256=fingerprint(log, 0o600, empty=True),
        precheckLog=prelog, precheckLogSha256=fingerprint(prelog, 0o600), pendingClosures=receipts[0]['pendingClosures'],
        nodeBinarySha256=node_sha, nodeVersion='v24.22.0', schemaMigrations=31, migrationsUnchanged=True,
        started=False, erased=False, migrated=False, noRestart=True, managerChanged=False, runtimeStarted=False, checkpointChanged=False)
releases = [report('1.3.4', sys.argv[5:12]), report('1.4.0', sys.argv[12:19])]
result = dict(releases[1], releases=releases, bothPrechecksPassed=True, rollback134HostedQualified=True,
    rollbackRelease='1.3.4', rollbackLauncher=releases[0]['launcher'], rollbackNodeVersion='v24.22.0', rollback134RuntimeStarted=False,
    priorActiveVersion='1.3.3', priorActivePreserved=True, preservedLauncher=oldlauncher, preservedCheckLauncher=oldcheck,
    priorActiveImmediateRollbackForV2=False)
print(json.dumps(result, separators=(',', ':')))
PY
