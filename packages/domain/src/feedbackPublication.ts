// OS-APP-FEEDBACK F2: the pure protocol for transferring ONE reviewer-approved, sanitized snapshot to GitHub through an already-authorized connector.
// Nothing here talks to a network: a `Connector` and a `Fence` are injected (the existing authorized connector driven by a person, the authenticated private
// publication RPCs, or synthetic fakes in tests). The app holds no GitHub credential. The rules this module encodes:
//  * TRUST COMES FROM THE SERVER, never from the caller: the executable packet exists only as the one-time answer of the server's `dispatch`, tied to a
//    server-issued ATTEMPT generation. The protocol takes no "afterUncertain"/"reconciled" flags: whether a create is allowed is whatever the server state says.
//  * Before ANY external write the exact title and body are checked against the trusted snapshot (hash of the canonical text, marker, bounds, characters);
//    a changed or oversized payload makes ZERO connector calls. A second read-back check follows every write.
//  * a timeout is NEVER proof that nothing was created. After a released attempt the only way to a new create is a RECONCILIATION that proves an
//    EXHAUSTIVE absence (a complete listing since before the release), never an empty or partial search;
//  * a connector's answer is evidence, not truth: it is read back and verified against what the private system expects (repo, marker, exact text hash);
//  * this is not a cross-system atomic transaction and gives no exactly-once guarantee; it makes the uncertain outcome explicit and recoverable.

export const PUBLICATION_REPO = 'vindexholdings/open-stall';
export const MAX_LIST_PAGES = 20;          // a reconciliation listing beyond this many pages is incomplete evidence, never absence
export const MAX_TITLE = 120;
export const MAX_BODY = 3000;
const MARKER = /^OSFB-[0-9a-f]{20}$/;
const MARKER_IN_BODY = /Feedback reference: (OSFB-[0-9a-f]{20})\s*$/;
const HASH = /^[0-9a-f]{64}$/;

export type PacketPhase = 'preview' | 'transfer' | 'readback';
export type TransferPacket = {
  repo: string; operation: 'create' | 'update'; issue_number: number | null; marker: string; version: number; attempt: number; phase: PacketPhase;
  title: string; body: string; expected_hash: string;
};
export type ConnectorIssue = { repo: string; number: number; url: string; title: string; body: string };
/** What a connector call can throw: `rejected` = the service definitively refused (nothing was created); anything else is an unknown outcome (timeout, network, ...). */
export class ConnectorError extends Error {
  constructor(readonly kind: 'rejected' | 'unknown', message: string = kind) { super(message); }
}
export interface Connector {
  create(a: { repo: string; title: string; body: string }): Promise<unknown>;
  update(a: { repo: string; number: number; title: string; body: string }): Promise<unknown>;
  /** A search hint: issues in `repo` whose body contains the exact marker. NEVER proof of absence (indexes lag, pages truncate). */
  search(a: { repo: string; marker: string }): Promise<unknown>;
  /** The authoritative listing of issues created at or after `since` (ISO time), one page at a time: `{ issues, hasMore }`. */
  listSince(a: { repo: string; since: string; page: number }): Promise<unknown>;
  read(a: { repo: string; number: number }): Promise<unknown>;
}
/** The authenticated private publication RPCs, as the protocol needs them. The real implementation calls `admin_feedback_publication_get` / `_dispatch`. */
export interface Fence {
  snapshot(): Promise<unknown>;
  /** Releases the executable packet for exactly this attempt, ONCE. Rejects when it was already released, is stale, or the approval changed. */
  dispatch(attempt: number): Promise<unknown>;
}
export type Sha256Hex = (text: string) => string;

