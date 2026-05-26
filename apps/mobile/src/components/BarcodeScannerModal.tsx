import { useBarcodeLookup } from '@/hooks/useIngredients';
import type { Ingredient } from '@mealendar/shared';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, IconButton, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export type BarcodeScannerModalProps = {
  visible: boolean;
  onDismiss: () => void;
  onResolved: (ingredient: Ingredient) => void;
};

/**
 * Modal plein-ecran qui scanne les codes-barres et appelle l'API
 * pour resoudre l'ingredient (DB locale ou Open Food Facts).
 */
export function BarcodeScannerModal({ visible, onDismiss, onResolved }: BarcodeScannerModalProps) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const lookup = useBarcodeLookup();
  const [scannedEan, setScannedEan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScanned = async (ean: string) => {
    if (scannedEan) return; // anti-rebond
    setScannedEan(ean);
    setError(null);
    try {
      const res = await lookup.mutateAsync(ean);
      if (res.found && res.ingredient) {
        onResolved(res.ingredient);
        onDismiss();
        // reset pour la prochaine ouverture
        setTimeout(() => setScannedEan(null), 500);
        return;
      }
      setError(`Produit ${ean} introuvable dans Open Food Facts.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur reseau');
    }
  };

  const close = () => {
    setScannedEan(null);
    setError(null);
    onDismiss();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={[styles.safe, { backgroundColor: '#000' }]} edges={['top']}>
        <View style={styles.headerRow}>
          <IconButton icon="close" iconColor="#fff" size={24} onPress={close} />
          <Text style={styles.headerTitle}>Scanner un produit</Text>
          <View style={{ width: 40 }} />
        </View>

        {!permission ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.permText}>
              L'application a besoin de la camera pour scanner les codes-barres.
            </Text>
            <Button mode="contained" onPress={requestPermission} style={{ marginTop: 16 }}>
              Autoriser la camera
            </Button>
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
              }}
              onBarcodeScanned={
                scannedEan
                  ? undefined
                  : ({ data }) => {
                      if (data) void handleScanned(data);
                    }
              }
            />
            {/* Overlay viseur */}
            <View style={styles.overlay}>
              <View style={[styles.viewfinder, { borderColor: theme.colors.primary }]} />
            </View>
          </View>
        )}

        {(scannedEan || error) && (
          <Surface elevation={0} style={[styles.statusBar, { backgroundColor: '#FFFFFFEE' }]}>
            {lookup.isPending && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" />
                <Text>Lecture du code-barres {scannedEan}...</Text>
              </View>
            )}
            {error && (
              <View style={styles.statusRow}>
                <Text style={{ color: theme.colors.error, flex: 1 }}>{error}</Text>
                <Button compact mode="text" onPress={() => setScannedEan(null)}>
                  Reessayer
                </Button>
              </View>
            )}
          </Surface>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  permText: { color: '#fff', textAlign: 'center' },
  cameraWrap: { flex: 1, position: 'relative' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    width: '70%',
    height: 160,
    borderWidth: 3,
    borderRadius: 16,
  },
  statusBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    padding: 12,
    borderRadius: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
