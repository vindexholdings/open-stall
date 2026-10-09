import { focusRing } from '@open-stall/ui';
import { useCallback, useRef, useState } from 'react';

/**
 * Keyboard-focus visibility for Pressable controls (R1 shared foundation). Spread `handlers` on the
 * Pressable and add `style` to its style list; the outline shows only while the control has focus.
 */
export function useFocusStyle() {
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  return { handlers: { onFocus, onBlur }, style: focused ? focusRing : null };
}

/**
 * Enter activates links. react-native-web does not activate a Pressable with role=link from the keyboard, so a
 * focusable card or hint could be reached with Tab but never opened. (Space intentionally does nothing on a link.)
 */
export function enterActivates(onPress: () => void) {
  return {
    onKeyDown: (e: { key?: string; preventDefault?: () => void; nativeEvent?: { key?: string } }) => {
      const key = e.key ?? e.nativeEvent?.key;
      if (key === 'Enter') {
        e.preventDefault?.();
        onPress();
      }
    },
  };
}

/**
 * Space activates radios and checkboxes (Enter alone is not enough for ARIA radio/checkbox widgets).
 * react-native-web activates Pressables on Enter; this adds Space without double-firing.
 */
export function spaceActivates(onPress: () => void) {
  return {
    onKeyDown: (e: { key?: string; preventDefault?: () => void; nativeEvent?: { key?: string } }) => {
      const key = e.key ?? e.nativeEvent?.key;
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault?.();
        onPress();
      }
    },
  };
}

type KeyEvent = { key?: string; preventDefault?: () => void; nativeEvent?: { key?: string } };
type Focusable = { focus?: () => void } | null;

/**
 * Roving focus for a radio group (ARIA pattern): one Tab stop (the selected item, or the first when nothing
 * is selected); arrow keys move focus AND selection, wrapping at the ends. Web only in effect: native
 * screen readers move through radios with their own gestures and ignore tabIndex/key events.
 */
export function useRovingRadios(count: number, selectedIndex: number, select: (index: number) => void) {
  const nodes = useRef<Focusable[]>([]);
  const stop = selectedIndex >= 0 && selectedIndex < count ? selectedIndex : 0;
  return {
    tabIndex: (index: number): 0 | -1 => (index === stop ? 0 : -1),
    register: (index: number, el: Focusable) => {
      nodes.current[index] = el;
    },
    onArrowKey: (index: number, e: KeyEvent) => {
      const key = e.key ?? e.nativeEvent?.key;
      const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
      if (!step || count < 2) return;
      e.preventDefault?.();
      const next = (index + step + count) % count;
      select(next);
      nodes.current[next]?.focus?.();
    },
  };
}

/** Roving-focus wiring for one radio, as handed to Chip / Segment. */
export type Roving = { tabIndex: 0 | -1; register: (el: Focusable) => void; onArrowKey: (e: KeyEvent) => void };
