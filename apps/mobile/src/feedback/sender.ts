import type { FeedbackDiagnostics, FeedbackDraft } from '@open-stall/domain';
import type { RpcClientLike } from '../account/api';
import type { FeedbackOutcome } from './api';

type Submitted = FeedbackOutcome<{ id: string; replayed: boolean }>;

/**
 * Everything one send needs, as injectable adapters (tests hold each boundary open deliberately; the app wires the real ones in transport.ts).
 * `bind` MUST return a client whose credential is FIXED to the given access token (in memory only, never persisted or logged): after the session
 * check the request can then never pick up whoever is signed in later.
 */
export type SenderDeps = {
  /** The account that owns this form (its private identity, never displayed). */
  owner: string;
  getSession: () => Promise<{ userId: string | null; accessToken: string | null }>;
  bind: (accessToken: string) => RpcClientLike | null;
  newKey: () => Promise<string>;
  submit: (c: RpcClientLike, d: FeedbackDraft, diag: FeedbackDiagnostics, key: string) => Promise<Submitted>;
};

export type SendResult =
  | { kind: 'done'; outcome: Submitted }
  | { kind: 'refused'; reason: 'busy' | 'disposed' | 'account-changed' | 'unavailable' }
  /** The request was already on its way for the owner when the form went away: it may finish for the owner, and nothing may be shown anywhere. */
  | { kind: 'discarded' };

/**
 * One account's feedback send. It binds the send to the initiating authenticated session: after EVERY wait (key generation, session lookup) it
 * re-checks that it is still the live form of that account, and the request is dispatched with the token of the session that was verified to belong
 * to the owner, through a client that cannot read any other credential. A different account's session therefore never receives this content, and a
 * replaced form never reports a result.
 */
export class FeedbackSender {
  private key: string | null = null;
  private busy = false;
  private disposed = false;
  constructor(private readonly deps: SenderDeps) {}

  /** (Re)activates the sender when its screen mounts (also covers React's development double-mount). */
  attach(): void { this.disposed = false; }
  /** The screen is gone (account change, sign-out, leaving): nothing more may start, and nothing in flight may report. */
  dispose(): void { this.disposed = true; }
  /** The content changed: the next send is a new submission with a new retry key. */
  forgetKey(): void { this.key = null; }

  async send(draft: FeedbackDraft, diag: FeedbackDiagnostics): Promise<SendResult> {
    if (this.disposed) return { kind: 'refused', reason: 'disposed' };
    if (this.busy) return { kind: 'refused', reason: 'busy' };
    this.busy = true;
    try {
      let key = this.key;
      if (key === null) {
        const fresh = await this.deps.newKey();
        if (this.disposed) return { kind: 'refused', reason: 'disposed' };
        this.key ??= fresh;
        key = this.key;
      }
      const s = await this.deps.getSession();
      if (this.disposed) return { kind: 'refused', reason: 'disposed' };
      // MUTABLE-GUARD: the session that would carry this request must belong to the account that owns this form
      if (!s.userId || s.userId !== this.deps.owner || !s.accessToken) return { kind: 'refused', reason: 'account-changed' };
      const client = this.deps.bind(s.accessToken);
      if (!client) return { kind: 'refused', reason: 'unavailable' };
      // no await between the checks above and the dispatch below
      const outcome = await this.deps.submit(client, draft, diag, key);
      return this.disposed ? { kind: 'discarded' } : { kind: 'done', outcome };
    } finally {
      this.busy = false;
    }
  }
}
