# GHSA-901 reconciliation findings

Baseline: `4c951398ef48b693f40094095e5dfe6eaad23839`.

## Sandbox-host failure

The supplied `{ host: "sandbox", security: "full", ask: "off" }` authority was not narrowed after
launch. `parseWorkerLaunchDescriptor` cloned it, `runWorkerDescriptor` forwarded it, and
`runWorkerEmbeddedTurn` passed it through `createCoreCodingTools` and `createLazyExecTool`.
`createExecTool` then retained `host=sandbox` in `resolveExecTarget` and retained `security=full` in
`resolveExecModePolicy`.

Execution failed at the next check because `createExecTool` requires a `SandboxContext` for
`host=sandbox`, while the isolated worker intentionally has no nested sandbox runtime. The worker
is already the isolation boundary, so its consumer now maps only `sandbox` to its local `gateway`
host. The resolved `security` and `ask` values are preserved, and `node` remains unchanged. The
runtime test asserts the admitted descriptor still contains `sandbox/full/off`, then proves the
adapted tool executes successfully; this demonstrates the policy was not re-narrowed downstream.

## Pre-existing legitimate-exec test

The production code was correct and the fixture was wrong. The test manually constructed a
name-only launch descriptor but expected exec to run. The verified fix deliberately treats absent
exec authority as `{ host: "gateway", security: "deny", ask: "off" }`, so executing that fixture
would violate the required fail-closed contract. Production launchers now supply resolved exec
authority explicitly. The legitimate-exec fixture therefore declares `gateway/full/off`; the
absent-authority tests continue to prove denial.

## Legacy descriptor assertion

The descriptor parser keeps the new field optional for the verified protocol shape. Its test helper
was catching its own failed assertion and misreporting it as parser rejection. The helper now
distinguishes actual parser rejection from accepted name-only input and verifies that any explicit
authority is deny/off and never full. Runtime coverage remains the enforcement proof for absent
authority.

## Verification

The director's exact Node 24 command passed five files and 81 tests:

```text
Test Files  5 passed (5)
Tests       81 passed (81)
```

Production delta versus the baseline is `+50/-9`: the verified prior fix was `+48/-9`, and the only
additional production lines are the comment and host adaptation at the isolated-worker boundary.
