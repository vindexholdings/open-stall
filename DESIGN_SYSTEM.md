# Design
Fast, friendly, trustworthy map utility. Playful, not childish.
Primary blue #1E90FF; teal #00B3A6; light neutral surfaces. Accessible semantic status tokens.
Rounded cards/buttons, large targets, strong hierarchy, high contrast, minimal urgent-use steps.
Plain/Risqué changes copy/rating visuals, not information architecture/accessibility.
Home must answer quickly: where am I; nearest usable restroom; distance/time; can I use it; navigate.
Location detail prioritizes name/address, distance/ETA, rating, verification, key/purchase/accessibility, amenities/issues, Navigate, Report/Correct, Favorite.
No user-uploaded photos.

## R1 shared foundation (consumer redesign milestone, 2026-10-09)
Direction: calm, high-contrast utility. One column on phones, list + map side by side from 900 px. Answer first (nearest usable restroom, distance, walk time, can I use it), explain second. Every state (asking, locating, denied, loading, offline, error, empty, filtered-empty) is a plain-language banner with exactly one next step. Discovery never asks for an account.

Tokens (`packages/ui/src/tokens.ts`, contrast enforced in `tokens.test.ts`): `colors`, `spacing`, `radii`, `typography`, `touchTarget` (48 dp minimum, 56 primary), plus new `breakpoints`/`layout`/`layoutFor` (responsive), `focusRing` (3 dp outline in strong blue, offset 2; >= 3:1 against all surfaces) and `tones` (info/success/warning/danger text+background pairs, each with a symbol so tone is never color alone). Brand blue #1E90FF is for fills and large graphics only; text and white-on-color use the Strong variants.

Components (`apps/mobile/src/components`): `Screen` (safe areas, max width 1120, h1 title + subtitle), `StatusBanner` (tone, title, message, actions; `urgent` = alert, otherwise polite status), `SegmentedControl` (one radio group, e.g. List | Map), `Chip`, `PrimaryButton`, `SecondaryButton`, result cards in `LocationList` (name heading, distance + walk time, badge, only-known facts, community rating, "Nearest" label), `FilterPanel` (disclosure + always-visible removable active-filter chips + Clear all), `focus.ts` (`useFocusStyle` visible keyboard focus, `spaceActivates` Space for radios/checkboxes).

Accessibility rules adopted: state is exposed with `aria-checked` / `aria-selected` / `aria-expanded` / `aria-disabled` (react-native-web does NOT translate `accessibilityState`, so Chips and toggles previously exposed no state on the web: fixed); list rows are `role=list`/`listitem` containing a link; one level-1 heading per screen; every control has an accessible name and is >= 48 px tall; no horizontal scroll at 320 px; unknown facts are never displayed as negatives; ratings are always labeled "Community rating".
