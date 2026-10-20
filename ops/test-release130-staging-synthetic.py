#!/usr/bin/env python3
"""Disposable local Git fixtures; never executes the full staging script."""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "prepare-release130.sh"
OLD_PIN = "f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f"
text = SCRIPT.read_text()
snapshot = hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
blocks = [rest.split("\nPY\n", 1)[0] for rest in text.split("<<'PY'\n")[1:]]
assert len(blocks) == 2
for block in blocks:
    compile(block, "exact embedded release130 block", "exec")
git_fn = re.search(r"^jm_git\(\).*?$", text, re.M)[0]
source_fn = re.search(r"^jm_source\(\) \{\n.*?^\}", text, re.M | re.S)[0]
absence_gate = re.search(r"^for jm_path in .*?^done", text, re.M | re.S)[0]
# Only the two release target constants may remain placeholders or carry
# qualified pins. The fixture substitutes these exact constant spans; it never
# changes or disables the helper's pin and source checks.
sha_gate = re.search(r'^\[\[ "\$jm_sha" == ([a-f0-9]{40}|SHA_RELEASE130_PLACEHOLDER) \]\]$', text, re.M)
tree_assignment = re.search(r'^jm_tree=([a-f0-9]{40}|TREE_RELEASE130_PLACEHOLDER)$', text, re.M)
assert sha_gate is not None and tree_assignment is not None
assert len(re.findall(r'^\[\[ "\$jm_sha" == ', text, re.M)) == 1
assert len(re.findall(r'^jm_tree=', text, re.M)) == 1
assert text.count("SHA_RELEASE130_PLACEHOLDER") == int(sha_gate[1] == "SHA_RELEASE130_PLACEHOLDER")
assert text.count("TREE_RELEASE130_PLACEHOLDER") == int(tree_assignment[1] == "TREE_RELEASE130_PLACEHOLDER")
assert len(re.findall(r'bash "\$jm_check"', text)) == 1
assert not re.search(r'bash "\$jm_launcher"', text)
subprocess.run(["/bin/bash", "-n", str(SCRIPT)], check=True)
results = []

