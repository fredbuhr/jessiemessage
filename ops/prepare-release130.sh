#!/bin/bash
# Preparation 1.3.0 : epingler commit/arbre apres CI, fusion et publication.
# Usage sur SSH : bash prepare-release130.sh <SHA_RELEASE130_EXACT_40_HEX>
# Staging + check-local-closures uniquement. Aucun changement Manager ni Run.
# Repli conserve : production 1.2.0, schema 31 identique, Node prive 24.22.0.
set +x
set -euo pipefail
trap 'printf "STAGING_REFUSED: shell_check_line_%s\n" "$LINENO" >&2' ERR
umask 077
jm_sha="${1:?SHA fusionné exact requis}"
[[ "$jm_sha" =~ ^[a-f0-9]{40}$ ]]
[[ $# == 1 ]]
[[ "$jm_sha" == afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b ]]
jm_old=/srv/customer/jessiemessage-operator/production-120-763b6321
jm_oldsha=763b632185ce13eb875110c9107687b2d278ff67
jm_oldtree=c7dce7bcdb99b298ffc43c9e31dd22ee87453926
jm_tree=37b3b2e9358972c95581fc0bcf16896e4074d5f9
[[ "$jm_tree" =~ ^[a-f0-9]{40}$ ]]
jm_private=/srv/customer/jessiemessage-private
jm_node=$jm_private/runtime-node-v24.22.0/bin/node
jm_oldlauncher=$jm_private/start-primary-release120-763b6321.sh
jm_target=/srv/customer/jessiemessage-operator/production-130-${jm_sha:0:8}
jm_launcher=$jm_private/start-primary-release130-${jm_sha:0:8}.sh
jm_check=$jm_private/check-primary-release130-${jm_sha:0:8}.sh
jm_log=$jm_private/jm130-node2422.log
jm_prelog=$jm_private/jm130-preflight-${jm_sha:0:8}.log
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
[[ $(sha256sum "$jm_oldlauncher" | cut -d' ' -f1) == f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f ]]
# Empreinte réelle fournie par le diagnostic utilisateur, 64 caractères.
jm_node_sha=67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c
[[ $(sha256sum "$jm_node" | cut -d' ' -f1) == "$jm_node_sha" ]]
[[ $("$jm_node" --version) == v24.22.0 ]]
# Refuser une répétition aveugle après interruption : inspecter l'état durable.
for jm_path in "$jm_target" "$jm_launcher" "$jm_check" "$jm_log" "$jm_prelog"; do
  [[ ! -e "$jm_path" && ! -L "$jm_path" ]]
done
jm_git "$jm_old" fetch --no-tags --no-recurse-submodules origin \
  refs/heads/main:refs/remotes/origin/main refs/tags/v1.3.0:refs/tags/v1.3.0 >/dev/null 2>&1
[[ $(jm_git "$jm_old" rev-parse 'refs/tags/v1.3.0^{commit}') == "$jm_sha" ]]
jm_git "$jm_old" cat-file -e "$jm_sha^{commit}"
jm_git "$jm_old" merge-base --is-ancestor "$jm_oldsha" "$jm_sha"
jm_git "$jm_old" merge-base --is-ancestor "$jm_sha" refs/remotes/origin/main
[[ $(jm_git "$jm_old" rev-parse "$jm_sha^{tree}") == "$jm_tree" ]]
jm_git "$jm_old" worktree add --detach "$jm_target" "$jm_sha" >/dev/null 2>&1
jm_source "$jm_target" "$jm_sha" "$jm_tree"
python3 - "$jm_old" "$jm_target" "$jm_oldlauncher" "$jm_launcher" "$jm_check" "$jm_log" "$jm_prelog" "$jm_oldsha" "$jm_sha" "$jm_oldtree" "$jm_tree" <<'PY'
import hashlib, json, os, pathlib, stat, sys
old, target, original, normal, check, log, prelog = map(pathlib.Path, sys.argv[1:8])
oldsha, sha, oldtree, tree = sys.argv[8:]
def require(ok, check):
    if not ok: raise SystemExit('STAGING_REFUSED: ' + check)
def regular(path, mode):
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid() and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == mode, 'file_metadata:' + path.name)
regular(original, 0o700)
require(hashlib.sha256(original.read_bytes()).hexdigest() == 'f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f', 'original_launcher_hash')
locks = []
for root, version in ((old, '1.2.0'), (target, '1.3.0')):
    require(json.loads((root / 'package.json').read_text())['version'] == version, 'package_version:' + version)
    lock = json.loads((root / 'package-lock.json').read_text())
    require(lock['version'] == version and lock['packages']['']['version'] == version, 'lock_versions:' + version)
    del lock['version']; del lock['packages']['']['version']
    locks.append(lock)
require(locks[0] == locks[1], 'locked_dependencies')  # Seules les versions racine sont ignorees.
def migrations(root):
    directory = root / 'db' / 'migrations'
    require(directory.is_dir() and not directory.is_symlink(), 'migration_directory')
    files = sorted(directory.iterdir())
    require(len(files) == 31 and all(path.name.endswith('.sql') and path.is_file()
            and not path.is_symlink() for path in files), 'schema31_files')
    return [(path.name, hashlib.sha256(path.read_bytes()).hexdigest()) for path in files]
require(migrations(old) == migrations(target), 'migrations_changed')
deps = (old / 'node_modules').resolve(strict=True)
require(deps.is_dir() and deps.stat().st_uid == os.getuid(), 'old_dependencies_directory')
link = target / 'node_modules'
if link.is_symlink():
    require(link.lstat().st_uid == os.getuid() and link.resolve(strict=True) == deps, 'existing_dependencies_link')
else:
    require(not link.exists(), 'unexpected_dependencies_directory')
text = original.read_text()
require(text.count('start-local-closures') == 1 and text.count('check-local-closures') == 0, 'launcher_command')
for label, before, after, count in (('commit', oldsha, sha, 2), ('tree', oldtree, tree, 2), ('directory', str(old), str(target), 2), ('log', 'jm120-node2422.log', log.name, 1)):
    require(text.count(before) == count, 'original_count:' + label)
    text = text.replace(before, after)
    require(before not in text and text.count(after) == count, 'replacement_count:' + label)
precheck = text.replace('start-local-closures', 'check-local-closures')
require(precheck.count(log.name) == 1, 'precheck_log_count')
precheck = precheck.replace(log.name, prelog.name)
require('start-local-closures' not in precheck and precheck.count('check-local-closures') == 1, 'precheck_command')
if not link.is_symlink():
    link.symlink_to(deps, target_is_directory=True)
for path, content, mode in ((normal, text.encode(), 0o700), (check, precheck.encode(), 0o700), (log, b'', 0o600), (prelog, b'', 0o600)):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as output:
        output.write(content); output.flush(); os.fsync(output.fileno())
    regular(path, mode)
    require(path.read_bytes() == content, 'written_file:' + path.name)
PY
jm_source "$jm_old" "$jm_oldsha" "$jm_oldtree"
jm_source "$jm_target" "$jm_sha" "$jm_tree"
bash -n "$jm_launcher"
bash -n "$jm_check"
# Seul le lanceur de précontrôle est exécuté ; le journal normal reste vide.
timeout --signal=TERM --kill-after=5s 60s bash "$jm_check" >>"$jm_prelog" 2>&1
jm_source "$jm_target" "$jm_sha" "$jm_tree"
jm_source "$jm_old" "$jm_oldsha" "$jm_oldtree"
[[ $(sha256sum "$jm_oldlauncher" | cut -d' ' -f1) == f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f ]]
python3 - "$jm_sha" "$jm_tree" "$jm_target" "$jm_launcher" "$jm_log" "$jm_prelog" "$jm_node" "$jm_node_sha" "$jm_check" <<'PY'
import hashlib, json, os, pathlib, stat, sys
sha, tree, target, launcher, log, prelog, node, node_sha, check = sys.argv[1:]
def fingerprint(path, mode, empty=False):
    path = pathlib.Path(path)
    metadata = path.lstat()
    if not (stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid()
            and metadata.st_nlink == 1 and stat.S_IMODE(metadata.st_mode) == mode
            and (not empty or metadata.st_size == 0)):
        raise SystemExit('STAGING_REFUSED: final_file_metadata:' + path.name)
    return hashlib.sha256(path.read_bytes()).hexdigest()
if hashlib.sha256(pathlib.Path(node).read_bytes()).hexdigest() != node_sha:
    raise SystemExit('STAGING_REFUSED: final_node_hash')
normal_log = pathlib.Path(log)
if normal_log.is_symlink() or not normal_log.is_file() or normal_log.stat().st_size != 0:
    raise SystemExit('STAGING_REFUSED: normal_runtime_log_not_empty_or_regular')
receipts = []
for line in pathlib.Path(prelog).read_text().splitlines():
    try: value = json.loads(line)
    except json.JSONDecodeError: continue
    if isinstance(value, dict) and value.get('type') == 'local_closure_precheck': receipts.append(value)
if not (len(receipts) == 1 and receipts[0].get('status') == 'passed' and receipts[0].get('started') is False and receipts[0].get('erased') is False and isinstance(receipts[0].get('pendingClosures'), bool)):
    raise SystemExit('STAGING_REFUSED: precheck receipt not confirmed; inspect private log')
print(json.dumps(dict(status='staged_precheck_passed', source=sha, tree=tree, version='1.3.0', checkout=target, launcher=launcher,
    nodeBinarySha256=node_sha, nodeVersion='v24.22.0',
    launcherSha256=fingerprint(launcher, 0o700), launcherMode='0700', checkLauncher=check, checkLauncherSha256=fingerprint(check, 0o700),
    log=log, logMode='0600', logSha256=fingerprint(log, 0o600, empty=True),
    precheckLog=prelog, precheckLogSha256=fingerprint(prelog, 0o600),
    pendingClosures=receipts[0].get('pendingClosures'), schemaMigrations=31, migrationsUnchanged=True,
    started=False, erased=False, migrated=False, noRestart=True, managerChanged=False, runtimeStarted=False, checkpointChanged=False,
    rollbackRelease='1.2.0', rollbackLauncher='/srv/customer/jessiemessage-private/start-primary-release120-763b6321.sh', rollbackNodeVersion='v24.22.0'), separators=(',', ':')))
PY
