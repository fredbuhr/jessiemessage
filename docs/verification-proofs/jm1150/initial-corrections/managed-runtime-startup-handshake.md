# Managed runtime startup-stop fixture race

CI PR147 run41337463760 reported MANAGED_RUNTIME_STOP in the test actual shim cannot begin a listener after shutdown was requested during startup, at about596ms against the unchanged500ms forced-stop guard. Runtime/shim production source is unchanged.

Established ordering defect: the fixture publishes startup-waiting via asynchronous writeFile before registering its own SIGTERM promise. The file may become observable before writeFile resolves (even before complete contents). The parent can call destroy after observing the marker, causing the production shim to set closing=true, while the fixture's later SIGTERM listener misses that same signal. main then never returns; the real runtime correctly enforces500ms and SIGKILL, refusing a graceful-stop acknowledgement.

New deterministic isolated probe managed-runtime-race-probe.mjs inserts an explicit continuation gate around this window and separately observes the first SIGTERM. With old ordering the child remains alive/blocked until probe cleanup; with fixed ordering it exits0 without opening a listener. Results are in managed-runtime-race-probe.json. The probe's first attempt used an incompletely sanitized child environment and failed before its marker; that failure is preserved in managed-runtime-race-probe-first-failed.log, then corrected to the existing fixture's exact forbidden-variable filter. No production fix was inferred from that first attempt.

Only tests/managed-runtime.test.mjs changed: register const stopped = new Promise(process.once SIGTERM) before writing startup-waiting, then await stopped after writing. The marker now proves the shutdown waiter exists. No timeout, runtime guard, product source or expectation weakened. startup1500ms, marker1000ms, stop500ms remain unchanged.

Single requested test executed once after correction:1 test /1 pass /0 fail /0 skip,88.5ms test duration, exit0. Full output managed-runtime-startup-handshake.log. No green suite replay. Diff whitespace check passes.

File SHA256: de53af20aa310dbd3bc783454e55528727de114f803ee14cadff71e6c04d8621
