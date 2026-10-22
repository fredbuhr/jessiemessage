#!/usr/bin/env python3
"""Exercise the pinned publisher with a simulated GitHub API and immutable Git files.

No network, real token, production access or GitHub mutation is used. Node's
version command is stubbed; actual application qualification belongs to main CI.
"""
import argparse
import ast
import base64
import contextlib
import copy
import hashlib
import io
import json
import os
import pathlib
import re
import subprocess
import textwrap
import urllib.error
from unittest.mock import patch

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("workflow", nargs="?", default=".github/workflows/publish-qualified.yml")
parser.add_argument("--repo", default=".")
parser.add_argument("--output")
args = parser.parse_args()
workflow, repository = pathlib.Path(args.workflow), pathlib.Path(args.repo)
raw = workflow.read_text(encoding="utf-8")
script = textwrap.dedent(raw.split("        run: |\n", 1)[1])
module = ast.parse(script)

def literal(name):
    values = [node.value.value for node in module.body
              if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant)
              and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    assert len(values) == 1, "Expected one literal pin: " + name
    return values[0]

target, tree, ci = literal("target"), literal("tree"), int(literal("ci_text"))
baseline = literal("baseline")
assert re.fullmatch(r"[a-f0-9]{40}", target), "181 source pin must be filled after qualified main CI"
assert re.fullmatch(r"[a-f0-9]{40}", tree), "181 tree pin must be filled after qualified main CI"
assert ci > 0, "181 main CI run must be qualified"
assert baseline == "fd6e53b14b520231b0b307a2761331dd8c740a5b"
assert 'branches: ["ops/publish-v1.8.1"]' in raw
assert 'paths: [".github/workflows/publish-qualified.yml"]' in raw
assert "permissions: {}" in raw
operator, publisher = raw.split("  operator-tests:\n", 1)[1].split("  publish:\n", 1)
assert "contents: read" in operator and "contents: write" not in operator
assert "ref: ${{ github.sha }}" in operator and "persist-credentials: false" in operator
assert "fetch-depth: 0" in operator
assert "python3 ops/test-publish-qualified.py" in operator
assert "python3 ops/test-prepare-release181.py" in operator
assert 'node-version: "24.22.1"' in operator
assert "needs: operator-tests" in publisher
assert "contents: write" in publisher and "actions: read" in publisher
assert "actions/checkout" not in publisher
assert 'node-version: "24.22.1"' in publisher
assert "PATCH" not in [node.value for node in ast.walk(module) if isinstance(node, ast.Constant)]
assert "DELETE" not in [node.value for node in ast.walk(module) if isinstance(node, ast.Constant)]

