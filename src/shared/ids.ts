/** Persistent, collision-resistant identifiers (RFC 4122 v4 UUIDs). */
export function newId(): string {
  return globalThis.crypto.randomUUID()
}
