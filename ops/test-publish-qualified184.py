#!/usr/bin/env python3
"""Exercise the pinned publisher with entirely synthetic GitHub API and source-file payloads.

No Git command, network, real token, production access or GitHub mutation is used. Node's
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
parser.add_argument("workflow", nargs="?", default=".github/workflows/publish-qualified184.yml")
parser.add_argument("--output")
args = parser.parse_args()
workflow = pathlib.Path(args.workflow)
raw = workflow.read_text(encoding="utf-8")
script = textwrap.dedent(raw.split("        run: |\n", 1)[1])
module = ast.parse(script)

def literal(name):
    values = [node.value.value for node in module.body
              if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant)
              and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    assert len(values) == 1, "Expected one literal pin: " + name
    return values[0]

shipped_pins = {name: literal(name) for name in ("target", "tree", "ci_text")}
pending = "QUALIFICATION_PENDING"
for name, value in shipped_pins.items():
    assert value == pending or re.fullmatch(r"[a-f0-9]{40}" if name != "ci_text" else r"[1-9][0-9]*", value)
# These identifiers exist only inside this synthetic test, never the workflow.
fixture_pins = {"target": "a" * 40, "tree": "b" * 40, "ci_text": "184001"}
def with_pins(pins):
    cloned = copy.deepcopy(module)
    changed = set()
    for node in cloned.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in pins:
            name = node.targets[0].id
            node.value = ast.copy_location(ast.Constant(value=pins[name]), node.value)
            changed.add(name)
    assert changed == set(pins), "Only named qualification literals may be replaced"
    return ast.fix_missing_locations(cloned)

def refuses_before_io(candidate):
    with patch("urllib.request.urlopen", side_effect=RuntimeError("network forbidden")) as network, \
            patch("subprocess.check_output", side_effect=RuntimeError("process forbidden")) as process:
        try:
            exec(compile(candidate, str(workflow), "exec"), {})
        except AssertionError:
            pass
        else:
            raise AssertionError("Pending qualification pin must refuse")
        network.assert_not_called(); process.assert_not_called()

pending_checks = []
# Always inject pending values, even after shipped constants are finalized.
# The production workflow is neither changed nor qualified by this fixture.
refuses_before_io(with_pins({name: pending for name in fixture_pins}))
pending_checks.append("all pending pins refuse before any process or API call")
for missing in fixture_pins:
    pins = dict(fixture_pins, **{missing: pending})
    refuses_before_io(with_pins(pins))
    pending_checks.append("partial qualification missing " + missing + " refuses before any process or API call")
fixture_module = with_pins(fixture_pins)
target, tree, ci = fixture_pins["target"], fixture_pins["tree"], int(fixture_pins["ci_text"])
baseline, baseline_tree = literal("baseline"), literal("baseline_tree")
assert baseline == "48fd42b808b2bc4d95d3f3ba21244c032d0a938f"
assert baseline_tree == "1070a2d4db52e92aa020e4cb8c6d4bacaaf06a58"
assert literal("latest_tag") == "v1.8.3" and literal("latest_id") == 421266798
assert 'branches: ["ops/publish-v1.8.4"]' in raw
assert 'paths: [".github/workflows/publish-qualified184.yml"]' in raw
assert "permissions: {}" in raw
operator, publisher = raw.split("  operator-tests:\n", 1)[1].split("  publish:\n", 1)
assert "contents: read" in operator and "contents: write" not in operator
assert "ref: ${{ github.sha }}" in operator and "persist-credentials: false" in operator
assert "fetch-depth: 0" in operator
assert operator.count("uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1") == 1
assert operator.count("uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1") == 1
assert publisher.count("uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1") == 1
assert "package-manager-cache: false" in operator and "package-manager-cache: false" in publisher
assert not re.search(r"uses: [^\n]+@v[0-9]", raw)
assert "python3 ops/test-publish-qualified184.py" in operator
assert "python3 ops/test-prepare-release184.py" in operator
assert 'node-version: "24.22.1"' in operator
assert "needs: operator-tests" in publisher
assert "contents: write" in publisher and "actions: read" in publisher
assert "uses: actions/checkout" not in publisher
assert 'node-version: "24.22.1"' in publisher
assert "PATCH" not in [node.value for node in ast.walk(module) if isinstance(node, ast.Constant)]
assert "DELETE" not in [node.value for node in ast.walk(module) if isinstance(node, ast.Constant)]

# Closed synthetic source and workflow shapes, not a checkout or future tree.
def inventory():
    names = [f"db/migrations/{i:04d}_synthetic.sql" for i in range(1, 33)] + ["db/migrations/0033_crm_tasks.sql"]
    names += ["server/video/migrations/0034_video_storage_state.sql", "server/video/migrations/0035_video_assets.sql", "server/video/migrations/0036_message_video.sql"]
    return dict(truncated=False, tree=[dict(path=name, mode="100644", type="blob", sha=hashlib.sha1(name.encode()).hexdigest()) for name in names])
trees = {ref: inventory() for ref in (baseline_tree, tree)}
root_package = {"name":"jessiemessage", "version":"1.8.4", "engines":{"node":">=24 <25"}}
ci_workflow = "\n".join(["    uses: " + action for action in [
    *(["actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"] * 4),
    *(["actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1"] * 4),
    *(["actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9"] * 2)]] +
    ['    node-version: "24.22.1"', '    persist-credentials: false', '    package-manager-cache: false'] * 4)
runtime = 'import { VIDEO_CREATION_ENABLED, QUICK_REPLIES_WRITABLE } from "./release-features.mjs";\n' + \
    'creationEnabled: VIDEO_CREATION_ENABLED\n' * 3 + 'videoCreationEnabled: VIDEO_CREATION_ENABLED\n' * 6 + 'writable: QUICK_REPLIES_WRITABLE\n' * 3
files = {"package.json":json.dumps(root_package),
    "package-lock.json":json.dumps(dict(root_package, packages={"":copy.deepcopy(root_package)})),
    ".github/workflows/ci.yml":ci_workflow,
    "server/release-features.mjs":"export const VIDEO_CREATION_ENABLED = true;\nexport const QUICK_REPLIES_WRITABLE = true;\n",
    "server/index.mjs":runtime}
expected_jobs = ["verify", "MariaDB 10.11", "MariaDB 11.4", "Chrome keyboard and chat lifecycle",
                 "Chrome HTTPS authentication and messaging with MariaDB"]

class Fixture:
    def __init__(self, change=None, existing=None):
        self.change = change
        self.state = copy.deepcopy(existing or {})
        self.calls = []
        self.latest = copy.deepcopy(self.state["release"]) if "release" in self.state else dict(id=421266798, tag_name="v1.8.3", target_commitish=baseline)
        if self.change == "existing-release-old-latest":
            self.latest = dict(id=421266798, tag_name="v1.8.3", target_commitish=baseline)
        elif self.change == "tag-only-with-unknown-latest":
            self.latest = dict(id=999, tag_name="v1.8.4", target_commitish=target)

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
        elif path == "git/commits/" + baseline:
            value = dict(tree=dict(sha="2" * 40 if self.change == "baseline-tree-drift" else baseline_tree))
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
            elif self.change == "mutable-action-pin" and name == ".github/workflows/ci.yml":
                content = content.replace("actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1", "actions/setup-node@v7")
            elif self.change == "untrusted-action" and name == ".github/workflows/ci.yml":
                content += "\n        uses: untrusted/action@" + "1" * 40 + "\n"
            elif self.change == "credentials-persisted" and name == ".github/workflows/ci.yml":
                content = content.replace("persist-credentials: false", "persist-credentials: true", 1)
            elif self.change == "cache-enabled" and name == ".github/workflows/ci.yml":
                content = content.replace("package-manager-cache: false", "package-manager-cache: true", 1)
            value = dict(type="file", encoding="base64", content=base64.b64encode(content.encode()).decode())
        elif path == "git/ref/tags/v1.7.2":
            value = dict(object=dict(type="commit", sha="4" * 40 if self.change == "rollback-tag-diverged" else "6b3319a77c307ed7d6b003fe33de36807c70c266"))
        elif path == "releases/tags/v1.7.2":
            value = dict(id=420600213, tag_name="v1.7.2", target_commitish="6b3319a77c307ed7d6b003fe33de36807c70c266", draft=False, prerelease=False)
            if self.change == "rollback-release-diverged":
                value["target_commitish"] = "5" * 40
        elif path == "releases/latest":
            value = copy.deepcopy(self.latest)
            if (self.change == "latest-before"
                    or self.change == "latest-after" and "release" in self.state
                    or self.change == "latest-between-tag-and-release" and "tag" in self.state and "release" not in self.state):
                value.update(id=999, tag_name="v1.8.4")
            elif self.change == "latest-wrong-source" and "release" in self.state:
                value["target_commitish"] = "6" * 40
        elif path in {"git/ref/tags/v1.8.4", "releases/tags/v1.8.4"}:
            key = "tag" if path.startswith("git/") else "release"
            if key not in self.state:
                raise urllib.error.HTTPError(request.full_url, 404, "synthetic absent object", {}, None)
            value = self.state[key]
        elif method == "POST" and path == "git/refs":
            assert payload == dict(ref="refs/tags/v1.8.4", sha=target)
            value = dict(object=dict(type="commit", sha=target))
            self.state["tag"] = value
        elif method == "POST" and path == "releases":
            assert payload["make_latest"] == "true"
            value = dict(payload, id=420999999, html_url="https://example.invalid/synthetic-release")
            self.state["release"] = value
            self.latest = copy.deepcopy(value)
        else:
            raise AssertionError("Unexpected simulated API request: " + method + " " + path)
        return io.BytesIO(json.dumps(value).encode())

def execute(fixture, success=True, allow_prior_writes=False):
    output, failure = io.StringIO(), None
    environment = {"GITHUB_REPOSITORY": "fredbuhr/jessiemessage", "GITHUB_REF": "refs/heads/ops/publish-v1.8.4",
                   "GITHUB_EVENT_NAME": "push", "GH_TOKEN": "synthetic-token-only"}
    with patch("urllib.request.urlopen", fixture), patch("subprocess.check_output", return_value="v24.22.1\n"), \
            patch.dict(os.environ, environment, clear=True), contextlib.redirect_stdout(output):
        try:
            exec(compile(fixture_module, str(workflow), "exec"), {})
        except AssertionError as caught:
            failure = caught
    writes = [path for method, path in fixture.calls if method == "POST"]
    if success:
        assert failure is None, str(failure)
        receipt = json.loads(output.getvalue())
        assert receipt["status"] == "published_verified"
        assert receipt["previousLatest"] == dict(tag="v1.8.3", id=421266798)
        assert receipt["latest"] == dict(tag="v1.8.4", id=420999999, source=target)
        assert fixture.latest["id"] == 420999999
        assert fixture.latest["tag_name"] == "v1.8.4" and fixture.latest["target_commitish"] == target
    else:
        assert failure is not None, "Expected qualification refusal"
        if not allow_prior_writes:
            assert not writes, "Qualification refusal performed a simulated mutation"
    return writes

checks = list(pending_checks)
created = Fixture()
assert execute(created) == ["git/refs", "releases"]
checks.append("successful immutable creation on pinned source advances latest in the same release write")
existing = copy.deepcopy(created.state)
assert execute(Fixture(existing=existing)) == []
checks.append("identical tag and release retry is read-only")
tag_only = copy.deepcopy(existing)
tag_only.pop("release")
assert execute(Fixture(existing=tag_only)) == ["releases"]
checks.append("interrupted after exact tag with previous latest retries only the release")
execute(Fixture(change="existing-release-old-latest", existing=existing), success=False)
checks.append("existing release with previous latest is refused before mutations, no automatic metadata edit")
execute(Fixture(change="tag-only-with-unknown-latest", existing=tag_only), success=False)
checks.append("exact tag alone with unknown latest is refused before mutations")
execute(Fixture(change="latest-wrong-source", existing=existing), success=False)
checks.append("existing release with divergent latest source is refused before mutations")
assert execute(Fixture(change="latest-between-tag-and-release"), success=False, allow_prior_writes=True) == ["git/refs"]
checks.append("latest changed after tag creation refuses release creation without corrective mutation")
for change in ["ci-incomplete", "ci-other-sha", "ci-rerun", "ci-missing-job", "ci-failed-job", "other-tree", "baseline-tree-drift",
               "video-gate-closed", "quick-gate-closed", "normal-ddl-changed", "sql37", "candidate-missing", "candidate-ddl-changed",
               "package-version", "old-node-pin", "mutable-action-pin", "untrusted-action", "credentials-persisted", "cache-enabled", "latest-before", "main-behind",
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
assert len(checks) == 38
receipt = dict(workflowPath=str(workflow.resolve()), workflowSha256=hashlib.sha256(workflow.read_bytes()).hexdigest(),
               shippedPins=shipped_pins, fixturePins=fixture_pins, sourcePinsQualified=False,
               fixtureSourceMode="entirely synthetic API/source payloads; no Git checkout or future source inferred", tests=len(checks), passCount=len(checks), failCount=0,
               networkCalls=0, realMutations=0, productionAccess=False, checks=checks)
if args.output:
    pathlib.Path(args.output).write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt))
