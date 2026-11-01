/**
 * App feedback (bugs, usability problems, suggestions), CLIENT side. This is deliberately separate from restroom reports and corrections.
 * The server (public.submit_feedback and friends) is the only authority: every rule here mirrors a server rule so people get fast, kind
 * messages, but nothing here is trusted. Feedback is untrusted DATA everywhere it is shown: it is rendered as plain text, never as markup.
 */
export type FeedbackKind = 'bug' | 'usability' | 'suggestion';
export type FeedbackScreen = 'nearby' | 'map' | 'list' | 'location_detail' | 'favorites' | 'account' | 'settings' | 'add_restroom' | 'report' | 'sign_in' | 'other';
export type FeedbackFrequency = 'once' | 'sometimes' | 'often' | 'always';
export type FeedbackImpact = 'minor' | 'moderate' | 'blocking';
export type FeedbackStatus = 'received' | 'reviewing' | 'planned' | 'in_progress' | 'resolved' | 'closed' | 'duplicate';

export const FEEDBACK_KINDS: readonly { value: FeedbackKind; label: string }[] = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'usability', label: 'Hard to use' },
  { value: 'suggestion', label: 'An idea' },
];
export const FEEDBACK_SCREENS: readonly { value: FeedbackScreen; label: string }[] = [
  { value: 'nearby', label: 'Nearby restrooms' }, { value: 'map', label: 'Map' }, { value: 'list', label: 'List' }, { value: 'location_detail', label: 'Restroom details' },
  { value: 'favorites', label: 'Favorites' }, { value: 'account', label: 'Account' }, { value: 'settings', label: 'Settings' }, { value: 'add_restroom', label: 'Add a restroom' },
  { value: 'report', label: 'Report a problem' }, { value: 'sign_in', label: 'Sign in' }, { value: 'other', label: 'Something else' },
];
export const FEEDBACK_FREQUENCIES: readonly { value: FeedbackFrequency | null; label: string }[] = [
  { value: null, label: 'Not sure' }, { value: 'once', label: 'Once' }, { value: 'sometimes', label: 'Sometimes' }, { value: 'often', label: 'Often' }, { value: 'always', label: 'Always' },
];
export const FEEDBACK_IMPACTS: readonly { value: FeedbackImpact | null; label: string }[] = [
  { value: null, label: 'Not sure' }, { value: 'minor', label: 'Minor' }, { value: 'moderate', label: 'Moderate' }, { value: 'blocking', label: 'Blocks me' },
];
export const FEEDBACK_LIMITS = { title: { min: 5, max: 100 }, description: { min: 10, max: 2000 }, expected: 500, actual: 500, steps: 1000 } as const;
export const FEEDBACK_PRIVACY_NOTE =
  'Please don’t include names, e-mail addresses, phone numbers, links, addresses or exact places. We can’t read your location or device from this form, and nothing is attached.';

export type FeedbackDraft = {
  kind: FeedbackKind | null; screen: FeedbackScreen | null; title: string; description: string;
  expected: string; actual: string; steps: string; frequency: FeedbackFrequency | null; impact: FeedbackImpact | null;
};
export const EMPTY_FEEDBACK: FeedbackDraft = { kind: null, screen: null, title: '', description: '', expected: '', actual: '', steps: '', frequency: null, impact: null };

/** The same rules the server enforces: no markup, links, e-mail addresses, phone numbers, precise coordinates, control characters or long token-like strings. */
export function feedbackTextProblem(t: string): string | null {
  if (/[<>]/.test(t)) return 'Please remove symbols like < and >.';
  if (/[a-z0-9_.+-]+@[a-z0-9-]+/i.test(t)) return 'Please remove e-mail addresses.';
  if (/[A-Za-z0-9_+/=-]{32,}/.test(t)) return 'Please remove long codes or keys.';
  if (/(https?:|www\.|:\/\/)/i.test(t) || /[a-z0-9-]+\.(com|net|org|io|dev|app|co|us|edu|gov|ly|me)([^a-z]|$)/i.test(t)) return 'Please remove links and web addresses.';
  if (/[(]?\d{3}[)]?[ .-]?\d{3}[ .-]?\d{4}/.test(t) || /[+]\d[\d ().-]{7,}\d/.test(t) || /\d{10,}/.test(t)) return 'Please remove phone numbers.';
  if (/-?\d{1,3}\.\d{4,}/.test(t)) return 'Please remove exact coordinates.';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) return 'Please remove unusual control characters.';
  return null;
}

