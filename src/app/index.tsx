import { useState, useEffect, useCallback } from "react";
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,

  Alert,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { File, Directory, Paths } from "expo-file-system";
import { useOCR, OCR_ENGLISH } from "react-native-executorch";
import { Link } from "expo-router";

interface Invoice {
  id: string;
  name: string;
  uri: string;
  addedAt: number;
  size?: number;
}

const invoicesDir = new Directory(Paths.document, "invoices");
const invoicesIndexFile = new File(Paths.document, "invoices_index.json");

async function ensureInvoicesDir() {
  if (!invoicesDir.exists) {
    invoicesDir.create();
  }
}

async function loadIndex(): Promise<Invoice[]> {
  try {
    if (!invoicesIndexFile.exists) return [];
    const raw = await invoicesIndexFile.text();
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveIndex(invoices: Invoice[]) {
  invoicesIndexFile.write(JSON.stringify(invoices));
}

export default function Index() {
  const [started, setStarted] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [picking, setPicking] = useState(false);
  const ocr = useOCR({ model: OCR_ENGLISH, preventLoad: !started });

  useEffect(() => {
    ensureInvoicesDir();
    loadIndex().then(setInvoices);
  }, []);

  const pickInvoices = useCallback(async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        setPicking(false);
        return;
      }

      ensureInvoicesDir();
      const current = await loadIndex();
      const newInvoices: Invoice[] = [];

      for (const asset of result.assets) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const dest = new File(invoicesDir, `${id}.pdf`);
        const src = new File(asset.uri);
        src.copy(dest);
        newInvoices.push({
          id,
          name: asset.name,
          uri: dest.uri,
          addedAt: Date.now(),
          size: asset.size ?? undefined,
        });
      }

      const updated = [...current, ...newInvoices];
      saveIndex(updated);
      setInvoices(updated);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to pick documents");
    } finally {
      setPicking(false);
    }
  }, []);

  const removeInvoice = useCallback(
    async (id: string) => {
      const updated = invoices.filter((inv) => inv.id !== id);
      const toRemove = invoices.find((inv) => inv.id === id);
      if (toRemove) {
        try {
          const f = new File(toRemove.uri);
          if (f.exists) f.delete();
        } catch {}
      }
      saveIndex(updated);
      setInvoices(updated);
    },
    [invoices]
  );

  const confirmRemove = (inv: Invoice) => {
    Alert.alert("Remove invoice", `Remove "${inv.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeInvoice(inv.id) },
    ]);
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusText = !started
    ? "Tap below to load OCR model"
    : ocr.error
      ? `Error: ${ocr.error.message}`
      : ocr.isReady
        ? "Model loaded and ready!"
        : `Downloading model... ${Math.round(ocr.downloadProgress * 100)}%`;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.dashboardContainer}>
          <View style={styles.dashboardHeader}>
            <Text style={styles.dashboardTitle}>
              Tax<Text style={styles.titleAccent}>AI</Text>
            </Text>
            <Text style={styles.subtitle}>Hybrydowe Rozliczenia Podatkowe</Text>
          </View>

          <View style={styles.content}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.neonDot} />
                <Text style={styles.cardTitle}>Rok Podatkowy 2025</Text>
              </View>
              <Text style={styles.cardDesc}>
                Twój asystent wykorzysta lokalne modele (Gemma 3 on-device) do
                ocenzurowania prywatnych danych z faktur, a następnie
                bezpiecznie powierzy obliczenia chmurze (Gemini API).
              </Text>

              <Link href="/upload" asChild>
                <Pressable style={styles.dashboardButton}>
                  <Text style={styles.dashboardButtonText}>Wgraj Dokumenty (Nowy Ekran)</Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </View>

        <View style={styles.scannerContainer}>
          <Text style={styles.scannerTitle}>Moduł skanera (z OCR)</Text>

          {/* OCR status */}
          <Text style={styles.status}>{statusText}</Text>

          {!started && (
            <TouchableOpacity
              style={styles.scannerButton}
              onPress={() => setStarted(true)}
            >
              <Text style={styles.scannerButtonText}>Załaduj model OCR</Text>
            </TouchableOpacity>
          )}

          {started && !ocr.isReady && !ocr.error && (
            <ActivityIndicator size="large" color="#8B5CF6" />
          )}

          {ocr.isReady && (
            <View style={styles.successBadge}>
              <Text style={styles.successText}>Model OCR gotowy</Text>
            </View>
          )}

          {/* Add invoices button */}
          <TouchableOpacity
            style={[styles.scannerButton, styles.addButton]}
            onPress={pickInvoices}
            disabled={picking}
          >
            {picking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.scannerButtonText}>+ Dodaj Faktury</Text>
            )}
          </TouchableOpacity>

          {/* Invoice list */}
          {invoices.length > 0 && (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Twoje Faktury ({invoices.length})</Text>
              {invoices.map((inv) => (
                <TouchableOpacity
                  key={inv.id}
                  style={styles.invoiceRow}
                  onLongPress={() => confirmRemove(inv)}
                >
                  <View style={styles.pdfIcon}>
                    <Text style={styles.pdfIconText}>PDF</Text>
                  </View>
                  <View style={styles.invoiceInfo}>
                    <Text style={styles.invoiceName} numberOfLines={1}>
                      {inv.name}
                    </Text>
                    <Text style={styles.invoiceMeta}>
                      {new Date(inv.addedAt).toLocaleDateString("pl-PL")}
                      {inv.size ? `  •  ${formatSize(inv.size)}` : ""}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {invoices.length === 0 && (
            <Text style={styles.emptyText}>
              Nie dodano jeszcze żadnych faktur. Kliknij powyżej aby z OCR zaczytać PDF z urządzenia.
            </Text>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  root: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  dashboardContainer: {
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  dashboardHeader: {
    marginBottom: 40,
  },
  dashboardTitle: {
    fontSize: 42,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -1,
  },
  titleAccent: {
    color: "#8B5CF6", // Purple neon accent for AI
  },
  subtitle: {
    fontSize: 16,
    color: "#A1A1AA",
    marginTop: 8,
    fontWeight: "500",
  },
  content: {
    width: "100%",
  },
  card: {
    backgroundColor: "#171717",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#262626",
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  neonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#8B5CF6",
    marginRight: 10,
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  cardDesc: {
    fontSize: 15,
    color: "#D4D4D8",
    lineHeight: 22,
    marginBottom: 24,
  },
  dashboardButton: {
    backgroundColor: "#8B5CF6",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  dashboardButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  /* SCANNER STYLES */
  scannerContainer: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#262626",
  },
  scannerTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 20,
    color: "#FFFFFF",
  },
  status: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: "center",
    color: "#A1A1AA",
  },
  scannerButton: {
    backgroundColor: "#3B82F6",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
    minWidth: 200,
    alignItems: "center",
  },
  addButton: {
    backgroundColor: "#10B981",
    marginTop: 24,
  },
  scannerButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  successBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    padding: 12,
    borderRadius: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  successText: {
    color: "#34D399",
    fontSize: 14,
    fontWeight: "600",
  },
  listSection: {
    width: "100%",
    marginTop: 24,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
    color: "#E4E4E7",
  },
  invoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#171717",
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#262626",
  },
  pdfIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  pdfIconText: {
    color: "#F87171",
    fontSize: 12,
    fontWeight: "800",
  },
  invoiceInfo: {
    flex: 1,
  },
  invoiceName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#F4F4F5",
  },
  invoiceMeta: {
    fontSize: 12,
    color: "#A1A1AA",
    marginTop: 2,
  },
  emptyText: {
    marginTop: 32,
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    lineHeight: 20,
    backgroundColor: "#171717",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#262626",
  },
});
