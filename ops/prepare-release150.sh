#!/bin/bash
# Preparation seule 1.4.1/1.5.0 depuis la production 1.4.0 ; aucune operation SQL.
# Sources et arbres 1.4.1/1.5.0 publies et qualifies, epingles ci-dessous.
# Usage : bash prepare-release150.sh <SHA_RELEASE141_EXACT> <SHA_RELEASE150_EXACT>
# Aucun start, precheck, redemarrage, changement Manager, migration ou checkpoint.
set +x
set -euo pipefail
trap 'printf "STAGING_REFUSED: shell_check_line_%s\n" "$LINENO" >&2' ERR
umask 077
jm_sha141="${1:?SHA 1.4.1 fusionne exact requis}"
jm_sha150="${2:?SHA 1.5.0 fusionne exact requis}"
[[ $# == 2 ]]
[[ "$jm_sha141" =~ ^[a-f0-9]{40}$ && "$jm_sha150" =~ ^[a-f0-9]{40}$ ]]
jm_expected141=bf022233fcb76ee4db89e0c33c64b9498adb9d50
[[ "$jm_expected141" =~ ^[a-f0-9]{40}$ && "$jm_sha141" == "$jm_expected141" ]]
jm_expected150=abca467c45c9385371a9095ab359e78c99140370
[[ "$jm_expected150" =~ ^[a-f0-9]{40}$ && "$jm_sha150" == "$jm_expected150" ]]
[[ "$jm_sha141" != "$jm_sha150" ]]
jm_tree141=a2f29930fe8ead853db6b6e8b76b613891ae4a04
jm_tree150=3238dd2224ea768e3ab2f8bcb7594cc3890dd5e4
[[ "$jm_tree141" =~ ^[a-f0-9]{40}$ && "$jm_tree150" =~ ^[a-f0-9]{40}$ ]]
jm_old=/srv/customer/jessiemessage-operator/production-140-56d45950
jm_oldsha=56d4595059df9292fc54ba4d4e948eeb793bae96
jm_oldtree=8129e76c9817e79c062a4437eadee4b7ce4d90a1
jm_private=/srv/customer/jessiemessage-private
jm_node=$jm_private/runtime-node-v24.22.0/bin/node
jm_node_sha=67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c
jm_oldlauncher=$jm_private/start-primary-release140-56d45950.sh
jm_oldcheck=$jm_private/check-primary-release140-56d45950.sh
jm_target141=/srv/customer/jessiemessage-operator/production-141-${jm_sha141:0:8}
jm_launcher141=$jm_private/start-primary-release141-${jm_sha141:0:8}.sh
jm_check141=$jm_private/check-primary-release141-${jm_sha141:0:8}.sh
jm_log141=$jm_private/jm141-node2422.log
jm_prelog141=$jm_private/jm141-preflight-${jm_sha141:0:8}.log
jm_target150=/srv/customer/jessiemessage-operator/production-150-${jm_sha150:0:8}
jm_launcher150=$jm_private/start-primary-release150-${jm_sha150:0:8}.sh
jm_check150=$jm_private/check-primary-release150-${jm_sha150:0:8}.sh
jm_log150=$jm_private/jm150-node2422.log
jm_prelog150=$jm_private/jm150-preflight-${jm_sha150:0:8}.log
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
  [[ $(sha256sum "$jm_oldlauncher" | cut -d' ' -f1) == 45f99cac50dc057f9be61f7db420dd7e64f92f76f67a8eaade1463780edff3b0 ]]
  [[ $(sha256sum "$jm_oldcheck" | cut -d' ' -f1) == 38e655a8e1e2be696707650aabc5e26c11ca9f7b1ac74d7b17ff23f6016deb4c ]]
  [[ -f "$jm_node" && ! -L "$jm_node" ]]
  [[ $(stat -c '%a:%h:%u' "$jm_node") == "700:1:$(id -u)" ]]
  [[ $(sha256sum "$jm_node" | cut -d' ' -f1) == "$jm_node_sha" ]]
  [[ $("$jm_node" --version) == v24.22.0 ]]
}
jm_old_pins
# Refuser toute repetition aveugle, y compris un staging partiel d'une cible.
for jm_path in "$jm_target141" "$jm_launcher141" "$jm_check141" "$jm_log141" "$jm_prelog141" "$jm_target150" "$jm_launcher150" "$jm_check150" "$jm_log150" "$jm_prelog150"; do
  [[ ! -e "$jm_path" && ! -L "$jm_path" ]]
done
jm_git "$jm_old" fetch --no-tags --no-recurse-submodules origin \
  refs/heads/main:refs/remotes/origin/main refs/tags/v1.4.1:refs/tags/v1.4.1 refs/tags/v1.5.0:refs/tags/v1.5.0 >/dev/null 2>&1
[[ $(jm_git "$jm_old" rev-parse 'refs/tags/v1.4.1^{commit}') == "$jm_sha141" ]]
[[ $(jm_git "$jm_old" rev-parse 'refs/tags/v1.5.0^{commit}') == "$jm_sha150" ]]
jm_git "$jm_old" cat-file -e "$jm_sha141^{commit}"
jm_git "$jm_old" cat-file -e "$jm_sha150^{commit}"
jm_git "$jm_old" merge-base --is-ancestor "$jm_oldsha" "$jm_sha141"
jm_git "$jm_old" merge-base --is-ancestor "$jm_sha141" "$jm_sha150"
jm_git "$jm_old" merge-base --is-ancestor "$jm_sha150" refs/remotes/origin/main
[[ $(jm_git "$jm_old" rev-parse "$jm_sha141^{tree}") == "$jm_tree141" ]]
[[ $(jm_git "$jm_old" rev-parse "$jm_sha150^{tree}") == "$jm_tree150" ]]
jm_git "$jm_old" worktree add --detach "$jm_target141" "$jm_sha141" >/dev/null 2>&1
jm_git "$jm_old" worktree add --detach "$jm_target150" "$jm_sha150" >/dev/null 2>&1
jm_source "$jm_target141" "$jm_sha141" "$jm_tree141"
jm_source "$jm_target150" "$jm_sha150" "$jm_tree150"
python3 - "$jm_old" "$jm_oldlauncher" "$jm_oldcheck" "$jm_oldsha" "$jm_oldtree" "$jm_sha141" "$jm_tree141" "$jm_target141" "$jm_launcher141" "$jm_check141" "$jm_log141" "$jm_prelog141" "$jm_sha150" "$jm_tree150" "$jm_target150" "$jm_launcher150" "$jm_check150" "$jm_log150" "$jm_prelog150" <<'PY'
import hashlib, json, os, pathlib, stat, sys
old, original, original_check = map(pathlib.Path, sys.argv[1:4])
oldsha, oldtree = sys.argv[4:6]
def release(version, values):
    sha, tree, target, normal, check, log, prelog = values
    return dict(version=version, sha=sha, tree=tree, target=pathlib.Path(target),
                normal=pathlib.Path(normal), check=pathlib.Path(check), log=pathlib.Path(log), prelog=pathlib.Path(prelog))
releases = [release('1.4.1', sys.argv[6:13]), release('1.5.0', sys.argv[13:20])]
def require(ok, label):
    if not ok: raise SystemExit('STAGING_REFUSED: ' + label)
def regular(path, mode):
    value = path.lstat()
    require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid() and value.st_nlink == 1
            and stat.S_IMODE(value.st_mode) == mode, 'file_metadata:' + path.name)
