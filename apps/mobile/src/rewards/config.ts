/**
 * Rewards progress is OFF in every normal build: the UI shows the honest "rewards coming soon" state and makes NO network call.
 * It turns on only for a clearly identified local test/mock build that sets EXPO_PUBLIC_REWARDS_PROGRESS=live (read at build time).
 * This flag changes nothing on the server; the server's own enabled/budget gates still decide whether any number exists.
 */
// The literal `process.env.EXPO_PUBLIC_*` access is required: Expo inlines only that exact form at build time.
export function rewardsProgressLive(env: Record<string, string | undefined> = { EXPO_PUBLIC_REWARDS_PROGRESS: process.env.EXPO_PUBLIC_REWARDS_PROGRESS }): boolean {
  return env.EXPO_PUBLIC_REWARDS_PROGRESS === 'live';
}
