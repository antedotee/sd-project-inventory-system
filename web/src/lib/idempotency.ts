/**
 * One Idempotency-Key per logical submission.
 *
 * - Retrying the same payload after a network error or 5xx reuses the key,
 *   so the server runs the order at most once.
 * - Changing the payload, or getting a final answer (2xx or 4xx), starts a
 *   new submission with a new key.
 */
export class IdempotentSubmission {
  private key: string | null = null;
  private payloadFingerprint: string | null = null;

  constructor(private readonly newKey: () => string = () => crypto.randomUUID()) {}

  keyFor(payload: unknown): string {
    const fingerprint = JSON.stringify(payload);
    if (!this.key || fingerprint !== this.payloadFingerprint) {
      this.key = this.newKey();
      this.payloadFingerprint = fingerprint;
    }
    return this.key;
  }

  /** Call when the server gave a final answer; the next submit gets a fresh key. */
  settle(): void {
    this.key = null;
    this.payloadFingerprint = null;
  }
}
