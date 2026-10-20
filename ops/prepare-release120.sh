#!/bin/bash
# Preparation epinglee des releases 1.1.1 et 1.2.0.
# Les quatre pins de livraison ci-dessous sont fixes.
# Usage ensuite : bash prepare-release120.sh <SHA_111> <SHA_120>
# Prepare seulement deux worktrees et leurs lanceurs ; aucun precheck, SQL ou Run.
set +x
set -euo pipefail
trap 'printf "STAGING_REFUSED: shell_check_line_%s\n" "$LINENO" >&2' ERR
umask 077
[[ $# == 2 ]]
jm_sha111=$1
jm_sha120=$2
jm_expected111=cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a
jm_tree111=94b2fec5383fd948df7605b63f65a4e23078c2a1
jm_expected120=763b632185ce13eb875110c9107687b2d278ff67
jm_tree120=c7dce7bcdb99b298ffc43c9e31dd22ee87453926
for jm_pin in "$jm_sha111" "$jm_sha120" "$jm_expected111" "$jm_tree111" "$jm_expected120" "$jm_tree120"; do
  [[ "$jm_pin" =~ ^[a-f0-9]{40}$ ]]
done
[[ "$jm_sha111" == "$jm_expected111" && "$jm_sha120" == "$jm_expected120" ]]
[[ "$jm_sha111" != "$jm_sha120" && "$jm_tree111" != "$jm_tree120" ]]
jm_old=/srv/customer/jessiemessage-operator/production-110-84669ed5
jm_oldsha=84669ed570b59b10a1a94a164f24f0e60e6cb5a7
jm_oldtree=0201cdbd1932fd9104c04a91d63561010e8ae0c2
jm_private=/srv/customer/jessiemessage-private
jm_node=$jm_private/runtime-node-v24.22.0/bin/node
jm_oldlauncher=$jm_private/start-primary-release110-84669ed5.sh
jm_oldlauncher_sha=4d28485da98fb33acdf0f50e2f420a43893f4c0c5495c068b6a6854de9e1cc8b
jm_node_sha=67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c
jm_target111=/srv/customer/jessiemessage-operator/production-111-${jm_sha111:0:8}
jm_target120=/srv/customer/jessiemessage-operator/production-120-${jm_sha120:0:8}
jm_launcher111=$jm_private/start-primary-release111-${jm_sha111:0:8}.sh
jm_launcher120=$jm_private/start-primary-release120-${jm_sha120:0:8}.sh
jm_check111=$jm_private/check-primary-release111-${jm_sha111:0:8}.sh
jm_check120=$jm_private/check-primary-release120-${jm_sha120:0:8}.sh
jm_log111=$jm_private/jm111-node2422.log
jm_log120=$jm_private/jm120-node2422.log
jm_prelog111=$jm_private/jm111-preflight-${jm_sha111:0:8}.log
jm_prelog120=$jm_private/jm120-preflight-${jm_sha120:0:8}.log
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
jm_source "$jm_old" "$jm_oldsha" "$jm_oldtree"
[[ $(sha256sum "$jm_oldlauncher" | cut -d' ' -f1) == "$jm_oldlauncher_sha" ]]
[[ $(sha256sum "$jm_node" | cut -d' ' -f1) == "$jm_node_sha" ]]
[[ $("$jm_node" --version) == v24.22.0 ]]
# Tout emplacement existant impose une inspection privee, meme apres interruption.
for jm_path in "$jm_target111" "$jm_target120" "$jm_launcher111" "$jm_launcher120" "$jm_check111" "$jm_check120" "$jm_log111" "$jm_log120" "$jm_prelog111" "$jm_prelog120"; do
  [[ ! -e "$jm_path" && ! -L "$jm_path" ]]
done
# Les pins proviennent des publications et CI relues par root avant livraison.
# Le serveur confirme les objets Git, tags exacts et leur presence dans main.
jm_git "$jm_old" fetch --no-tags --no-recurse-submodules origin \
  refs/heads/main:refs/remotes/origin/main \
  refs/tags/v1.1.1:refs/tags/v1.1.1 \
  refs/tags/v1.2.0:refs/tags/v1.2.0 >/dev/null 2>&1
[[ $(jm_git "$jm_old" rev-parse 'refs/tags/v1.1.1^{commit}') == "$jm_sha111" ]]
[[ $(jm_git "$jm_old" rev-parse 'refs/tags/v1.2.0^{commit}') == "$jm_sha120" ]]
for jm_sha in "$jm_sha111" "$jm_sha120"; do
  jm_git "$jm_old" cat-file -e "$jm_sha^{commit}" >/dev/null 2>&1
  jm_git "$jm_old" merge-base --is-ancestor "$jm_sha" refs/remotes/origin/main
done
[[ $(jm_git "$jm_old" rev-parse "$jm_sha111^{tree}") == "$jm_tree111" ]]
[[ $(jm_git "$jm_old" rev-parse "$jm_sha120^{tree}") == "$jm_tree120" ]]
jm_git "$jm_old" merge-base --is-ancestor "$jm_oldsha" "$jm_sha111"
jm_git "$jm_old" merge-base --is-ancestor "$jm_sha111" "$jm_sha120"
jm_git "$jm_old" worktree add --detach "$jm_target111" "$jm_sha111" >/dev/null 2>&1
jm_git "$jm_old" worktree add --detach "$jm_target120" "$jm_sha120" >/dev/null 2>&1
jm_source "$jm_target111" "$jm_sha111" "$jm_tree111"
jm_source "$jm_target120" "$jm_sha120" "$jm_tree120"
python3 - "$jm_old" "$jm_oldlauncher" "$jm_oldsha" "$jm_oldtree" \
  "$jm_target111" "$jm_sha111" "$jm_tree111" "$jm_launcher111" "$jm_check111" "$jm_log111" "$jm_prelog111" \
  "$jm_target120" "$jm_sha120" "$jm_tree120" "$jm_launcher120" "$jm_check120" "$jm_log120" "$jm_prelog120" <<'PY'
import hashlib, json, os, pathlib, stat, sys

def require(ok, label):
    if not ok:
        raise SystemExit('STAGING_REFUSED: ' + label)

def regular(path, mode):
    metadata = path.lstat()
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid()
            and metadata.st_nlink == 1 and stat.S_IMODE(metadata.st_mode) == mode,
            'file_metadata:' + path.name)

def lock_without_root_versions(root, version):
    require(json.loads((root / 'package.json').read_text())['version'] == version,
            'package_version:' + version)
    lock = json.loads((root / 'package-lock.json').read_text())
    require(lock['version'] == version and lock['packages']['']['version'] == version,
            'lock_versions:' + version)
    del lock['version']
    del lock['packages']['']['version']
    return lock

try:
    old, original = map(pathlib.Path, sys.argv[1:3])
    oldsha, oldtree = sys.argv[3:5]
    regular(original, 0o700)
    require(hashlib.sha256(original.read_bytes()).hexdigest()
            == '4d28485da98fb33acdf0f50e2f420a43893f4c0c5495c068b6a6854de9e1cc8b',
            'original_launcher_hash')
    baseline_lock = lock_without_root_versions(old, '1.1.0')
    deps = (old / 'node_modules').resolve(strict=True)
    require(deps.is_dir() and deps.stat().st_uid == os.getuid(), 'old_dependencies_directory')
    template = original.read_text()
    require(template.count('start-local-closures') == 1
            and template.count('check-local-closures') == 0, 'launcher_command')
    plans = []
    # Tout valider pour les deux releases avant de creer un lien ou un lanceur.
    for version, offset in (('1.1.1', 5), ('1.2.0', 12)):
        target_arg, sha, tree, normal_arg, check_arg, log_arg, prelog_arg = sys.argv[offset:offset + 7]
        target, normal, check, log, prelog = map(pathlib.Path,
                                               (target_arg, normal_arg, check_arg, log_arg, prelog_arg))
        require(lock_without_root_versions(target, version) == baseline_lock,
                'locked_dependencies:' + version)
        link = target / 'node_modules'
        if link.is_symlink():
            require(link.lstat().st_uid == os.getuid() and link.resolve(strict=True) == deps,
                    'existing_dependencies_link:' + version)
        else:
            require(not link.exists(), 'unexpected_dependencies_directory:' + version)
        for path in (normal, check, log, prelog):
            require(not path.exists() and not path.is_symlink(), 'existing_output:' + path.name)
        text = template
        for label, before, after, count in (
                ('commit', oldsha, sha, 2), ('tree', oldtree, tree, 2),
                ('directory', str(old), str(target), 2), ('log', 'jm110-node2422.log', log.name, 1)):
            require(text.count(before) == count, 'original_count:' + label)
            text = text.replace(before, after)
            require(before not in text and text.count(after) == count, 'replacement_count:' + label)
        precheck = text.replace('start-local-closures', 'check-local-closures')
        require(precheck.count(log.name) == 1, 'precheck_log_count')
        precheck = precheck.replace(log.name, prelog.name)
        require('start-local-closures' not in precheck
                and precheck.count('check-local-closures') == 1, 'precheck_command')
        plans.append((link, normal, check, log, prelog, text, precheck))
    for link, normal, check, log, prelog, text, precheck in plans:
        if not link.is_symlink():
            link.symlink_to(deps, target_is_directory=True)
        for path, content, mode in ((normal, text.encode(), 0o700), (check, precheck.encode(), 0o700),
                                    (log, b'', 0o600), (prelog, b'', 0o600)):
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
            with os.fdopen(descriptor, 'wb') as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            regular(path, mode)
            require(path.read_bytes() == content, 'written_file:' + path.name)
except (OSError, ValueError, KeyError, TypeError):
    raise SystemExit('STAGING_REFUSED: local_files_check') from None
PY
jm_source "$jm_old" "$jm_oldsha" "$jm_oldtree"
jm_source "$jm_target111" "$jm_sha111" "$jm_tree111"
jm_source "$jm_target120" "$jm_sha120" "$jm_tree120"
for jm_script in "$jm_launcher111" "$jm_check111" "$jm_launcher120" "$jm_check120"; do
  bash -n "$jm_script"
done
# NE PAS executer les lanceurs de precontrole : schema 0031 pas encore heberge.
# Aucun appel de service, migrateur, Manager ou modification du checkpoint.
python3 - "$jm_node" "$jm_node_sha" "$jm_oldlauncher" \
  "$jm_target111" "$jm_sha111" "$jm_tree111" "$jm_launcher111" "$jm_check111" "$jm_log111" "$jm_prelog111" \
  "$jm_target120" "$jm_sha120" "$jm_tree120" "$jm_launcher120" "$jm_check120" "$jm_log120" "$jm_prelog120" <<'PY'
import hashlib, json, os, pathlib, stat, sys

def fingerprint(path, mode, empty=False):
    path = pathlib.Path(path)
    metadata = path.lstat()
    if not (stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid()
            and metadata.st_nlink == 1 and stat.S_IMODE(metadata.st_mode) == mode
            and (not empty or metadata.st_size == 0)):
        raise SystemExit('STAGING_REFUSED: final_file_metadata:' + path.name)
    return hashlib.sha256(path.read_bytes()).hexdigest()

try:
    node, expected_node, original = sys.argv[1:4]
    actual_node = hashlib.sha256(pathlib.Path(node).read_bytes()).hexdigest()
    if actual_node != expected_node:
        raise SystemExit('STAGING_REFUSED: final_node_hash')
    if fingerprint(original, 0o700) != '4d28485da98fb33acdf0f50e2f420a43893f4c0c5495c068b6a6854de9e1cc8b':
        raise SystemExit('STAGING_REFUSED: final_original_launcher_hash')
    releases = []
    for version, offset in (('1.1.1', 4), ('1.2.0', 11)):
        target, sha, tree, normal, check, log, prelog = sys.argv[offset:offset + 7]
        releases.append(dict(version=version, tag='v' + version, source=sha, tree=tree, checkout=target,
            launcher=normal, launcherSha256=fingerprint(normal, 0o700), launcherMode='0700',
            checkLauncher=check, checkLauncherSha256=fingerprint(check, 0o700),
            log=log, logMode='0600', logSha256=fingerprint(log, 0o600, empty=True),
            precheckLog=prelog, precheckLogSha256=fingerprint(prelog, 0o600, empty=True),
            started=False, migrated=False, precheckPassed=False))
    print(json.dumps(dict(status='staged_awaiting_schema31', releases=releases,
        nodeBinarySha256=actual_node, nodeVersion='v24.22.0', started=False, migrated=False,
        precheckPassed=False, noRestart=True, managerChanged=False, runtimeStarted=False,
        checkpointChanged=False, rollback111Prepared=True, rollback111HostedQualified=False,
        expectedActiveServiceVersion='1.1.0', preservedLauncher=original), separators=(',', ':')))
except (OSError, ValueError, KeyError, TypeError):
    raise SystemExit('STAGING_REFUSED: final_files_check') from None
PY
