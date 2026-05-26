/**
 * Host des toasts globaux. A rendre une fois dans le root layout.
 *
 * Utilise le Snackbar de RN Paper avec un style different selon le type
 * (success vert, info neutre, error rouge).
 */
import { type ToastType, useToast } from '@/stores/toast';
import { StyleSheet } from 'react-native';
import { type MD3Theme, Snackbar, Text, useTheme } from 'react-native-paper';

export function ToastHost() {
  const theme = useTheme();
  const current = useToast((s) => s.current);
  const hide = useToast((s) => s.hide);

  // Couleurs selon le type
  const type = current?.type ?? 'info';
  const bg = bgFor(type, theme);
  const onBg = onBgFor(type, theme);

  return (
    <Snackbar
      visible={!!current}
      onDismiss={hide}
      duration={current?.duration ?? 3000}
      // key sur l'id pour qu'un nouveau toast ne soit pas confondu avec
      // l'ancien (sinon le auto-hide du precedent stop le nouveau).
      key={current?.id ?? 'empty'}
      style={[styles.snackbar, { backgroundColor: bg }]}
      action={
        current?.action
          ? {
              label: current.action.label,
              onPress: () => {
                current.action?.onPress();
                hide();
              },
              textColor: onBg,
            }
          : undefined
      }
    >
      <Text variant="bodyMedium" style={{ color: onBg }}>
        {current?.message ?? ''}
      </Text>
    </Snackbar>
  );
}

function bgFor(type: ToastType, theme: MD3Theme): string {
  switch (type) {
    case 'success':
      return theme.colors.primaryContainer;
    case 'error':
      return theme.colors.errorContainer;
    default:
      return theme.colors.inverseSurface;
  }
}

function onBgFor(type: ToastType, theme: MD3Theme): string {
  switch (type) {
    case 'success':
      return theme.colors.onPrimaryContainer;
    case 'error':
      return theme.colors.onErrorContainer;
    default:
      return theme.colors.inverseOnSurface;
  }
}

const styles = StyleSheet.create({
  snackbar: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
});
