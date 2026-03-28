import { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Modal, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File, Directory, Paths } from "expo-file-system";

interface InvoiceField {
  label: string;
  value: string;
}

interface InvoiceSummary {
  fields: InvoiceField[];
  rawOcr: string;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
}

interface Invoice {
  id: string;
  name: string;
  uri: string;
  addedAt: number;
  size?: number;
  summary?: InvoiceSummary;
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

export default function Upload() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [picking, setPicking] = useState(false);
  const router = useRouter();

  useEffect(() => {
    ensureInvoicesDir();
    loadIndex().then(setInvoices);
  }, []);

  // Custom popup state (synced with dashboard design)
  const [popup, setPopup] = useState<{
    visible: boolean;
    icon: "success" | "error" | "warning" | "confirm";
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
  }>({ visible: false, icon: "success", title: "", message: "" });

  const showPopup = (
    icon: "success" | "error" | "warning" | "confirm",
    title: string,
    message: string,
    onConfirm?: () => void,
    confirmLabel?: string,
    cancelLabel?: string,
  ) => {
    setPopup({ visible: true, icon, title, message, onConfirm, confirmLabel, cancelLabel });
  };

  const closePopup = () => setPopup((p) => ({ ...p, visible: false }));

  const handleUpload = async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/png", "image/jpeg"],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const pickedFile = result.assets[0];
        ensureInvoicesDir();
        const current = await loadIndex();
        
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ext = pickedFile.name.split(".").pop() || "pdf";
        const dest = new File(invoicesDir, `${id}.${ext}`);
        const src = new File(pickedFile.uri);
        src.copy(dest);

        const newInvoice: Invoice = {
          id,
          name: pickedFile.name,
          uri: dest.uri,
          addedAt: Date.now(),
          size: pickedFile.size ?? undefined,
        };
        