/** What goes to the server's report RPC (names match its parameters). */
export type ReportArgs = {
  p_attempt: number;
  p_outcome: 'cancelled' | 'created' | 'found' | 'updated' | 'none_found' | 'multiple' | 'uncertain' | 'failed';
  p_repo?: string | null; p_number?: number | null; p_url?: string | null; p_marker?: string | null; p_readback_hash?: string | null;
  /** Absence evidence (none_found only): the listing window start, pages checked, issues scanned, and that the listing was COMPLETE. */
  p_since?: string | null; p_pages?: number | null; p_scanned?: number | null; p_complete?: boolean | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Validates a packet the private system issued: exactly the allowlisted fields (anything else is refused) and sane shapes. */
export function parsePacket(v: unknown): TransferPacket | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v).sort().join();
  if (keys !== 'attempt,body,expected_hash,issue_number,marker,operation,phase,repo,title,version') return null;
  const { repo, operation, issue_number, marker, version, attempt, phase, title, body, expected_hash } = v as Record<string, unknown>;
  if (repo !== PUBLICATION_REPO || (operation !== 'create' && operation !== 'update')) return null;
  if (phase !== 'preview' && phase !== 'transfer' && phase !== 'readback') return null;
  if (typeof marker !== 'string' || !MARKER.test(marker) || typeof expected_hash !== 'string' || !HASH.test(expected_hash)) return null;
  if (typeof title !== 'string' || typeof body !== 'string' || !intIn(version, 1, 1_000_000) || !intIn(attempt, 1, 1_000_000)) return null;
  if (operation === 'update' ? !intIn(issue_number, 1, 100_000_000) : issue_number !== null) return null;
  return { repo, operation, issue_number: issue_number as number | null, marker, version, attempt, phase, title, body, expected_hash };
}

/** GitHub may change line endings or add a trailing newline; nothing else may change. Mirrors what the server hashes. */
export const normalizeText = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
export const readbackHash = (title: string, body: string, sha: Sha256Hex): string => sha(`${normalizeText(title)}\u001e${normalizeText(body)}`);

/** What the authenticated server says about this publication right now (the trusted side of every comparison). */
export type Snapshot = {
  status: string; attempt: number; version: number; marker: string; expected_hash: string; operation: 'create' | 'update'; issue_number: number | null;
  since: string | null; packet: unknown;
};
export function parseSnapshot(v: unknown): Snapshot | null {
  if (!isObj(v)) return null;
  const { status, attempt, version, marker, expected_hash, operation, issue_number, since, packet } = v as Record<string, unknown>;
  if (typeof status !== 'string' || !intIn(attempt, 0, 1_000_000) || !intIn(version, 1, 1_000_000)) return null;
  if (typeof marker !== 'string' || !MARKER.test(marker) || typeof expected_hash !== 'string' || !HASH.test(expected_hash)) return null;
  if (operation !== 'create' && operation !== 'update') return null;
  if (issue_number !== null && !intIn(issue_number, 1, 100_000_000)) return null;
  return { status, attempt, version, marker, expected_hash, operation, issue_number: (issue_number ?? null) as number | null, since: typeof since === 'string' ? since : null, packet };
}

/**
 * Fail-closed integrity check of a packet against the TRUSTED snapshot, BEFORE any external write. The packet's own `expected_hash` is never proof by itself:
 * the canonical hash of its actual text must equal BOTH it and the server's snapshot, and the marker, version, attempt, operation and mapping must agree.
 */
export function checkPacket(packet: TransferPacket, trusted: Snapshot, sha: Sha256Hex): { ok: true } | { ok: false; reason: string } {
  if (packet.title.length < 1 || packet.title.length > MAX_TITLE || packet.body.length < 1 || packet.body.length > MAX_BODY) return { ok: false, reason: 'size out of bounds' };
  if (!/^[\x20-\x7E]+$/.test(packet.title)) return { ok: false, reason: 'title has unexpected characters' };
  if (!/^[\x20-\x7E\n]+$/.test(packet.body)) return { ok: false, reason: 'body has unexpected characters' };
  if (!packet.body.startsWith('Category: ')) return { ok: false, reason: 'body does not follow the fixed template' };
  const m = MARKER_IN_BODY.exec(packet.body);
  if (!m || m[1] !== trusted.marker || packet.marker !== trusted.marker || packet.body.split(trusted.marker).length !== 2) return { ok: false, reason: 'reference marker does not match' };
  if (packet.version !== trusted.version || packet.attempt !== trusted.attempt || packet.operation !== trusted.operation || packet.issue_number !== trusted.issue_number) return { ok: false, reason: 'packet does not belong to this attempt' };
  if (packet.expected_hash !== trusted.expected_hash) return { ok: false, reason: 'hash differs from the server snapshot' };
  if (readbackHash(packet.title, packet.body, sha) !== trusted.expected_hash) return { ok: false, reason: 'text does not match the approved snapshot' };
  return { ok: true };
}

/** Shape-checks a connector answer; anything malformed is not an issue of ours. */
export function parseConnectorIssue(v: unknown): ConnectorIssue | null {
  if (!isObj(v)) return null;
  const { repo, number, url, title, body } = v as Record<string, unknown>;
  if (typeof repo !== 'string' || !intIn(number, 1, 100_000_000) || typeof url !== 'string' || typeof title !== 'string' || typeof body !== 'string') return null;
  return { repo, number, url, title, body };
}

