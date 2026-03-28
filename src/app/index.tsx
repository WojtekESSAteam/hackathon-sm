import { useState, useEffect, useCallback } from "react";
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  FlatList,
  Alert,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File, Directory, Paths } from "expo-file-system";
import { useOCR, OCR_ENGLISH } from "react-native-executorch";

interface Invoice {
  id: string;
  name: string;
  uri: string;
  addedAt: number;
  size?: number;
}

const invoicesDir = new Directory(Paths.document, "invoices");
const invoicesIndexFile = new File(Paths.document, "invoices_index.json");

function ensureInvoicesDir() {
  if (!invoicesDir.exists) {
    invoicesDir.create();
  }
}

function loadIndex(): Invoice[] {
  try {
    if (!invoicesIndexFile.exists) return [];
    const raw = invoicesIndexFile.text();
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveIndex(invoices: Invoice[]) {
  invoicesIndexFile.write(JSON.stringify(invoices));
}

export default function Index() {
  const [started, setStarted] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [picking, setPicking] = useState(false);
  const ocr = useOCR({ model: OCR_ENGLISH, preventLoad: !started });

  useEffect(() => {
    ensureInvoicesDir();
    setInvoices(loadIndex());
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
      const current = loadIndex();
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
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Invoice Scanner</Text>

        {/* OCR status */}
        <Text style={styles.status}>{statusText}</Text>

        {!started && (
          <TouchableOpacity style={styles.button} onPress={() => setStarted(true)}>
            <Text style={styles.buttonText}>Load OCR Model</Text>
          </TouchableOpacity>
        )}

        {started && !ocr.isReady && !ocr.error && (
          <ActivityIndicator size="large" color="#208AEF" />
        )}

        {ocr.isReady && (
          <View style={styles.successBadge}>
            <Text style={styles.successText}>OCR ready</Text>
          </View>
        )}

        {/* Add invoices button */}
        <TouchableOpacity
          style={[styles.button, styles.addButton]}
          onPress={pickInvoices}
          disabled={picking}
        >
          {picking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>+ Add Invoices</Text>
          )}
        </TouchableOpacity>

        {/* Invoice list */}
        {invoices.length > 0 && (
          <View style={styles.listSection}>
            <Text style={styles.listTitle}>
              Invoices ({invoices.length})
            </Text>
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
            No invoices added yet. Tap "Add Invoices" to pick PDFs from your device.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  container: {
    alignItems: "center",
    padding: 24,
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#1a1a2e",
  },
  status: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: "center",
    color: "#666",
  },
  button: {
    backgroundColor: "#208AEF",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
    minWidth: 200,
    alignItems: "center",
  },
  addButton: {
    backgroundColor: "#16a34a",
    marginTop: 24,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  successBadge: {
    backgroundColor: "#d4edda",
    padding: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  successText: {
    color: "#155724",
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
    color: "#1a1a2e",
  },
  invoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pdfIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  pdfIconText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },
  invoiceInfo: {
    flex: 1,
  },
  invoiceName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a2e",
  },
  invoiceMeta: {
    fontSize: 12,
    color: "#888",
    marginTop: 2,
  },
  emptyText: {
    marginTop: 32,
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    lineHeight: 20,
  },
});
