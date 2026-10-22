#!/usr/bin/env python3
"""Test the exact marker-alignment workflow using only a simulated GitHub API.

Uses the standard library, synthetic release content, and a fake token. Does not
read a Git checkout, contact a network, or perform any real GitHub mutation.
"""
import argparse
import ast
import contextlib
import copy
import hashlib
import io
import json
import os
import pathlib
import re
import textwrap
from unittest.mock import patch


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("workflow", nargs="?", default=".github/workflows/record-release181.yml")
parser.add_argument("--output")
args = parser.parse_args()
workflow = pathlib.Path(args.workflow)
raw = workflow.read_text(encoding="utf-8")
operator, alignment = raw.split("  operator-tests:\n", 1)[1].split("  align-latest:\n", 1)
script = textwrap.dedent(alignment.split("        run: |\n", 1)[1])
module = ast.parse(script, filename=str(workflow))


def literal(name):
    values = [node.value.value for node in module.body
              if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant)
              and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    assert len(values) == 1, "Expected exactly one literal pin: " + name
    return values[0]


repo = literal("repo")
release_id, source, tree, ci = (literal(name) for name in ("release_id", "source", "tree", "ci"))
previous_id, previous_source = (literal(name) for name in ("previous_id", "previous_source"))
previous_tree, historical_id, historical_source, historical_tree = (literal(name) for name in
    ("previous_tree", "historical_id", "historical_source", "historical_tree"))
rollback_id, rollback_source, rollback_tree = (literal(name) for name in
                                               ("rollback_id", "rollback_source", "rollback_tree"))
assert repo == "fredbuhr/jessiemessage"
assert release_id == 420741528 and previous_id == 420607423 and rollback_id == 420600213
assert source == "1ae4c75152795ea6f31c2ff364e337a1d5a04e31"
assert tree == "eb427f887248fa9db5c656c3773e016f8688efc9"
assert ci == 39783509428
assert previous_source == "fd6e53b14b520231b0b307a2761331dd8c740a5b"
assert previous_tree == "324c3563fc6b1cfce669bcf58d90962c23c966b8"
assert historical_id == 420135576
assert historical_source == "c2d7b3b31c6d0955892829f808dc4135d7d8debf"
assert historical_tree == "d4945207f25375abb5d89c3a23ae91b6e34ea115"
assert rollback_source == "6b3319a77c307ed7d6b003fe33de36807c70c266"
assert rollback_tree == "924d500375a69ae50bc63414b15df71271e2bf8a"
trigger = re.search(r"(?m)^on:\n(.*?)(?=^\S)", raw, re.S).group(1)
assert trigger.strip() == ('push:\n    branches: ["ops/record-v1.8.1"]\n'
                           '    paths: [".github/workflows/record-release181.yml"]')
assert "permissions: {}" in raw
assert "contents: read" in operator and "contents: write" not in operator
assert operator.count("uses: actions/checkout@v4") == 1
assert "ref: ${{ github.sha }}" in operator and "persist-credentials: false" in operator
assert "python3 ops/test_record_release181.py" in operator
assert "python3 ops/test-align-release181-latest.py" in operator
assert "needs: operator-tests" in alignment
assert "contents: write" in alignment and "actions: read" in alignment
assert "actions/checkout" not in alignment and "shell: python" in alignment
constants = [node.value for node in ast.walk(module) if isinstance(node, ast.Constant)]
assert "POST" not in constants and "DELETE" not in constants
assert "PATCH" in constants and "GET" in constants
compiled = compile(module, str(workflow), "exec")
expected_jobs = ["verify", "MariaDB 10.11", "MariaDB 11.4", "Chrome keyboard and chat lifecycle",
                 "Chrome HTTPS authentication and messaging with MariaDB"]


