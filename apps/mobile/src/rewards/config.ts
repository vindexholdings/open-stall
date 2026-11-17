/**
 * Rewards progress is OFF in every normal build: the UI shows the honest "rewards coming soon" state and makes NO network call.
 * It can turn on only in a build that is demonstrably the synthetic LOCAL MOCK configuration, and the check fails closed:
 *   1. EXPO_PUBLIC_REWARDS_PROGRESS must be exactly `live`, AND
 *   2. the configured Supabase URL must be plain `http:` on a loopback host (127.0.0.1, localhost, [::1]), the project's mock/QA convention, AND
 *   3. the anon key must be one of the project's placeholder keys (`mock-anon-key-not-real` in the e2e suites, `qa-mock-anon-key` in the QA kit).
 * A hosted project URL (https, any other host) or a real-looking key therefore keeps the feature disabled even with the flag set. Hosted
 * activation is a separate, future gate; nothing here touches the server's own reward settings.
 */
export type RewardsEnv = { flag: string | undefined; url: string | undefined; key: string | undefined };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MOCK_KEYS = new Set(['mock-anon-key-not-real', 'qa-mock-anon-key']);

export function rewardsProgressLive(env: RewardsEnv = readEnv()): boolean {
  if (env.flag !== 'live' || !env.url || !env.key || !MOCK_KEYS.has(env.key)) return false;
  try {
    const u = new URL(env.url);
    return u.protocol === 'http:' && LOOPBACK.has(u.hostname) && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

// The literal `process.env.EXPO_PUBLIC_*` accesses are required: Expo inlines only that exact form at build time.
function readEnv(): RewardsEnv {
  return { flag: process.env.EXPO_PUBLIC_REWARDS_PROGRESS, url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY };
}