export type FeedbackFieldError = { field: keyof FeedbackDraft; message: string };
export function validateFeedbackDraft(d: FeedbackDraft): FeedbackFieldError[] {
  const out: FeedbackFieldError[] = [];
  const t = d.title.trim(); const desc = d.description.trim();
  if (!d.kind) out.push({ field: 'kind', message: 'Choose what kind of feedback this is.' });
  if (!d.screen) out.push({ field: 'screen', message: 'Choose where in the app this happened.' });
  if (t.length < FEEDBACK_LIMITS.title.min || t.length > FEEDBACK_LIMITS.title.max) out.push({ field: 'title', message: `Give it a short title (${FEEDBACK_LIMITS.title.min} to ${FEEDBACK_LIMITS.title.max} characters).` });
  else { const p = feedbackTextProblem(t); if (p) out.push({ field: 'title', message: p }); }
  if (desc.length < FEEDBACK_LIMITS.description.min || desc.length > FEEDBACK_LIMITS.description.max) out.push({ field: 'description', message: `Describe it in ${FEEDBACK_LIMITS.description.min} to ${FEEDBACK_LIMITS.description.max} characters.` });
  else { const p = feedbackTextProblem(desc); if (p) out.push({ field: 'description', message: p }); }
  for (const [f, max] of [['expected', FEEDBACK_LIMITS.expected], ['actual', FEEDBACK_LIMITS.actual], ['steps', FEEDBACK_LIMITS.steps]] as const) {
    const v = d[f].trim();
    if (v.length > max) out.push({ field: f, message: `Keep this to ${max} characters.` });
    else if (v) { const p = feedbackTextProblem(v); if (p) out.push({ field: f, message: p }); }
  }
  return out;
}

// ------------------------------------------------------------------ diagnostics: an ALLOWLIST of exactly two values, shown before sending
export type FeedbackDiagnostics = { appVersion: string | null; platform: 'ios' | 'android' | 'web' | null };
export function feedbackDiagnostics(os: string, version: string | undefined | null): FeedbackDiagnostics {
  return {
    platform: os === 'ios' || os === 'android' || os === 'web' ? os : null,
    appVersion: typeof version === 'string' && /^[0-9]{1,3}([.][0-9]{1,3}){0,3}$/.test(version) ? version : null,
  };
}
/** The exact technical details that will be sent, in plain words. */
export function diagnosticsLines(d: FeedbackDiagnostics): string[] {
  return [`App version: ${d.appVersion ?? 'not shared'}`, `Device type: ${d.platform === 'ios' ? 'iPhone or iPad' : d.platform === 'android' ? 'Android' : d.platform === 'web' ? 'Web browser' : 'not shared'}`];
}

/** A fresh retry key (16 to 64 characters of letters, digits, `_` and `-`). The same key is reused for an exact retry of the same content. */
export function newFeedbackKey(randomHex: string): string {
  const h = randomHex.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 40);
  return `fb-${h.padEnd(16, '0')}`;
}