def make_release(identifier, tag, commit):
    return dict(id=identifier, tag_name=tag, target_commitish=commit, name="Synthetic " + tag,
                body="Synthetic immutable release notes for " + tag, draft=False, prerelease=False,
                published_at="2026-10-20T12:00:00Z", created_at="2026-10-20T11:00:00Z",
                assets=[dict(id=identifier + 1, name=tag + ".txt", size=17,
                             digest="sha256:" + "a" * 64)])


class Fixture:
    def __init__(self, change=None, already_latest=False):
        self.change = change
        self.calls = []
        self.counts = {}
        self.releases = {release_id: make_release(release_id, "v1.8.1", source),
                         previous_id: make_release(previous_id, "v1.8.0", previous_source),
                         historical_id: make_release(historical_id, "v1.7.1", historical_source),
                         rollback_id: make_release(rollback_id, "v1.7.2", rollback_source)}
        self.original = copy.deepcopy(self.releases)
        self.latest = release_id if already_latest else previous_id

    @property
    def writes(self):
        return [call for call in self.calls if call[0] != "GET"]

    def __call__(self, request, timeout):
        assert timeout == 30
        prefix = "https://api.github.com/repos/" + repo
        assert request.full_url.startswith(prefix + "/")
        assert request.get_header("Authorization") == "Bearer synthetic-token-only"
        path, method = request.full_url[len(prefix):], request.get_method()
        payload = None if request.data is None else json.loads(request.data)
        self.calls.append((method, path, payload))
        assert method in {"GET", "PATCH"}, "Forbidden simulated HTTP method"
        self.counts[path] = self.counts.get(path, 0) + 1
        occurrence = self.counts[path]
        change = self.change
        if method == "PATCH":
            assert path == "/releases/" + str(release_id)
            assert payload == {"make_latest": "true"}
            assert len(self.writes) == 1
            self.latest = release_id
            value = copy.deepcopy(self.releases[release_id])
            if change == "patch-response-tag":
                value["tag_name"] = "v0.0.0"
            elif change == "patch-response-content":
                value["body"] = "Unexpected PATCH response content"
        else:
            assert payload is None
            if path == "/actions/runs/" + str(ci):
                value = dict(head_sha=source, head_branch="main", event="push", path=".github/workflows/ci.yml",
                             status="completed", conclusion="success", run_attempt=1)
                for kind, key, replacement in [
                    ("ci-failed", "conclusion", "failure"), ("ci-incomplete", "status", "in_progress"),
                    ("ci-rerun", "run_attempt", 2), ("ci-source", "head_sha", "1" * 40),
                    ("ci-branch", "head_branch", "other"), ("ci-event", "event", "workflow_dispatch"),
                    ("ci-workflow", "path", ".github/workflows/other.yml")]:
                    if change == kind:
                        value[key] = replacement
            elif path == "/actions/runs/" + str(ci) + "/jobs?per_page=100":
                jobs = [dict(name=name, status="completed", conclusion="success", head_sha=source,
                             run_id=ci, run_attempt=1) for name in expected_jobs]
                if change == "ci-missing-job":
                    jobs.pop()
                for kind, key, replacement in [
                    ("job-failed", "conclusion", "failure"), ("job-incomplete", "status", "queued"),
                    ("job-source", "head_sha", "1" * 40), ("job-run", "run_id", ci + 1),
                    ("job-rerun", "run_attempt", 2), ("job-name", "name", "unexpected")]:
                    if change == kind:
                        jobs[0][key] = replacement
                value = dict(total_count=len(jobs), jobs=jobs)
                if change == "jobs-truncated":
                    value["total_count"] += 1
            elif path.startswith("/git/commits/"):
                commit = path.rsplit("/", 1)[1]
                trees = {source: tree, previous_source: previous_tree, historical_source: historical_tree, rollback_source: rollback_tree}
                value = dict(tree=dict(sha=trees[commit]))
                if (change == "source-tree" and path.endswith(source) or
                        change == "rollback-tree" and path.endswith(rollback_source) or
                        change == "previous-tree" and path.endswith(previous_source) or
                        change == "historical-tree" and path.endswith(historical_source) or
                        change == "after-previous-tree" and path.endswith(previous_source) and occurrence > 1 or
                        change == "after-historical-tree" and path.endswith(historical_source) and occurrence > 1 or
                        change == "after-rollback-tree" and path.endswith(rollback_source) and occurrence > 1 or
                        change == "after-tree" and path.endswith(source) and occurrence > 1):
                    value["tree"]["sha"] = "2" * 40
            elif path == "/compare/" + source + "...main":
                value = dict(merge_base_commit=dict(sha=source), status="ahead")
                if change == "main-diverged":
                    value["merge_base_commit"]["sha"] = "2" * 40
                elif change == "main-behind":
                    value["status"] = "behind"
            elif path.startswith("/git/ref/tags/"):
                tag = path.rsplit("/", 1)[1]
                commits = {"v1.8.1": source, "v1.8.0": previous_source, "v1.7.2": rollback_source, "v1.7.1": historical_source}
                value = dict(object=dict(type="commit", sha=commits[tag]))
                if (change == "tag-" + tag or change == "after-tag-" + tag and occurrence > 1):
                    value["object"]["sha"] = "3" * 40
                if change == "annotated-tag" and tag == "v1.8.1":
                    value["object"]["type"] = "tag"
            elif path == "/releases/latest":
                value = copy.deepcopy(self.releases[self.latest])
                if change == "latest-unexpected" and occurrence == 1:
                    value["id"] = 999
                if change == "latest-previous-source" and occurrence == 1:
                    value["target_commitish"] = "4" * 40
                if change == "after-latest" and occurrence > 1:
                    value = copy.deepcopy(self.releases[previous_id])
            elif path.startswith("/releases/"):
                identifier = int(path.rsplit("/", 1)[1])
                value = copy.deepcopy(self.releases[identifier])
                if identifier == release_id and occurrence == 1:
                    for kind, key, replacement in [
                        ("release-id", "id", 999), ("release-tag", "tag_name", "v0.0.0"),
                        ("release-source", "target_commitish", "4" * 40),
                        ("release-draft", "draft", True), ("release-prerelease", "prerelease", True)]:
                        if change == kind:
                            value[key] = replacement
                if change == "previous-source" and identifier == previous_id and occurrence == 1:
                    value["target_commitish"] = "4" * 40
                if change == "historical-source" and identifier == historical_id and occurrence == 1:
                    value["target_commitish"] = "4" * 40
                if change == "rollback-source" and identifier == rollback_id and occurrence == 1:
                    value["target_commitish"] = "4" * 40
                if occurrence > 1:
                    if change == "after-content" and identifier == release_id:
                        value["body"] = "Externally changed content"
                    elif change == "after-assets" and identifier == release_id:
                        value["assets"][0]["size"] += 1
                    elif change == "after-previous" and identifier == previous_id:
                        value["body"] = "Externally changed previous release"
                    elif change == "after-historical" and identifier == historical_id:
                        value["body"] = "Externally changed historical release"
                    elif change == "after-rollback" and identifier == rollback_id:
                        value["assets"] = []
            else:
                raise AssertionError("Unexpected simulated request: " + method + " " + path)
        return io.BytesIO(json.dumps(value).encode())


