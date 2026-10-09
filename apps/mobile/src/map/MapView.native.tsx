import { colors } from '@open-stall/ui';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { DEFAULT_ZOOM, tileConfig } from './config';
import { buildLeafletHtml, parseSelectMessage } from './leafletHtml';
import type { MapViewProps } from './types';

export function MapView({ center, userLocation, markers, onSelectMarker, height = 280 }: MapViewProps) {
  const html = useMemo(
    () =>
      buildLeafletHtml({ center, userLocation, markers }, tileConfig, DEFAULT_ZOOM, {
        marker: colors.primaryStrong,
        selected: colors.accentStrong,
        unverified: colors.status.unverified.fg,
        user: colors.text,
      }),
    [center, userLocation, markers],
  );

  return (
    <View
      style={[styles.container, { height }]}
      accessible
      accessibilityLabel="Map of nearby restrooms. The results list has the same restrooms."
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        onMessage={(e) => {
          const id = parseSelectMessage(e.nativeEvent.data);
          if (id) onSelectMarker?.(id);
        }}
        onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('data:') || req.url.startsWith('https://')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
});
