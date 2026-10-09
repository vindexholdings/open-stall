import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text } from 'react-native';
import { type Roving, spaceActivates, useFocusStyle } from './focus';

type Common = {
  label: string;
  onPress: () => void;
  /** Overrides the spoken name when the visible label alone is not enough. */
  accessibilityLabel?: string;
};
type Choice = Common & {
  selected: boolean;
  /** 'checkbox' = independent toggle; 'radio' = one-of-many (use inside a RadioGroup). */
  role?: 'checkbox' | 'radio';
  /** Roving-focus wiring supplied by RadioGroup / useRovingRadios. */
  roving?: Roving;
};
type Action = Common & {
  /** An action, not a choice: exposes role=button and no checked state. */
  role: 'button';
  /** Disclosure toggles expose their expanded state. */
  expanded?: boolean;
  /** Visual emphasis only (for example while a disclosure is open). Never announced as "checked". */
  emphasized?: boolean;
};
type Props = Choice | Action;

export function Chip(props: Props) {
  const focus = useFocusStyle();
  const { label, onPress, accessibilityLabel } = props;
  if (props.role === 'button') {
    return (
      <Pressable
        accessibilityRole="button"
        aria-expanded={props.expanded}
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={onPress}
        {...focus.handlers}
        style={[styles.chip, props.emphasized && styles.selected, focus.style]}
      >
        <Text style={[styles.label, props.emphasized && styles.selectedLabel]}>{label}</Text>
      </Pressable>
    );
  }
  const { selected, role = 'checkbox', roving } = props;
  const space = spaceActivates(onPress);
  const keyProps = {
    onKeyDown: (e: Parameters<typeof space.onKeyDown>[0]) => {
      space.onKeyDown(e);
      roving?.onArrowKey(e);
    },
  };
  return (
    <Pressable
      ref={(el: never) => roving?.register(el)}
      accessibilityRole={role}
      aria-checked={selected}
      tabIndex={roving?.tabIndex}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      {...focus.handlers}
      {...keyProps}
      style={[styles.chip, selected && styles.selected, focus.style]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.primaryStrong, borderColor: colors.primaryStrong },
  label: { ...typography.label, color: colors.text },
  selectedLabel: { color: colors.onPrimaryStrong },
});