with tempfile.TemporaryDirectory(dir=ROOT, prefix="release130-staging-fixture-") as temporary:
    root = Path(temporary)
    old, target = root / "old", root / "target"
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="/dev/null")
    for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"):
        env.pop(key, None)

    def command(args, **kwargs):
        return subprocess.run(args, check=True, env=env, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, **kwargs)

    def git(*args):
        return command(["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "-C", str(old), *args]).stdout.decode().strip()

    old.mkdir()
    command(["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "init", "-q", str(old)])
    (old / ".gitignore").write_text("node_modules\n")
    migration_directory = old / "db" / "migrations"
    migration_directory.mkdir(parents=True)
    for index in range(1, 32):
        (migration_directory / f"{index:04d}_fixture.sql").write_text(f"-- synthetic migration {index}\n")
    package = {"name": "release130-local-fixture", "version": "1.2.0", "private": True}
    lock = {"name": package["name"], "version": "1.2.0", "lockfileVersion": 3,
            "packages": {"": {"name": package["name"], "version": "1.2.0", "dependencies": {"fixture": "1.2.3"}},
                         "node_modules/fixture": {"version": "1.2.3", "integrity": "unchanged-fixture"}}}

    def commit_version(version):
        package["version"] = lock["version"] = lock["packages"][""]["version"] = version
        (old / "package.json").write_text(json.dumps(package) + "\n")
        (old / "package-lock.json").write_text(json.dumps(lock) + "\n")
        git("add", ".gitignore", "package.json", "package-lock.json", "db/migrations")
        git("-c", "user.name=Local Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", version)
        return git("rev-parse", "HEAD"), git("rev-parse", "HEAD^{tree}")

    old_sha, old_tree = commit_version("1.2.0")
    sha, tree = commit_version("1.3.0")
    pinned_fixture = text
    for match, value in sorted(((sha_gate, sha), (tree_assignment, tree)),
                               key=lambda item: item[0].start(1), reverse=True):
        pinned_fixture = pinned_fixture[:match.start(1)] + value + pinned_fixture[match.end(1):]
    # This exact prefix contains argument validation, the exact-SHA gate and
    # tree-format validation, but stops before any filesystem/network action.
    prefix = pinned_fixture.split("jm_private=", 1)[0]
    assert "fetch" not in prefix and "python3" not in prefix and "jm_source" not in prefix
    for label, candidate, valid in (("exact_fixture_pin_passes", sha, True),
                                    ("wrong_fixture_pin_refused", "0" * 40, False)):
        result = subprocess.run(["/bin/bash", "-c", prefix, "synthetic pin gate", candidate],
                                env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert (result.returncode == 0) is valid, result.stderr.decode()
        results.append(label); print("PASS " + label)
    git("checkout", "--detach", old_sha)
    git("worktree", "add", "--detach", str(target), sha)
    deps = old / "node_modules"; deps.mkdir()
    link = target / "node_modules"; link.symlink_to(deps, target_is_directory=True)
    link_inode = link.lstat().st_ino
    original = root / "original.sh"
    template = (f"#!/bin/bash\n# source {old_sha}\n# tree {old_tree}\n"
                f'cd "{old}"\nexec /bin/echo start-local-closures --runtime-directory "{old}" '
                f'--runtime-head {old_sha} --runtime-tree {old_tree} '
                f'>> "{root}/outputs/jm120-node2422.log" 2>&1\n')
    original.write_text(template); original.chmod(0o700)

    def run_case(label, *, valid=True, expected_sha=None, expected_tree=None, preexisting=False):
        out = root / label; out.mkdir()
        normal, check, log, prelog = (out / name for name in
                                    ("normal.sh", "check.sh", "jm110-node2422.log", "jm110-preflight.log"))
        paths = [normal, check, log, prelog]
        if preexisting:
            check.write_bytes(b"existing artifact must survive\n")
        module = ast.parse(blocks[0])
        substitutions = 0
        for node in ast.walk(module):
            if isinstance(node, ast.Constant) and node.value == OLD_PIN:
                node.value = hashlib.sha256(original.read_bytes()).hexdigest()
                substitutions += 1
        assert substitutions == 1, "only the fixture launcher hash may change in the extracted core"
        shell = ("set -euo pipefail\numask 077\n" + git_fn + "\n" + source_fn + "\n"
                 + "jm_target=\"$4.not-created-checkout\"; jm_launcher=$4; jm_check=$5; jm_log=$6; jm_prelog=$7\n" + absence_gate + "\n"
                 + 'jm_source "$1" "$8" "${10}"\njm_source "$2" "$9" "${11}"\n'
                 + "python3 - \"$@\" <<'CORE'\n" + ast.unparse(module) + "\nCORE\n")
        args = [str(old), str(target), str(original), *map(str, paths), old_sha,
                sha if expected_sha is None else expected_sha, old_tree, tree if expected_tree is None else expected_tree]
        result = subprocess.run(["/bin/bash", "-c", shell, "synthetic", *args], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if valid:
            assert result.returncode == 0, result.stderr.decode()
            assert link.is_symlink() and link.lstat().st_ino == link_inode and link.resolve() == deps
            normal_text, check_text = normal.read_text(), check.read_text()
            assert normal_text.count(sha) == 2 and normal_text.count(tree) == 2
            assert normal_text.count(str(target)) == 2 and normal_text.count(log.name) == 1
            assert normal_text.count("start-local-closures") == 1
            assert "start-local-closures" not in check_text and check_text.count("check-local-closures") == 1
            assert log.name not in check_text and check_text.count(prelog.name) == 1
            for path in (normal, check):
                assert path.stat().st_mode & 0o777 == 0o700
                command(["/bin/bash", "-n", str(path)])
            for path in (log, prelog):
                assert path.stat().st_mode & 0o777 == 0o600 and path.read_bytes() == b""
            # Execute only the harmless generated CHECK fixture, never its normal launcher.
            command(["/bin/bash", str(check)])
            assert "check-local-closures" in prelog.read_text() and "start-local-closures" not in prelog.read_text()
            assert log.read_bytes() == b""
        else:
            assert result.returncode != 0, label
            for path in paths:
                if preexisting and path == check:
                    assert path.read_bytes() == b"existing artifact must survive\n"
                else:
                    assert not path.exists() and not path.is_symlink(), (label, path)
        results.append(label)
        print("PASS " + label)

    run_case("outputs")
    run_case("wrong_source_refuses_before_outputs", valid=False, expected_sha="a" * 40)
    wrong_deps = root / "wrong-deps"; wrong_deps.mkdir()
    link.unlink(); link.symlink_to(wrong_deps, target_is_directory=True)
    run_case("wrong_dependency_link_refuses_before_outputs", valid=False)
    assert link.resolve() == wrong_deps, "a rejected dependency link must not be replaced"
    link.unlink(); link.symlink_to(deps, target_is_directory=True)
    run_case("preexisting_output_preserved_without_other_writes", valid=False, preexisting=True)

    def target_commit_change(path, content):
        path.write_text(content)
        command(["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "-C", str(target), "add", str(path)])
        command(["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "-C", str(target),
                 "-c", "user.name=Local Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "synthetic incompatible target"])
        changed_sha = command(["/usr/bin/git", "-C", str(target), "rev-parse", "HEAD"]).stdout.decode().strip()
        changed_tree = command(["/usr/bin/git", "-C", str(target), "rev-parse", "HEAD^{tree}"]).stdout.decode().strip()
        return changed_sha, changed_tree

    changed_sha, changed_tree = target_commit_change(target / "db/migrations/0031_fixture.sql", "-- unexpected change\n")
    run_case("changed_migration_refuses_before_outputs", valid=False, expected_sha=changed_sha, expected_tree=changed_tree)
    command(["/usr/bin/git", "-C", str(target), "reset", "--hard", sha])
    changed_lock = json.loads((target / "package-lock.json").read_text())
    changed_lock["packages"]["node_modules/fixture"]["integrity"] = "changed"
    changed_sha, changed_tree = target_commit_change(target / "package-lock.json", json.dumps(changed_lock))
    run_case("changed_locked_dependency_refuses_before_outputs", valid=False, expected_sha=changed_sha, expected_tree=changed_tree)
    command(["/usr/bin/git", "-C", str(target), "reset", "--hard", sha])
    original.chmod(0o755)
    run_case("unsafe_launcher_mode_refuses_before_outputs", valid=False)
    original.chmod(0o700)

    # Exercise the exact reporting block independently with synthetic local paths.
    node = root / "node-fixture"; node.write_bytes(b"synthetic node bytes")
    node_sha = hashlib.sha256(node.read_bytes()).hexdigest()
    report_root = root / "receipt"; report_root.mkdir()
    launcher = report_root / "normal.sh"; launcher.write_bytes(b"#!/bin/bash\n"); launcher.chmod(0o700)
    check = report_root / "check.sh"; check.write_bytes(b"#!/bin/bash\n"); check.chmod(0o700)
    log = report_root / "normal.log"; log.write_bytes(b""); log.chmod(0o600)
    prelog = report_root / "precheck.log"; prelog.chmod(0o600) if prelog.exists() else None
    receipt = {"type": "local_closure_precheck", "status": "passed", "started": False, "erased": False, "pendingClosures": False}
    def report_case(label, *, receipts=None, valid=True, runtime_bytes=b"", expected_node=None):
        log.write_bytes(runtime_bytes)
        prelog.write_text("\n".join(json.dumps(value) for value in (receipts if receipts is not None else [receipt])) + "\n")
        prelog.chmod(0o600)
        args = [sha, tree, str(target), str(launcher), str(log), str(prelog), str(node), expected_node or node_sha, str(check)]
        result = subprocess.run(["python3", "-c", blocks[1], *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if valid:
            assert result.returncode == 0, result.stderr.decode()
            value = json.loads(result.stdout)
            assert value["status"] == "staged_precheck_passed" and value["version"] == "1.3.0"
            assert value["rollbackRelease"] == "1.2.0" and value["schemaMigrations"] == 31 and value["migrationsUnchanged"] is True
            assert all(value[key] is False for key in ["started", "erased", "migrated", "managerChanged", "runtimeStarted", "checkpointChanged"])
            assert value["noRestart"] is True
        else:
            assert result.returncode != 0 and b"staged_precheck_passed" not in result.stdout
        results.append(label); print("PASS " + label)
    report_case("valid_precheck_receipt")
    report_case("missing_precheck_receipt_refused", receipts=[], valid=False)
    report_case("duplicate_precheck_receipt_refused", receipts=[receipt, receipt], valid=False)
    report_case("runtime_started_receipt_refused", receipts=[dict(receipt, started=True)], valid=False)
    report_case("runtime_log_not_empty_refused", runtime_bytes=b"unexpected runtime output", valid=False)
    report_case("node_changed_before_receipt_refused", expected_node="0" * 64, valid=False)

assert hashlib.sha256(SCRIPT.read_bytes()).hexdigest() == snapshot, "production script changed during checks"
print(f"RESULT {len(results)}/{len(results)} passed; script_sha256={snapshot}; no remote or full staging execution")
