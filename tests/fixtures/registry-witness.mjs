import path from "node:path";
import { mkdir } from "node:fs/promises";
import { captureOperationalState } from "../../server/backup/operational-checkpoint.mjs";
import { createRegistryWitness } from "../../server/backup/registry-witness.mjs";
import { createErasureContinuity } from "../../server/backup/registry-continuity.mjs";
import { registryIdentity } from "../../server/backup/registry-snapshot.mjs";
import { erasureDirectory, withErasureDirectory } from "./erasure-files.mjs";

// Actual fsync/CAS files in a separate disposable directory. This is a local
// protocol fixture, explicitly not a production off-host continuity proof.
export async function registryWitnessFixture(t, { binding, key, sourceDirectory, withDirectory = withErasureDirectory } = {}) {
  const root = await erasureDirectory(t), witnessDirectory = path.join(root, "witness");
  await mkdir(witnessDirectory, { mode: 0o700 });
  if (!sourceDirectory) { sourceDirectory = path.join(root, "source"); await mkdir(sourceDirectory, { mode: 0o700 }); }
  const registryId = registryIdentity(key, binding), witness = createRegistryWitness({ directory: witnessDirectory, registryId }, { withDirectory });
  await witness.initializeEmpty();
  const readCurrent = () => withDirectory(sourceDirectory, scope => captureOperationalState(scope, { key, binding }));
  const makeGate = (parameters = {}) => {
    const gate = createErasureContinuity({ key, binding, readCurrent, exchange: request => witness.exchange(request), ...parameters });
    t.after(() => gate.close()); return gate;
  };
  return { root, sourceDirectory, witnessDirectory, registryId, witness, readCurrent, makeGate, gate: makeGate() };
}