/** The evidence for a report, taken from what the connector actually returned (never from what we hoped for). */
export function evidenceFrom(attempt: number, outcome: 'created' | 'found' | 'updated', issue: ConnectorIssue, sha: Sha256Hex): ReportArgs {
  const m = MARKER_IN_BODY.exec(normalizeText(issue.body));
  return { p_attempt: attempt, p_outcome: outcome, p_repo: issue.repo, p_number: issue.number, p_url: issue.url, p_marker: m ? m[1] : null, p_readback_hash: readbackHash(issue.title, issue.body, sha) };
}

/** A local check of a read-back issue against the trusted snapshot (the server re-checks everything; this tells the person early). */
export function verifyIssue(trusted: Snapshot, issue: ConnectorIssue, sha: Sha256Hex): { ok: true } | { ok: false; reason: string } {
  if (issue.repo !== PUBLICATION_REPO) return { ok: false, reason: 'wrong repository' };
  if (issue.url !== `https://github.com/${PUBLICATION_REPO}/issues/${issue.number}`) return { ok: false, reason: 'url does not match the issue number' };
  const m = MARKER_IN_BODY.exec(normalizeText(issue.body));
  if (!m || m[1] !== trusted.marker) return { ok: false, reason: 'marker does not match' };
  if (trusted.issue_number !== null && issue.number !== trusted.issue_number) return { ok: false, reason: 'issue number does not match the recorded mapping' };
  if (readbackHash(issue.title, issue.body, sha) !== trusted.expected_hash) return { ok: false, reason: 'text does not match the approved snapshot' };
  return { ok: true };
}

const unknown = (attempt: number): ReportArgs => ({ p_attempt: attempt, p_outcome: 'uncertain' });

export type PublishResult = {
  report: ReportArgs | null;
  /** Why nothing was sent (a refusal is never a result to report, except `integrity-after-release`). */
  refused?: 'snapshot-unavailable' | 'not-prepared' | 'invalid-packet' | 'integrity' | 'dispatch-refused' | 'integrity-after-release';
  reason?: string;
  calls: number;
};

/**
 * TRANSFER one PREPARED attempt. The state comes from the server: only a `prepared` attempt can start, its preview must pass the integrity check against the trusted
 * snapshot BEFORE the release, the server then releases the executable packet exactly ONCE (a reused packet, a reload, another operator or an old attempt is refused
 * there, so no create can follow), the released packet must equal the previewed one, and only then is the connector called. The connector's create response is never
 * trusted: the issue is READ BACK and that evidence is reported.
 */
export async function publish(fence: Fence, connector: Connector, sha: Sha256Hex): Promise<PublishResult> {
  let snapRaw: unknown;
  try { snapRaw = await fence.snapshot(); } catch { return { report: null, refused: 'snapshot-unavailable', calls: 0 }; }
  const snap = parseSnapshot(snapRaw);
  if (!snap) return { report: null, refused: 'snapshot-unavailable', calls: 0 };
  if (snap.status !== 'prepared') return { report: null, refused: 'not-prepared', reason: `status is ${snap.status}`, calls: 0 };
  const preview = parsePacket(snap.packet);
  if (!preview || preview.phase !== 'preview') return { report: null, refused: 'invalid-packet', calls: 0 };
  const pre = checkPacket(preview, snap, sha);
  if (!pre.ok) return { report: null, refused: 'integrity', reason: pre.reason, calls: 0 };
  let relRaw: unknown;
  try { relRaw = await fence.dispatch(snap.attempt); } catch { return { report: null, refused: 'dispatch-refused', calls: 0 }; }
  const released = parsePacket(relRaw);
  const same = released !== null && released.phase === 'transfer' && JSON.stringify({ ...released, phase: 'x' }) === JSON.stringify({ ...preview, phase: 'x' });
  // the attempt IS released now, but nothing was sent: report that truthfully (a definitive "nothing created"), it still needs a verified absence before any retry
  if (!released || !same) return { report: { p_attempt: snap.attempt, p_outcome: 'failed' }, refused: 'integrity-after-release', calls: 0 };
  let calls = 0;
  let answer: unknown;
  try {
    calls++;
    answer = released.operation === 'create'
      ? await connector.create({ repo: PUBLICATION_REPO, title: released.title, body: released.body })
      : await connector.update({ repo: PUBLICATION_REPO, number: released.issue_number as number, title: released.title, body: released.body });
  } catch (e) {
    return { report: e instanceof ConnectorError && e.kind === 'rejected' ? { p_attempt: snap.attempt, p_outcome: 'failed' } : unknown(snap.attempt), calls };
  }
  const first = parseConnectorIssue(answer);
  if (!first) return { report: unknown(snap.attempt), calls };   // malformed: something may or may not exist; reconcile
  let back: unknown;
  try { calls++; back = await connector.read({ repo: PUBLICATION_REPO, number: first.number }); } catch { return { report: unknown(snap.attempt), calls }; }
  const issue = parseConnectorIssue(back);
  if (!issue) return { report: unknown(snap.attempt), calls };
  return { report: evidenceFrom(snap.attempt, released.operation === 'create' ? 'created' : 'updated', issue, sha), calls };
}

