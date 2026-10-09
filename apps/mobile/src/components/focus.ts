import { focusRing } from '@open-stall/ui';
import { useCallback, useState } from 'react';

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
