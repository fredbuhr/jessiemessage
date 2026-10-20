#!/bin/bash
# PROPOSITION LOCALE : exécuter seulement après CI/merge/publication autorisés.
# Usage sur SSH : bash prepare-infomaniak-release100.sh <SHA_MAIN_EXACT_40_HEX>
# Staging + check-local-closures uniquement. Aucun changement Manager ni Run.
set +x
set -euo pipefail
umask 077
jm_sha="${1:?SHA fusionné exact requis}"
[[ "$jm_sha" =~ ^[a-f0-9]{40}$ ]]
[[ $# == 1 ]]
jm_old=/srv/customer/jessiemessage-operator/production-086-c61d1eec
jm_oldsha=c61d1eecfefe786254416652877ba82d30cf4c90
jm_oldtree=78c8e46224503b0691b381bf07c5aefd51ca5c7f
jm_tree=485cade0aeeee41cb4c34f913cd98f6078c4636b
jm_private=/srv/customer/jessiemessage-private
jm_node=$jm_private/runtime-node-v24.22.0/bin/node
jm_oldlauncher=$jm_private/start-primary-node2422-c61d1eec.sh
jm_target=/srv/customer/jessiemessage-operator/production-100-${jm_sha:0:8}
jm_launcher=$jm_private/start-primary-release100-${jm_sha:0:8}.sh
jm_check=$jm_private/check-primary-release100-${jm_sha:0:8}.sh
jm_log=$jm_private/jm100-node2422.log
jm_prelog=$jm_private/jm100-preflight-${jm_sha:0:8}.log
unset NODE_OPTIONS NODE_PATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
jm_git() { /usr/bin/git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$1" "${@:2}"; }
jm_source() {
  [[ ! -L "$1" && $(jm_git "$1" rev-parse HEAD) == "$2" ]]
  [[ $(jm_git "$1" rev-parse 'HEAD^{tree}') == "$3" ]]
  [[ -z $(jm_git "$1" status --porcelain --untracked-files=normal) ]]
}
jm_source "$jm_old" "$jm_oldsha" "$jm_oldtree"
[[ $(sha256sum "$jm_oldlauncher" | cut -d' ' -f1) == e54392621a7f63f7665f44c191783d467ccb214630e65449fb4ae57138cc9881 ]]
# La transcription documentaire du hash Node avait 65 caractères. La référence
# effective reste celle du lanceur dont le SHA-256 exact est vérifié ci-dessus.
jm_node_sha=$(python3 - "$jm_oldlauncher" <<'PY'
import pathlib, re, sys
pins = set(re.findall(r'\b[a-f0-9]{64}\b', pathlib.Path(sys.argv[1]).read_text()))
if len(pins) != 1: raise SystemExit('STAGING_REFUSED: original Node pin is ambiguous')
print(pins.pop())
PY
)
[[ $(sha256sum "$jm_node" | cut -d' ' -f1) == "$jm_node_sha" ]]
[[ $("$jm_node" --version) == v24.22.0 ]]
# Refuser une répétition aveugle après interruption : inspecter l'état durable.
for jm_path in "$jm_target" "$jm_launcher" "$jm_check" "$jm_log" "$jm_prelog"; do
  [[ ! -e "$jm_path" && ! -L "$jm_path" ]]
done
jm_git "$jm_old" fetch --no-tags --no-recurse-submodules origin main >/dev/null 2>&1
jm_git "$jm_old" cat-file -e "$jm_sha^{commit}"
jm_git "$jm_old" merge-base --is-ancestor "$jm_sha" FETCH_HEAD
[[ $(jm_git "$jm_old" rev-parse "$jm_sha^{tree}") == "$jm_tree" ]]
jm_git "$jm_old" worktree add --detach "$jm_target" "$jm_sha" >/dev/null 2>&1
jm_source "$jm_target" "$jm_sha" "$jm_tree"
python3 - "$jm_old" "$jm_target" "$jm_oldlauncher" "$jm_launcher" "$jm_check" "$jm_log" "$jm_prelog" "$jm_oldsha" "$jm_sha" "$jm_oldtree" "$jm_tree" <<'PY'
import hashlib, json, os, pathlib, stat, sys
old, target, original, normal, check, log, prelog = map(pathlib.Path, sys.argv[1:8])
oldsha, sha, oldtree, tree = sys.argv[8:]
def require(ok):
    if not ok: raise SystemExit('STAGING_REFUSED: verification mismatch; no private content printed')
def regular(path, mode):
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid() and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == mode)
regular(original, 0o700)
require(hashlib.sha256(original.read_bytes()).hexdigest() == 'e54392621a7f63f7665f44c191783d467ccb214630e65449fb4ae57138cc9881')
locks = []
for root, version in ((old, '0.86.0'), (target, '1.0.0')):
    require(json.loads((root / 'package.json').read_text())['version'] == version)
    lock = json.loads((root / 'package-lock.json').read_text())
    require(lock['version'] == version and lock['packages']['']['version'] == version)
    del lock['version']; del lock['packages']['']['version']
    locks.append(lock)
require(locks[0] == locks[1])  # Seulement les deux versions racine sont ignorées.
deps = (old / 'node_modules').resolve(strict=True)
require(deps.is_dir())
(target / 'node_modules').symlink_to(deps, target_is_directory=True)
text = original.read_text()
require(text.count('start-local-closures') == 1 and text.count('check-local-closures') == 0)
for before, after, count in ((oldsha, sha, 1), (oldtree, tree, 2), (str(old), str(target), 2), ('jm086-node2422.log', log.name, 1)):
    require(text.count(before) == count)
    text = text.replace(before, after)
precheck = text.replace('start-local-closures', 'check-local-closures')
require(precheck.count(log.name) == 1)
precheck = precheck.replace(log.name, prelog.name)
require('start-local-closures' not in precheck and precheck.count('check-local-closures') == 1)
for path, content, mode in ((normal, text.encode(), 0o700), (check, precheck.encode(), 0o700), (log, b'', 0o600), (prelog, b'', 0o600)):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as output:
        output.write(content); output.flush(); os.fsync(output.fileno())
    regular(path, mode)
    require(path.read_bytes() == content)
PY
jm_source "$jm_old" "$jm_oldsha" "$jm_oldtree"
jm_source "$jm_target" "$jm_sha" "$jm_tree"
bash -n "$jm_launcher"
bash -n "$jm_check"
# Seul le lanceur de précontrôle est exécuté ; le journal normal reste vide.
timeout --signal=TERM --kill-after=5s 60s bash "$jm_check" >>"$jm_prelog" 2>&1
jm_source "$jm_target" "$jm_sha" "$jm_tree"
python3 - "$jm_sha" "$jm_tree" "$jm_target" "$jm_launcher" "$jm_log" "$jm_prelog" <<'PY'
import hashlib, json, pathlib, sys
sha, tree, target, launcher, log, prelog = sys.argv[1:]
receipts = []
for line in pathlib.Path(prelog).read_text().splitlines():
    try: value = json.loads(line)
    except json.JSONDecodeError: continue
    if isinstance(value, dict) and value.get('type') == 'local_closure_precheck': receipts.append(value)
if not (len(receipts) == 1 and receipts[0].get('status') == 'passed' and receipts[0].get('started') is False and receipts[0].get('erased') is False and isinstance(receipts[0].get('pendingClosures'), bool)):
    raise SystemExit('STAGING_REFUSED: precheck receipt not confirmed; inspect private log')
print(json.dumps(dict(status='staged_precheck_passed', source=sha, tree=tree, version='1.0.0', checkout=target, launcher=launcher,
    nodeBinarySha256=hashlib.sha256(pathlib.Path('/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node').read_bytes()).hexdigest(), nodeVersion='v24.22.0',
    launcherSha256=hashlib.sha256(pathlib.Path(launcher).read_bytes()).hexdigest(), launcherMode='0700', log=log, logMode='0600',
    precheckLog=prelog, precheckLogSha256=hashlib.sha256(pathlib.Path(prelog).read_bytes()).hexdigest(),
    pendingClosures=receipts[0].get('pendingClosures'), started=False, erased=False, managerChanged=False, runtimeStarted=False), separators=(',', ':')))
PY