export type ReconcileResult = { report: ReportArgs | null; refused?: 'snapshot-unavailable' | 'nothing-to-reconcile'; calls: number };

/**
 * RECONCILE a released attempt WITHOUT creating anything. Absence is proven ONLY by a COMPLETE authoritative listing since before the release (bounded pages): an
 * empty or partial search, a truncated or failing listing, a malformed or foreign answer all stay UNCERTAIN. Exactly one marker hit -> read back and report it as
 * `found`; several -> `multiple`. Zero hits with a complete listing -> `none_found` WITH the evidence of what was actually checked.
 */
export async function reconcile(fence: Fence, connector: Connector, sha: Sha256Hex): Promise<ReconcileResult> {
  let snapRaw: unknown;
  try { snapRaw = await fence.snapshot(); } catch { return { report: null, refused: 'snapshot-unavailable', calls: 0 }; }
  const snap = parseSnapshot(snapRaw);
  if (!snap) return { report: null, refused: 'snapshot-unavailable', calls: 0 };
  if (!['dispatched', 'uncertain', 'failed', 'conflict'].includes(snap.status)) return { report: null, refused: 'nothing-to-reconcile', calls: 0 };
  const attempt = snap.attempt;
  const ref = parsePacket(snap.packet);
  if (!ref || ref.phase !== 'readback' || !checkPacket(ref, snap, sha).ok || !snap.since || Number.isNaN(Date.parse(snap.since))) return { report: unknown(attempt), calls: 0 };
  let calls = 0;
  const hits = new Map<number, ConnectorIssue>();
  const take = (items: unknown): boolean => {
    if (!Array.isArray(items)) return false;
    for (const raw of items) {
      const i = parseConnectorIssue(raw);
      if (!i) return false;
      if (i.repo !== PUBLICATION_REPO) return false;                       // a foreign hit is never silently ignored as "nothing"
      if (i.body.includes(snap.marker)) hits.set(i.number, i);
    }
    return true;
  };
  // 1. the search is only a HINT (it can find something early; it can never prove absence)
  try { calls++; if (!take(await connector.search({ repo: PUBLICATION_REPO, marker: snap.marker }))) return { report: unknown(attempt), calls }; } catch { return { report: unknown(attempt), calls }; }
  // 2. the authoritative listing, bounded and paged
  let pages = 0; let scanned = 0; let complete = false;
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    let res: unknown;
    try { calls++; res = await connector.listSince({ repo: PUBLICATION_REPO, since: snap.since, page }); } catch { return { report: unknown(attempt), calls }; }
    if (!isObj(res) || !Array.isArray(res.issues) || typeof res.hasMore !== 'boolean') return { report: unknown(attempt), calls };
    if (!take(res.issues)) return { report: unknown(attempt), calls };
    pages++; scanned += res.issues.length;
    if (!res.hasMore) { complete = true; break; }
  }
  if (hits.size > 1) return { report: { p_attempt: attempt, p_outcome: 'multiple' }, calls };
  if (hits.size === 1) {
    const only = [...hits.values()][0] as ConnectorIssue;
    let back: unknown;
    try { calls++; back = await connector.read({ repo: PUBLICATION_REPO, number: only.number }); } catch { return { report: unknown(attempt), calls }; }
    const issue = parseConnectorIssue(back);
    return { report: issue ? evidenceFrom(attempt, 'found', issue, sha) : unknown(attempt), calls };
  }
  if (!complete || pages < 1) return { report: unknown(attempt), calls };   // truncated: NOT absence
  return { report: { p_attempt: attempt, p_outcome: 'none_found', p_since: snap.since, p_pages: pages, p_scanned: scanned, p_complete: true }, calls };
}