def execute(fixture, success=True, after_patch=False):
    output, failure = io.StringIO(), None
    environment = {"GITHUB_REPOSITORY": repo, "GITHUB_REF": "refs/heads/ops/record-v1.8.1",
                   "GITHUB_EVENT_NAME": "push", "GITHUB_TOKEN": "synthetic-token-only"}
    with patch("urllib.request.urlopen", fixture), patch.dict(os.environ, environment, clear=True), \
            contextlib.redirect_stdout(output):
        try:
            exec(compiled, {})
        except AssertionError as caught:
            failure = caught
    expected_write = [("PATCH", "/releases/" + str(release_id), {"make_latest": "true"})]
    assert fixture.releases == fixture.original, "Simulated release content was mutated"
    if success:
        assert failure is None, "Unexpected qualification failure: " + str(failure)
        receipt = json.loads(output.getvalue())
        assert receipt["status"] == "latest_release_aligned"
        assert receipt["releaseId"] == release_id and receipt["source"] == source and receipt["tree"] == tree
        assert receipt["previous180Preserved"] is True and receipt["rollback172Preserved"] is True
        assert receipt["historical171Preserved"] is True and receipt["hostMetadataExecuted"] is False
        assert receipt["releaseContentUnchanged"] is True and receipt["assetsUnchanged"] is True
        assert receipt["newReleaseCreated"] is False and receipt["applicationDeployed"] is False
        assert receipt["markerChanged"] == bool(fixture.writes)
        assert fixture.latest == release_id
    else:
        assert failure is not None, "Expected qualification refusal: " + str(fixture.change)
        assert not output.getvalue(), "Failure printed a success receipt"
    if not success:
        assert fixture.writes == (expected_write if after_patch else [])
    return fixture.writes