regular(original, 0o700)
regular(original_check, 0o700)
require(hashlib.sha256(original.read_bytes()).hexdigest() == '45f99cac50dc057f9be61f7db420dd7e64f92f76f67a8eaade1463780edff3b0', 'original_launcher_hash')
require(hashlib.sha256(original_check.read_bytes()).hexdigest() == '38e655a8e1e2be696707650aabc5e26c11ca9f7b1ac74d7b17ff23f6016deb4c', 'original_check_hash')
locks = []
for root, version in [(old, '1.4.0')] + [(value['target'], value['version']) for value in releases]:
    require(json.loads((root / 'package.json').read_text())['version'] == version, 'package_version:' + version)
    lock = json.loads((root / 'package-lock.json').read_text())
    require(lock['version'] == version and lock['packages']['']['version'] == version, 'lock_versions:' + version)
    del lock['version']; del lock['packages']['']['version']
    locks.append(lock)
require(locks[0] == locks[1] == locks[2], 'locked_dependencies')
def migrations(root, expected):
    directory = root / 'db' / 'migrations'
    require(directory.is_dir() and not directory.is_symlink(), 'migration_directory')
    files = sorted(directory.iterdir())
    require(len(files) == expected and all(path.name.endswith('.sql') and path.is_file()
            and not path.is_symlink() for path in files), 'migration_inventory')
    return [(path.name, hashlib.sha256(path.read_bytes()).hexdigest()) for path in files]
