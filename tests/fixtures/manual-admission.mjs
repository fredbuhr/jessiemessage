import { randomBytes } from "node:crypto";

// Synthetic SQL fixtures only. Real accounts consume their invitation through
// registration; mailbox confirmation then activates that invitation automatically.
export async function consumeSyntheticInvitation(connection, clientId, at) {
  const date = new Date(at).toISOString().replace("T", " ").replace("Z", "000");
  const expires = new Date(at + 86400000).toISOString().replace("T", " ").replace("Z", "000");
  const result = await connection.query(`INSERT INTO invitations
    (id, token_hash, created_by_id, created_at, expires_at, consumed_at, consumed_by_id)
    SELECT ?, ?, id, ?, ?, ?, ? FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`,
  [randomBytes(16), randomBytes(32), date, expires, date, clientId]);
  if (Number(result.affectedRows) !== 1) throw new Error("Synthetic admission requires a fixture administrator.");
}
