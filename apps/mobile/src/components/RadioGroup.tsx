import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Chip } from './Chip';
import { useRovingRadios } from './focus';

type Option<T> = { value: T; label: string };
type Props<T> = {
  /** Spoken name of the group. */
  label: string;
  options: readonly Option<T>[];
  value: T | null;
  onChange: (next: T) => void;
  /** Layout override (default wraps in a row). */
  style?: ViewStyle;
};

/** A group of mutually exclusive chips: radiogroup semantics, one Tab stop, arrow keys move selection. */
export function RadioGroup<T>({ label, options, value, onChange, style }: Props<T>) {
  const selectedIndex = options.findIndex((o) => o.value === value);
  const rove = useRovingRadios(options.length, selectedIndex, (i) => onChange(options[i]!.value));
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.row, style]}>
      {options.map((o, i) => (
        <Chip key={String(o.value)} role="radio" label={o.label} selected={i === selectedIndex} onPress={() => onChange(o.value)} roving={{ tabIndex: rove.tabIndex(i), register: (el) => rove.register(i, el), onArrowKey: (e) => rove.onArrowKey(i, e) }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
