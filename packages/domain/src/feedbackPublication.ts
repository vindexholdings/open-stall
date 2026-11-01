// OS-APP-FEEDBACK F2: the pure protocol for transferring ONE reviewer-approved, sanitized snapshot to GitHub through an already-authorized connector.
// Nothing here talks to a network: a `Connector` is injected (the existing authorized connector, driven by a person, or a synthetic fake in tests).
// The app holds no GitHub credential. The rules this module encodes:
//  * the destination is ONLY vindexholdings/open-stall; a packet for anything else is refused before any connector call;
//  * a timeout is NEVER proof that nothing was created: it is `uncertain`, and a create may only be retried after a reconciliation by the public marker
//    found NOTHING (never a blind second create);
//  * a connector's answer is evidence, not truth: it is read back and verified against what the private system expects (repo, marker, exact text hash);
//    anything else is reported as such and fails closed on the server;
//  * this is not a cross-system atomic transaction and gives no exactly-once guarantee.

export const PUBLICATION_REPO = 'vindexholdings/open-stall';
const MARKER = /^OSFB-[0-9a-f]{20}$/;
const MARKER_IN_BODY = /Feedback reference: (OSFB-[0-9a-f]{20})\s*$/;
const HASH = /^[0-9a-f]{64}$/;

export type TransferPacket = {
  repo: string; operation: 'create' | 'update'; issue_number: number | null; marker: string; version: number; title: string; body: string; expected_hash: string;
};
export type ConnectorIssue = { repo: string; number: number; url: string; title: string; body: string };
/** What a connector call can throw: `rejected` = the service definitively refused (nothing was created); anything else is an unknown outcome (timeout, network, ...). */
export class ConnectorError extends Error {
  constructor(readonly kind: 'rejected' | 'unknown', message: string = kind) { super(message); }
}
export interface Connector {
  create(a: { repo: string; title: string; body: string }): Promise<unknown>;
  update(a: { repo: string; number: number; title: string; body: string }): Promise<unknown>;
  /** Issues in `repo` whose body contains the exact marker. */
  search(a: { repo: string; marker: string }): Promise<unknown>;
  read(a: { repo: string; number: number }): Promise<unknown>;
}
export type Sha256Hex = (text: string) => string;

/** What goes to the server's report RPC (names match its parameters). */
export type ReportArgs = {
  p_outcome: 'created' | 'found' | 'updated' | 'none_found' | 'multiple' | 'uncertain' | 'failed';
  p_repo?: string | null; p_number?: number | null; p_url?: string | null; p_marker?: string | null; p_readback_hash?: string | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates the packet the private system issued (exactly the allowlisted fields, nothing else). */
export function parsePacket(v: unknown): TransferPacket | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v).sort().join();
  if (keys !== 'body,expected_hash,issue_number,marker,operation,repo,title,version') return null;
  const { repo, operation, issue_number, marker, version, title, body, expected_hash } = v as Record<string, unknown>;
  if (repo !== PUBLICATION_REPO || (operation !== 'create' && operation !== 'update')) return null;
  if (typeof marker !== 'string' || !MARKER.test(marker) || typeof expected_hash !== 'string' || !HASH.test(expected_hash)) return null;
  if (typeof title !== 'string' || typeof body !== 'string' || typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  if (operation === 'update' ? !(typeof issue_number === 'number' && Number.isInteger(issue_number) && issue_number >= 1) : issue_number !== null) return null;
  if (!body.endsWith(`Feedback reference: ${marker}`)) return null;
  return { repo, operation, issue_number: issue_number as number | null, marker, version, title, body, expected_hash };
}

/** GitHub may change line endings or add a trailing newline; nothing else may change. Mirrors what the server hashes. */
export const normalizeText = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
export const readbackHash = (title: string, body: string, sha: Sha256Hex): string => sha(`${normalizeText(title)}\u001e${normalizeText(body)}`);

/** Shape-checks a connector answer; anything malformed or from another repository is not an issue of ours. */
export function parseConnectorIssue(v: unknown): ConnectorIssue | null {
  if (!isObj(v)) return null;
  const { repo, number, url, title, body } = v as Record<string, unknown>;
  if (typeof repo !== 'string' || typeof number !== 'number' || !Number.isInteger(number) || number < 1 || typeof url !== 'string' || typeof title !== 'string' || typeof body !== 'string') return null;
  return { repo, number, url, title, body };
}

/** The evidence for a report, taken from what the connector actually returned (never from what we hoped for). */
export function evidenceFrom(outcome: 'created' | 'found' | 'updated', issue: ConnectorIssue, sha: Sha256Hex): ReportArgs {
  const m = MARKER_IN_BODY.exec(normalizeText(issue.body));
  return { p_outcome: outcome, p_repo: issue.repo, p_number: issue.number, p_url: issue.url, p_marker: m ? m[1] : null, p_readback_hash: readbackHash(issue.title, issue.body, sha) };
}