def git(*arguments):
    return subprocess.run(["git", *arguments], cwd=repository, check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

assert git("rev-parse", tree + "^{tree}").decode().strip() == tree

def inventory(ref):
    items = []
    for row in git("ls-tree", "-rz", ref).split(b"\0"):
        if row:
            header, path = row.split(b"\t", 1)
            mode, kind, sha = header.decode().split()
            items.append(dict(path=path.decode(), mode=mode, type=kind, sha=sha))
    return dict(truncated=False, tree=items)

trees = {ref: inventory(ref) for ref in [baseline, tree]}
paths = ["package.json", "package-lock.json", ".github/workflows/ci.yml",
         "server/release-features.mjs", "server/index.mjs"]
files = {path: git("show", tree + ":" + path).decode("utf-8") for path in paths}
expected_jobs = ["verify", "MariaDB 10.11", "MariaDB 11.4", "Chrome keyboard and chat lifecycle",
                 "Chrome HTTPS authentication and messaging with MariaDB"]

class Fixture:
    def __init__(self, change=None, existing=None):
        self.change = change
        self.state = copy.deepcopy(existing or {})
        self.calls = []
        self.latest = dict(id=420607423, tag_name="v1.8.0")

    def __call__(self, request, timeout):
        assert timeout == 30
        prefix = "https://api.github.com/repos/fredbuhr/jessiemessage/"
        assert request.full_url.startswith(prefix)
        path, method = request.full_url[len(prefix):], request.get_method()
        assert method in {"GET", "POST"}
        self.calls.append((method, path))
        payload = None if request.data is None else json.loads(request.data)
        if path == "actions/runs/" + str(ci):
            value = dict(head_sha=target, head_branch="main", event="push", path=".github/workflows/ci.yml",
                         status="completed", conclusion="success", run_attempt=1)
            if self.change == "ci-incomplete":
                value["status"] = "in_progress"
            elif self.change == "ci-other-sha":
                value["head_sha"] = "1" * 40
            elif self.change == "ci-rerun":
                value["run_attempt"] = 2
        elif path == "actions/runs/" + str(ci) + "/jobs?per_page=100":
            jobs = [dict(name=name, status="completed", conclusion="success", head_sha=target,
                         run_id=ci, run_attempt=1) for name in expected_jobs]
            if self.change == "ci-missing-job":
                jobs.pop()
            elif self.change == "ci-failed-job":
                jobs[1]["conclusion"] = "failure"
            value = dict(total_count=len(jobs), jobs=jobs)
        elif path == "git/commits/" + target:
            value = dict(tree=dict(sha="2" * 40 if self.change == "other-tree" else tree))
        elif path == "compare/" + target + "...main":
            value = dict(merge_base_commit=dict(sha=target), status="behind" if self.change == "main-behind" else "ahead")
        elif path.startswith("git/trees/"):
            ref = path[len("git/trees/"):].split("?")[0]
            value = copy.deepcopy(trees[ref])
            if ref == tree and self.change == "normal-ddl-changed":
                next(item for item in value["tree"] if item["path"] == "db/migrations/0033_crm_tasks.sql")["sha"] = "3" * 40
            elif ref == tree and self.change == "sql37":
                value["tree"].append(dict(path="server/video/migrations/0037_unexpected.sql", mode="100644", type="blob", sha="3" * 40))
            elif ref == tree and self.change == "candidate-ddl-changed":
                next(item for item in value["tree"] if item["path"] == "server/video/migrations/0034_video_storage_state.sql")["sha"] = "8" * 40
            elif ref == tree and self.change == "candidate-missing":
                value["tree"] = [item for item in value["tree"] if item["path"] != "server/video/migrations/0036_message_video.sql"]
        elif path.startswith("contents/"):
            name = path[len("contents/"):].split("?")[0]
            content = files[name]
            if self.change == "video-gate-closed" and name == "server/release-features.mjs":
                content = content.replace("VIDEO_CREATION_ENABLED = true", "VIDEO_CREATION_ENABLED = false")
            elif self.change == "quick-gate-closed" and name == "server/release-features.mjs":
                content = content.replace("QUICK_REPLIES_WRITABLE = true", "QUICK_REPLIES_WRITABLE = false")
            elif self.change == "package-version" and name == "package.json":
                value = json.loads(content)
                value["version"] = "1.7.2"
                content = json.dumps(value)
            elif self.change == "old-node-pin" and name == ".github/workflows/ci.yml":
                content = content.replace("24.22.1", "24.22.0")
            value = dict(type="file", encoding="base64", content=base64.b64encode(content.encode()).decode())
        elif path == "git/ref/tags/v1.7.2":
            value = dict(object=dict(type="commit", sha="4" * 40 if self.change == "rollback-tag-diverged" else "6b3319a77c307ed7d6b003fe33de36807c70c266"))
        elif path == "releases/tags/v1.7.2":
            value = dict(id=420600213, tag_name="v1.7.2", target_commitish="6b3319a77c307ed7d6b003fe33de36807c70c266", draft=False, prerelease=False)
            if self.change == "rollback-release-diverged":
                value["target_commitish"] = "5" * 40
        elif path == "releases/latest":
            value = copy.deepcopy(self.latest)
            if self.change == "latest-before" or self.change == "latest-after" and "release" in self.state:
                value.update(id=999, tag_name="v1.8.1")
        elif path in {"git/ref/tags/v1.8.1", "releases/tags/v1.8.1"}:
            key = "tag" if path.startswith("git/") else "release"
            if key not in self.state:
                raise urllib.error.HTTPError(request.full_url, 404, "synthetic absent object", {}, None)
            value = self.state[key]
        elif method == "POST" and path == "git/refs":
            assert payload == dict(ref="refs/tags/v1.8.1", sha=target)
            value = dict(object=dict(type="commit", sha=target))
            self.state["tag"] = value
        elif method == "POST" and path == "releases":
            assert payload["make_latest"] == "false"
            value = dict(payload, html_url="https://example.invalid/synthetic-release")
            self.state["release"] = value
        else:
            raise AssertionError("Unexpected simulated API request: " + method + " " + path)
        return io.BytesIO(json.dumps(value).encode())

def execute(fixture, success=True, allow_prior_writes=False):
    output, failure = io.StringIO(), None
    environment = {"GITHUB_REPOSITORY": "fredbuhr/jessiemessage", "GITHUB_REF": "refs/heads/ops/publish-v1.8.1",
                   "GITHUB_EVENT_NAME": "push", "GH_TOKEN": "synthetic-token-only"}
    with patch("urllib.request.urlopen", fixture), patch("subprocess.check_output", return_value="v24.22.1\n"), \
            patch.dict(os.environ, environment, clear=True), contextlib.redirect_stdout(output):
        try:
            exec(compile(script, str(workflow), "exec"), {})
        except AssertionError as caught:
            failure = caught
    writes = [path for method, path in fixture.calls if method == "POST"]
    if success:
        assert failure is None, str(failure)
        receipt = json.loads(output.getvalue())
        assert receipt["status"] == "published_verified"
        assert receipt["latestPreserved"] == dict(tag="v1.8.0", id=420607423)
        assert fixture.latest == dict(tag_name="v1.8.0", id=420607423)
    else:
        assert failure is not None, "Expected qualification refusal"
        if not allow_prior_writes:
            assert not writes, "Qualification refusal performed a simulated mutation"
    return writes

checks = []
created = Fixture()
assert execute(created) == ["git/refs", "releases"]
checks.append("successful creation on pinned source while main is a descendant; latest unchanged")
existing = copy.deepcopy(created.state)
assert execute(Fixture(existing=existing)) == []
checks.append("identical tag and release retry is read-only")
tag_only = copy.deepcopy(existing)
tag_only.pop("release")
assert execute(Fixture(existing=tag_only)) == ["releases"]
checks.append("interrupted after exact tag retries only the release")
for change in ["ci-incomplete", "ci-other-sha", "ci-rerun", "ci-missing-job", "ci-failed-job", "other-tree",
               "video-gate-closed", "quick-gate-closed", "normal-ddl-changed", "sql37", "candidate-missing", "candidate-ddl-changed",
               "package-version", "old-node-pin", "latest-before", "main-behind",
               "rollback-tag-diverged", "rollback-release-diverged"]:
    execute(Fixture(change=change), success=False)
    checks.append("refuse " + change + " before mutations")
for name, mutate in [
    ("divergent tag", lambda state: state["tag"]["object"].update(sha="4" * 40)),
    ("divergent release body", lambda state: state["release"].update(body="changed")),
    ("divergent release source", lambda state: state["release"].update(target_commitish="5" * 40)),
]:
    state = copy.deepcopy(existing)
    mutate(state)
    execute(Fixture(existing=state), success=False)
    checks.append("refuse " + name + " before mutations")
assert execute(Fixture(change="latest-after"), success=False, allow_prior_writes=True) == ["git/refs", "releases"]
checks.append("detect an externally changed latest after publication without corrective mutation")
assert len(checks) == 25
receipt = dict(workflowPath=str(workflow.resolve()), workflowSha256=hashlib.sha256(workflow.read_bytes()).hexdigest(),
               fixtureTree=tree, sourcePin=target, ciPin=ci, tests=len(checks), passCount=len(checks), failCount=0,
               networkCalls=0, realMutations=0, productionAccess=False, checks=checks)
if args.output:
    pathlib.Path(args.output).write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt))