// ------------------------------------------------------------------ responses (untrusted)
export type FeedbackListItem = { id: string; kind: FeedbackKind; screen: FeedbackScreen; title: string; status: FeedbackStatus; outcome: string; createdAt: string; updatedAt: string };
export type FeedbackDetail = FeedbackListItem & {
  description: string; expected: string | null; actual: string | null; steps: string | null; frequency: FeedbackFrequency | null; impact: FeedbackImpact | null;
  appVersion: string | null; platform: string | null; timeline: { status: FeedbackStatus; at: string }[];
};
const KINDS = ['bug', 'usability', 'suggestion']; const SCREENS = FEEDBACK_SCREENS.map((s) => s.value as string);
const STATUSES = ['received', 'reviewing', 'planned', 'in_progress', 'resolved', 'closed', 'duplicate'];
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+[+-][0-9]{2}(:[0-9]{2})?[|][0-9a-f-]{36}$/;

function parseListItem(v: unknown): FeedbackListItem | null {
  const r = rec(v);
  if (!r || typeof r.id !== 'string' || !UUID.test(r.id) || !KINDS.includes(r.kind as string) || !SCREENS.includes(r.screen as string) || !STATUSES.includes(r.status as string)) return null;
  const title = str(r.title, 100); const outcome = str(r.outcome, 120); const createdAt = str(r.created_at, 40); const updatedAt = str(r.updated_at, 40);
  if (!title || !outcome || !createdAt || !updatedAt) return null;
  return { id: r.id, kind: r.kind as FeedbackKind, screen: r.screen as FeedbackScreen, title, status: r.status as FeedbackStatus, outcome, createdAt, updatedAt };
}
export function parseFeedbackList(data: unknown): { items: FeedbackListItem[]; nextCursor: string | null } | null {
  const d = rec(data);
  if (!d || !Array.isArray(d.items) || d.items.length > 20) return null;
  const items: FeedbackListItem[] = [];
  for (const raw of d.items) { const i = parseListItem(raw); if (!i) return null; items.push(i); }
  const next = d.next_cursor;
  if (next !== null && next !== undefined && (typeof next !== 'string' || !CURSOR.test(next))) return null;
  return { items, nextCursor: typeof next === 'string' ? next : null };
}
export function parseFeedbackDetail(data: unknown): FeedbackDetail | null {
  const r = rec(data);
  const base = r ? parseListItem(r) : null;
  const description = r ? str(r.description, 2000) : null;
  if (!r || !base || !description || !Array.isArray(r.timeline) || r.timeline.length > 20) return null;
  const timeline: { status: FeedbackStatus; at: string }[] = [];
  for (const t of r.timeline) { const x = rec(t); const at = x ? str(x.at, 40) : null; if (!x || !at || !STATUSES.includes(x.status as string)) return null; timeline.push({ status: x.status as FeedbackStatus, at }); }
  const fr = r.frequency; const im = r.impact;
  return { ...base, description, expected: str(r.expected, 500), actual: str(r.actual, 500), steps: str(r.steps, 1000),
    frequency: ['once', 'sometimes', 'often', 'always'].includes(fr as string) ? (fr as FeedbackFrequency) : null,
    impact: ['minor', 'moderate', 'blocking'].includes(im as string) ? (im as FeedbackImpact) : null,
    appVersion: str(r.app_version, 20), platform: str(r.platform, 10), timeline };
}
export function parseSubmitResult(data: unknown): { id: string; replayed: boolean } | null {
  const r = rec(data);
  return r && typeof r.id === 'string' && UUID.test(r.id) ? { id: r.id, replayed: r.replayed === true } : null;
}

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  received: 'Received', reviewing: 'Being reviewed', planned: 'Planned', in_progress: 'In progress', resolved: 'Addressed', closed: 'Closed', duplicate: 'Already reported',
};
/** Kind, kind-safe wording for a failed send. Server messages are our own, but only a known set is shown. */
export function feedbackErrorMessage(e: { code?: string; message?: string; status?: number } | null): string {
  const code = e?.code ?? '';
  if (code === '53400') return 'You have sent a lot of feedback recently. Please try again a little later.';
  if (code === '28000') return 'Please sign in to send feedback.';
  if (code === '22023') return 'Something in the form wasn’t accepted. Please check the details and remove any links, e-mail addresses, phone numbers or exact places.';
  return 'We couldn’t send that. Please try again.';
}
