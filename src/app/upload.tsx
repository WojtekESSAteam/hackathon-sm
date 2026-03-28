import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

export default function Upload() {
  const [files, setFiles] = useState<{ id: string; name: string; size: string }[]>([]);
  const router = useRouter();

  const handleUpload = () => {
    // Symulacja podnoszenia pliku
    setFiles((prev) => [
      ...prev,
      { id: Date.now().toString(), name: `Faktura_FV_${prev.length + 1}.pdf`, size: "1.2 MB" },
    ]);
  };

  const handleProcess = () => {
    if (files.length > 0) {
      // Cast path as any to bypass temporary strict typing error before reload
      router.push("/processing" as any);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Wróć</Text>
          </Pressable>
          <Text style={styles.title}>Wgraj Dokumenty</Text>
          <Text style={styles.subtitle}>Wybierz faktury do rozliczenia</Text>
        </View>

        <ScrollView style={styles.fileList} contentContainerStyle={{ paddingBottom: 24 }}>
          {files.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconPlaceholder}>
                <Text style={styles.emptyIconText}>📄</Text>
              </View>
              <Text style={styles.emptyStateText}>Brak załączonych plików</Text>
            </View>
          ) : (
            files.map((file) => (
              <View key={file.id} style={styles.fileCard}>
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName}>{file.name}</Text>
                  <Text style={styles.fileSize}>{file.size}</Text>
                </View>
                <View style={styles.fileStatus}>
                  <Text style={styles.statusText}>Gotowy</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.uploadButton} onPress={handleUpload}>
            <Text style={styles.uploadButtonText}>+ Dodaj kolejny PDF</Text>
          </Pressable>

          <Pressable
            style={[styles.processButton, files.length === 0 && styles.processButtonDisabled]}
            disabled={files.length === 0}
            onPress={handleProcess}
          >
            <Text style={styles.processButtonText}>Uruchom On-Device AI</Text>
            <Text style={styles.processSubText}>Lokalna cenzura (ExecuTorch)</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  header: { marginBottom: 32 },
  backButton: { marginBottom: 16 },
  backButtonText: { color: "#A1A1AA", fontSize: 16, fontWeight: "600" },
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
  statusText: { color: "#A78BFA", fontSize: 12, fontWeight: "600" },
  footer: { paddingTop: 16, paddingBottom: 32 },
  uploadButton: { backgroundColor: "#262626", borderRadius: 16, paddingVertical: 16, alignItems: "center", marginBottom: 16 },
  uploadButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  processButton: { backgroundColor: "#8B5CF6", borderRadius: 16, paddingVertical: 16, alignItems: "center", shadowColor: "#8B5CF6", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  processButtonDisabled: { backgroundColor: "#3F3F46", shadowOpacity: 0, elevation: 0 },
  processButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  processSubText: { color: "#D8B4FE", fontSize: 12, marginTop: 4 },
});