        const updated = [...current, newInvoice];
        saveIndex(updated);
        setInvoices(updated);
      }
    } catch (err: any) {
      showPopup("error", "Error", err.message ?? "Failed to pick documents");
    } finally {
      setPicking(false);
    }
  };

  const handleCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showPopup("warning", "Brak uprawnień", "Potrzebujemy dostępu do aparatu, aby zeskanować dokument.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        allowsEditing: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const photo = result.assets[0];
        ensureInvoicesDir();
        const current = await loadIndex();
        
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const dest = new File(invoicesDir, `${id}.jpg`);
        const src = new File(photo.uri);
        src.copy(dest);

        const newInvoice: Invoice = {
          id,
          name: `Scan_${current.length + 1}.jpg`,
          uri: dest.uri,
          addedAt: Date.now(),
          size: photo.fileSize ?? undefined,
        };
        
        const updated = [...current, newInvoice];
        saveIndex(updated);
        setInvoices(updated);
      }
    } catch (err: any) {
      if (err.message && err.message.includes("Camera not available")) {
        // Fallback for Simulator
        showPopup(
          "confirm",
          "Aparat niedostępny", 
          "Symulator nie posiada kamery. Czy chcesz wybrać zdjęcie z galerii?",
          async () => {
            const libResult = await ImagePicker.launchImageLibraryAsync({
              quality: 0.8,
              allowsEditing: true,
            });
            if (!libResult.canceled && libResult.assets && libResult.assets.length > 0) {
              const photo = libResult.assets[0];
              ensureInvoicesDir();
              const current = await loadIndex();
              
              const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const dest = new File(invoicesDir, `${id}.jpg`);
              const src = new File(photo.uri);
              src.copy(dest);

              const newInvoice: Invoice = {
                id,
                name: `Gallery_${current.length + 1}.jpg`,
                uri: dest.uri,
                addedAt: Date.now(),
                size: photo.fileSize ?? undefined,
              };

              const updated = [...current, newInvoice];
              saveIndex(updated);
              setInvoices(updated);
            }
          },
          "Galeria",
          "Anuluj"
        );
      } else {
        showPopup("error", "Błąd", "Wystąpił problem podczas uruchamiania aparatu.");
        console.error("Camera error: ", err);
      }
    }
  };

  const handleProcess = () => {
    router.replace("/" as any);
  };

  const confirmRemove = (id: string, name: string) => {
    showPopup(
      "confirm",
      "Remove invoice",
      `Remove "${name}"?`,
      async () => {
        const updated = invoices.filter((inv) => inv.id !== id);
        const toRemove = invoices.find((inv) => inv.id === id);
        if (toRemove) {
          try {
            const f = new File(toRemove.uri);
            if (f.exists) f.delete();
          } catch {}
        }
        await saveIndex(updated);
        setInvoices(updated);
      },
      "Remove",
      "Cancel"
    );
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backButtonText}>← Back</Text>
            </Pressable>
            <TouchableOpacity 
              style={styles.chatShortcut} 
              onPress={() => router.push("/chat" as any)}
            >
              <Text style={styles.chatShortcutText}>💬 Chat</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>Upload Documents</Text>
          <Text style={styles.subtitle}>Select invoices to settle</Text>
        </View>

        <ScrollView style={styles.fileList} contentContainerStyle={{ paddingBottom: 24 }}>
          {invoices.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconPlaceholder}>
                <Text style={styles.emptyIconText}>📄</Text>
              </View>
              <Text style={styles.emptyStateText}>No attached files</Text>
            </View>
          ) : (
            invoices.map((inv) => (
              <Pressable 
                key={inv.id} 
                style={styles.fileCard}
                onLongPress={() => confirmRemove(inv.id, inv.name)}
              >
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName} numberOfLines={1}>{inv.name}</Text>
                  <Text style={styles.fileSize}>
                    {new Date(inv.addedAt).toLocaleDateString()} {inv.size ? `• ${formatSize(inv.size)}` : ""}
                  </Text>
                </View>
                <View style={[
                  styles.fileStatus,
                  inv.summary?.status === "done" && styles.fileStatusScanned
                ]}>
                  <Text style={[
                    styles.statusText,
                    inv.summary?.status === "done" && styles.statusTextScanned
                  ]}>
                    {inv.summary?.status === "done" ? "Scanned" : "Ready"}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.uploadButtonsRow}>
            <Pressable style={[styles.uploadButton, styles.flex1, styles.marginRight8]} onPress={handleUpload}>
              <Text style={styles.uploadButtonText}>+ Add PDF</Text>
            </Pressable>
            <Pressable style={[styles.uploadButton, styles.flex1]} onPress={handleCamera}>
              <Text style={styles.uploadButtonText}>📷 Scan Doc</Text>
            </Pressable>
          </View>

          <Pressable
            style={styles.processButton}
            onPress={handleProcess}
          >
            <Text style={styles.processButtonText}>Back to Dashboard</Text>
            <Text style={styles.processSubText}>Scan & Analyze from main screen</Text>
          </Pressable>
        </View>
      </View>

      {/* Custom popup modal (synced with dashboard design) */}
      <Modal
        visible={popup.visible}
        transparent
        animationType="fade"
        onRequestClose={closePopup}
      >
        <Pressable style={styles.modalOverlay} onPress={closePopup}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={[
              styles.modalIconCircle,
              popup.icon === "success" && { backgroundColor: "rgba(16, 185, 129, 0.15)" },
              popup.icon === "error" && { backgroundColor: "rgba(239, 68, 68, 0.15)" },
              popup.icon === "warning" && { backgroundColor: "rgba(245, 158, 11, 0.15)" },
              popup.icon === "confirm" && { backgroundColor: "rgba(139, 92, 246, 0.15)" },
            ]}>
              <Text style={[
                styles.modalIconText,
                popup.icon === "success" && { color: "#34D399" },
                popup.icon === "error" && { color: "#F87171" },
                popup.icon === "warning" && { color: "#FBBF24" },
                popup.icon === "confirm" && { color: "#A78BFA" },
              ]}>
                {popup.icon === "success" ? "✓" :
                 popup.icon === "error" ? "✕" :
                 popup.icon === "warning" ? "!" : "?"}
              </Text>
            </View>
            <Text style={styles.modalTitle}>{popup.title}</Text>
            <Text style={styles.modalMessage}>{popup.message}</Text>
            <View style={styles.modalButtons}>
              {popup.cancelLabel && (
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnSecondary]}
                  onPress={closePopup}
                >
                  <Text style={styles.modalBtnSecondaryText}>{popup.cancelLabel}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  popup.icon === "error" && { backgroundColor: "#EF4444" },
                  popup.icon === "warning" && { backgroundColor: "#F59E0B" },
                  popup.icon === "confirm" && { backgroundColor: "#EF4444" },
                  !popup.cancelLabel && { flex: 1 },
                ]}
                onPress={() => {
                  closePopup();
                  popup.onConfirm?.();
                }}
              >
                <Text style={styles.modalBtnPrimaryText}>
                  {popup.confirmLabel || "OK"}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  header: { marginBottom: 32 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  backButton: { },
  backButtonText: { color: "#A1A1AA", fontSize: 16, fontWeight: "600" },
  chatShortcut: { 
    backgroundColor: "rgba(139, 92, 246, 0.15)", 
    paddingHorizontal: 16, 
    paddingVertical: 8, 
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.3)",
  },
  chatShortcutText: { color: "#A78BFA", fontSize: 14, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "800", color: "#FFFFFF" },
  subtitle: { fontSize: 16, color: "#A1A1AA", marginTop: 8 },
  fileList: { flex: 1 },
  emptyState: { alignItems: "center", justifyContent: "center", marginTop: 60 },
  emptyIconPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#171717", alignItems: "center", justifyContent: "center", marginBottom: 16, borderWidth: 1, borderColor: "#262626" },
  emptyIconText: { fontSize: 32 },
  emptyStateText: { color: "#52525B", fontSize: 16 },
  fileCard: { backgroundColor: "#171717", borderRadius: 16, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, borderWidth: 1, borderColor: "#262626" },
  fileInfo: { flex: 1 },
  fileName: { color: "#FFFFFF", fontSize: 16, fontWeight: "600", marginBottom: 4 },
  fileSize: { color: "#A1A1AA", fontSize: 13 },
  fileStatus: { backgroundColor: "rgba(139, 92, 246, 0.15)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "rgba(139, 92, 246, 0.3)" },
  fileStatusScanned: { backgroundColor: "rgba(16, 185, 129, 0.15)", borderColor: "rgba(16, 185, 129, 0.3)" },
  statusText: { color: "#A78BFA", fontSize: 12, fontWeight: "600" },
  statusTextScanned: { color: "#10B981" },
  footer: { paddingTop: 16, paddingBottom: 32 },
  uploadButtonsRow: { flexDirection: "row", marginBottom: 16 },
  flex1: { flex: 1 },
  marginRight8: { marginRight: 8 },
  uploadButton: { backgroundColor: "#262626", borderRadius: 16, paddingVertical: 16, alignItems: "center" },
  uploadButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  processButton: { backgroundColor: "#8B5CF6", borderRadius: 16, paddingVertical: 16, alignItems: "center", shadowColor: "#8B5CF6", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  processButtonDisabled: { backgroundColor: "#3F3F46", shadowOpacity: 0, elevation: 0 },
  processButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  processSubText: { color: "#D8B4FE", fontSize: 12, marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  modalCard: {
    backgroundColor: "#1C1C1E",
    borderRadius: 24,
    padding: 28,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2C2C2E",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 10,
  },
  modalIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  modalIconText: {
    fontSize: 28,
    fontWeight: "800",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 8,
    textAlign: "center",
  },
  modalMessage: {
    fontSize: 14,
    color: "#A1A1AA",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  modalBtnPrimary: {
    backgroundColor: "#8B5CF6",
  },
  modalBtnPrimaryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  modalBtnSecondary: {
    backgroundColor: "#2C2C2E",
    borderWidth: 1,
    borderColor: "#3A3A3C",
  },
  modalBtnSecondaryText: {
    color: "#A1A1AA",
    fontSize: 15,
    fontWeight: "600",
  },
});
