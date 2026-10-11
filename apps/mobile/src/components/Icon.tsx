import { colors } from '@open-stall/ui';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

/**
 * Open Stall icon set. Drawn from plain Views (rounded bars, rings, rotated corners) on a 24-unit grid, so it needs no
 * font, no image, no SVG package and no license: it renders the same on web, iOS and Android, scales with `size`, and
 * recolors with `color`. Every icon is decorative: the visible text next to it (or the control's accessible name) always
 * carries the meaning, so icons are hidden from assistive technology.
 */
export type IconName =
  | 'search' | 'pin' | 'list' | 'map' | 'filter' | 'heart' | 'user' | 'plus' | 'check' | 'close' | 'info' | 'alert' | 'help' | 'chevron' | 'navigate' | 'compass';

type Props = { name: IconName; size?: number; color?: string; /** Color of cut-outs (the hole in a pin). Defaults to the surface color. */ inner?: string };

export function Icon({ name, size = 24, color = colors.text, inner = colors.surface }: Props) {
  const u = size / 24; // one grid unit
  const w = Math.max(1.5, 2 * u); // stroke weight
  const box: ViewStyle = { width: size, height: size };
  const bar = (x: number, y: number, len: number, rot = 0, thick = w): ViewStyle => ({
    position: 'absolute', left: x * u, top: y * u - thick / 2, width: len * u, height: thick, borderRadius: thick, backgroundColor: color, transform: [{ rotate: `${rot}deg` }],
  });
  const ring = (x: number, y: number, d: number, thick = w): ViewStyle => ({
    position: 'absolute', left: x * u, top: y * u, width: d * u, height: d * u, borderRadius: d * u, borderWidth: thick, borderColor: color,
  });
  const dot = (x: number, y: number, d: number, c = color): ViewStyle => ({
    position: 'absolute', left: x * u, top: y * u, width: d * u, height: d * u, borderRadius: d * u, backgroundColor: c,
  });
  let body: ReactElement | null = null;
  switch (name) {
    case 'search':
      body = (<><View style={ring(3, 3, 14)} /><View style={bar(14.2, 17.8, 8, 45)} /></>);
      break;
    case 'pin':
      body = (<>
        <View style={{ position: 'absolute', left: 5 * u, top: 2 * u, width: 14 * u, height: 14 * u, backgroundColor: color, borderRadius: 14 * u, borderBottomLeftRadius: 0, transform: [{ rotate: '-45deg' }] }} />
        <View style={dot(9, 6, 6, inner)} />
        <View style={bar(8.5, 21.2, 7)} />
      </>);
      break;
    case 'list':
      body = (<>
        <View style={dot(3, 5, 3)} /><View style={bar(8, 6.5, 13)} />
        <View style={dot(3, 10.5, 3)} /><View style={bar(8, 12, 13)} />
        <View style={dot(3, 16, 3)} /><View style={bar(8, 17.5, 13)} />
      </>);
      break;
    case 'map':
      body = (<>
        <View style={{ position: 'absolute', left: 2 * u, top: 4 * u, width: 20 * u, height: 16 * u, borderRadius: 3 * u, borderWidth: w, borderColor: color }} />
        <View style={{ position: 'absolute', left: 8.5 * u, top: 4 * u, width: w, height: 16 * u, backgroundColor: color }} />
        <View style={{ position: 'absolute', left: 14.5 * u, top: 4 * u, width: w, height: 16 * u, backgroundColor: color }} />
      </>);
      break;
    case 'filter':
      body = (<>
        <View style={bar(3, 6, 18)} /><View style={dot(14, 3.5, 5, color)} /><View style={dot(15.2, 4.7, 2.6, inner)} />
        <View style={bar(3, 12, 18)} /><View style={dot(5, 9.5, 5, color)} /><View style={dot(6.2, 10.7, 2.6, inner)} />
        <View style={bar(3, 18, 18)} /><View style={dot(11, 15.5, 5, color)} /><View style={dot(12.2, 16.7, 2.6, inner)} />
      </>);
      break;
    case 'heart':
      body = (<>
        <View style={dot(3.2, 4.2, 9.2)} /><View style={dot(11.6, 4.2, 9.2)} />
        <View style={{ position: 'absolute', left: 5.9 * u, top: 7.4 * u, width: 12.2 * u, height: 12.2 * u, backgroundColor: color, borderBottomRightRadius: 2.2 * u, transform: [{ rotate: '45deg' }] }} />
      </>);
      break;
    case 'user':
      body = (<>
        <View style={ring(7.5, 2.5, 9)} />
        <View style={{ position: 'absolute', left: 3.5 * u, top: 14 * u, width: 17 * u, height: 8 * u, borderTopLeftRadius: 9 * u, borderTopRightRadius: 9 * u, borderWidth: w, borderBottomWidth: 0, borderColor: color }} />
      </>);
      break;
    case 'plus':
      body = (<><View style={bar(4, 12, 16)} /><View style={bar(4, 12, 16, 90)} /></>);
      break;
    case 'check':
      body = <View style={{ position: 'absolute', left: 8.5 * u, top: 3.5 * u, width: 7 * u, height: 14 * u, borderRightWidth: w * 1.15, borderBottomWidth: w * 1.15, borderColor: color, transform: [{ rotate: '45deg' }] }} />;
      break;
    case 'close':
      body = (<><View style={bar(4.5, 12, 15, 45)} /><View style={bar(4.5, 12, 15, -45)} /></>);
      break;
    case 'info':
      body = (<><View style={ring(2, 2, 20)} /><View style={dot(10.7, 6.3, 2.8)} /><View style={{ position: 'absolute', left: 10.9 * u, top: 10.5 * u, width: 2.2 * u, height: 7 * u, borderRadius: 2 * u, backgroundColor: color }} /></>);
      break;
    case 'alert':
      body = (<><View style={ring(2, 2, 20)} /><View style={{ position: 'absolute', left: 10.9 * u, top: 6.2 * u, width: 2.2 * u, height: 7 * u, borderRadius: 2 * u, backgroundColor: color }} /><View style={dot(10.7, 15.4, 2.8)} /></>);
      break;
    case 'help':
      body = (<><View style={ring(2, 2, 20)} /><Text style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, textAlign: 'center', textAlignVertical: 'center', lineHeight: size, fontSize: 13 * u, fontWeight: '700', color }}>?</Text></>);
      break;
    case 'chevron':
      body = <View style={{ position: 'absolute', left: 6.5 * u, top: 7 * u, width: 9 * u, height: 9 * u, borderRightWidth: w, borderTopWidth: w, borderColor: color, transform: [{ rotate: '45deg' }] }} />;
      break;
    case 'navigate':
      body = <View style={{ position: 'absolute', left: 4 * u, top: 3 * u, width: 0, height: 0, borderLeftWidth: 8 * u, borderRightWidth: 8 * u, borderBottomWidth: 18 * u, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color, transform: [{ rotate: '45deg' }, { translateX: 2 * u }] }} />;
      break;
    case 'compass':
      body = (<><View style={ring(2, 2, 20)} /><View style={{ position: 'absolute', left: 8.2 * u, top: 6.5 * u, width: 0, height: 0, borderLeftWidth: 3.8 * u, borderRightWidth: 3.8 * u, borderBottomWidth: 11 * u, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color, transform: [{ rotate: '35deg' }] }} /></>);
      break;
  }
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.base, box]}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({ base: { overflow: 'visible' } });