baseline = migrations(old, 31)
plan141 = migrations(releases[0]['target'], 32)
plan150 = migrations(releases[1]['target'], 32)
require(plan141 == plan150 and plan141[:31] == baseline
        and plan141[31][0] == '0032_announcements.sql', 'migration32_append_only')
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
            ('directory', str(old), str(value['target']), 2), ('log', 'jm140-node2422.log', value['log'].name, 1)):
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
jm_source "$jm_target141" "$jm_sha141" "$jm_tree141"
jm_source "$jm_target150" "$jm_sha150" "$jm_tree150"
for jm_script in "$jm_launcher141" "$jm_check141" "$jm_launcher150" "$jm_check150"; do bash -n "$jm_script"; done
# Les controles CHECK attendent le schema32 : ne pas les executer au staging.
python3 - "$jm_node" "$jm_node_sha" "$jm_oldlauncher" "$jm_oldcheck" "$jm_sha141" "$jm_tree141" "$jm_target141" "$jm_launcher141" "$jm_check141" "$jm_log141" "$jm_prelog141" "$jm_sha150" "$jm_tree150" "$jm_target150" "$jm_launcher150" "$jm_check150" "$jm_log150" "$jm_prelog150" <<'PY'
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
if fingerprint(oldlauncher, 0o700) != '45f99cac50dc057f9be61f7db420dd7e64f92f76f67a8eaade1463780edff3b0':
    raise SystemExit('STAGING_REFUSED: final_original_launcher_hash')
if fingerprint(oldcheck, 0o700) != '38e655a8e1e2be696707650aabc5e26c11ca9f7b1ac74d7b17ff23f6016deb4c':
    raise SystemExit('STAGING_REFUSED: final_original_check_hash')
def report(version, values):
    sha, tree, target, launcher, check, log, prelog = values
    return dict(version=version, tag='v'+version, source=sha, tree=tree, checkout=target,
        launcher=launcher, launcherSha256=fingerprint(launcher, 0o700), launcherMode='0700',
        checkLauncher=check, checkLauncherSha256=fingerprint(check, 0o700),
        log=log, logMode='0600', logSha256=fingerprint(log, 0o600, empty=True),
        precheckLog=prelog, precheckLogSha256=fingerprint(prelog, 0o600, empty=True),
        started=False, migrated=False, precheckPassed=False)
releases = [report('1.4.1', sys.argv[5:12]), report('1.5.0', sys.argv[12:19])]
result = dict(releases[1], status='staged_awaiting_schema32', releases=releases,
    nodeBinarySha256=node_sha, nodeVersion='v24.22.0', baselineMigrationFiles=31,
    schemaMigrationsExpected=32, migrationsAppendOnly=True, sqlStatusChecked=False,
    started=False, migrated=False, precheckPassed=False, noRestart=True,
    managerChanged=False, runtimeStarted=False, checkpointChanged=False,
    rollback141Prepared=True, rollback141HostedQualified=False, rollback141RuntimeStarted=False,
    rollbackRelease='1.4.1', rollbackLauncher=releases[0]['launcher'], rollbackNodeVersion='v24.22.0',
    expectedActiveServiceVersion='1.4.0', priorActivePreserved=True,
    preservedLauncher=oldlauncher, preservedCheckLauncher=oldcheck)
print(json.dumps(result, separators=(',', ':')))
PY