checks, failures = [], []


def check(name, action):
    try:
        action()
        checks.append(name)
    except Exception as caught:
        failures.append(dict(check=name, error=type(caught).__name__ + ": " + str(caught)))


def successful_alignment():
    fixture = Fixture()
    assert execute(fixture) == [("PATCH", "/releases/420741528", {"make_latest": "true"})]
    assert fixture.releases[previous_id] == fixture.original[previous_id]
    assert fixture.releases[historical_id] == fixture.original[historical_id]
    assert fixture.releases[rollback_id] == fixture.original[rollback_id]


def identical_retry():
    fixture = Fixture(already_latest=True)
    assert execute(fixture) == []
    assert all(method == "GET" for method, _path, _payload in fixture.calls)


check("workflow static guards and pinned constants", lambda: None)
check("successful 1.8.0 to 1.8.1 changes exactly one latest marker; preserves 1.8.0, 1.7.2 and 1.7.1", successful_alignment)
check("identical 1.8.1 retry uses GET only", identical_retry)
for change in ["release-id", "release-tag", "release-source", "release-draft", "release-prerelease",
               "source-tree", "previous-tree", "historical-tree", "rollback-tree", "previous-source", "historical-source", "rollback-source", "tag-v1.8.1",
               "tag-v1.8.0", "tag-v1.7.2", "tag-v1.7.1", "annotated-tag", "latest-unexpected", "latest-previous-source",
               "ci-failed", "ci-incomplete", "ci-rerun", "ci-source", "ci-branch", "ci-event", "ci-workflow",
               "ci-missing-job", "job-failed", "job-incomplete", "job-source", "job-run", "job-rerun",
               "job-name", "jobs-truncated", "main-diverged", "main-behind"]:
    check("refuse " + change + " before PATCH", lambda change=change: execute(Fixture(change), success=False))
for change in ["patch-response-tag", "patch-response-content", "after-content", "after-assets", "after-previous",
               "after-rollback", "after-historical", "after-latest", "after-tag-v1.8.1", "after-tag-v1.8.0", "after-tag-v1.7.2", "after-tag-v1.7.1", "after-tree", "after-previous-tree", "after-historical-tree", "after-rollback-tree"]:
    check("detect " + change + " after one PATCH", lambda change=change: execute(Fixture(change), success=False, after_patch=True))
receipt = dict(workflowPath=str(workflow.resolve()), workflowSha256=hashlib.sha256(workflow.read_bytes()).hexdigest(),
               tests=len(checks) + len(failures), passCount=len(checks), failCount=len(failures),
               networkCalls=0, realMutations=0, productionAccess=False, checks=checks, failures=failures)
if args.output:
    pathlib.Path(args.output).write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt))
raise SystemExit(bool(failures))