/** A local check of a read-back issue against the packet (the server re-checks everything; this tells the person early). */
export function verifyIssue(packet: TransferPacket, issue: ConnectorIssue, sha: Sha256Hex): { ok: true } | { ok: false; reason: string } {
  if (issue.repo !== PUBLICATION_REPO) return { ok: false, reason: 'wrong repository' };
  if (issue.url !== `https://github.com/${PUBLICATION_REPO}/issues/${issue.number}`) return { ok: false, reason: 'url does not match the issue number' };
  const m = MARKER_IN_BODY.exec(normalizeText(issue.body));
  if (!m || m[1] !== packet.marker) return { ok: false, reason: 'marker does not match' };
  if (packet.issue_number !== null && issue.number !== packet.issue_number) return { ok: false, reason: 'issue number does not match the recorded mapping' };
  if (readbackHash(issue.title, issue.body, sha) !== packet.expected_hash) return { ok: false, reason: 'text does not match the approved snapshot' };
  return { ok: true };
}

const unknownOutcome = (): ReportArgs => ({ p_outcome: 'uncertain' });

/**
 * RECONCILE: find out what exists for this marker WITHOUT creating anything. Zero matches -> `none_found` (a create may now be retried), exactly one ->
 * read it back and report it as `found` with its actual evidence, several -> `multiple` (fail closed), any failure to search or read -> `uncertain`.
 */
export async function reconcile(packetIn: unknown, connector: Connector, sha: Sha256Hex): Promise<ReportArgs> {
  const packet = parsePacket(packetIn);
  if (!packet) return unknownOutcome();
  let found: unknown;
  try { found = await connector.search({ repo: PUBLICATION_REPO, marker: packet.marker }); } catch { return unknownOutcome(); }
  if (!Array.isArray(found)) return unknownOutcome();
  // only issues of OUR destination that really carry the exact marker count as matches; a forged hit from elsewhere is never silently ignored as "none"
  const hits = found.map(parseConnectorIssue);
  if (hits.some((h) => h === null)) return unknownOutcome();
  const ours = (hits as ConnectorIssue[]).filter((h) => h.repo === PUBLICATION_REPO && h.body.includes(packet.marker));
  if (ours.length !== hits.length) return unknownOutcome();
  if (ours.length === 0) return { p_outcome: 'none_found' };
  if (ours.length > 1) return { p_outcome: 'multiple' };
  let back: unknown;
  const only = ours[0] as ConnectorIssue;
  try { back = await connector.read({ repo: PUBLICATION_REPO, number: only.number }); } catch { return unknownOutcome(); }
  const issue = parseConnectorIssue(back);
  return issue ? evidenceFrom('found', issue, sha) : unknownOutcome();
}

export type PublishOptions = {
  /** The previous attempt ended `uncertain` or `conflict`. */
  afterUncertain?: boolean;
  /** A reconciliation of that attempt returned `none_found`. Required before any further create. */
  reconciledNone?: boolean;
};
export type PublishResult = { report: ReportArgs; refused?: 'invalid-packet' | 'reconcile-first'; calls: number };

/**
 * TRANSFER: create (or update) through the connector, then READ IT BACK and report that evidence. A create after an uncertain attempt is refused unless
 * a reconciliation found nothing. The connector's create response is never trusted; the read-back is.
 */
export async function publish(packetIn: unknown, connector: Connector, sha: Sha256Hex, opts: PublishOptions = {}): Promise<PublishResult> {
  const packet = parsePacket(packetIn);
  if (!packet) return { report: unknownOutcome(), refused: 'invalid-packet', calls: 0 };
  if (packet.operation === 'create' && opts.afterUncertain && !opts.reconciledNone) return { report: unknownOutcome(), refused: 'reconcile-first', calls: 0 };
  let calls = 0;
  let answer: unknown;
  try {
    calls++;
    answer = packet.operation === 'create'
      ? await connector.create({ repo: PUBLICATION_REPO, title: packet.title, body: packet.body })
      : await connector.update({ repo: PUBLICATION_REPO, number: packet.issue_number as number, title: packet.title, body: packet.body });
  } catch (e) {
    return { report: e instanceof ConnectorError && e.kind === 'rejected' ? { p_outcome: 'failed' } : unknownOutcome(), calls };
  }
  const first = parseConnectorIssue(answer);
  if (!first) return { report: unknownOutcome(), calls };   // malformed: something may or may not exist; reconcile
  let back: unknown;
  try { calls++; back = await connector.read({ repo: PUBLICATION_REPO, number: first.number }); } catch { return { report: unknownOutcome(), calls }; }
  const issue = parseConnectorIssue(back);
  if (!issue) return { report: unknownOutcome(), calls };
  return { report: evidenceFrom(packet.operation === 'create' ? 'created' : 'updated', issue, sha), calls };
}
