import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

export default function Summary() {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleGeminiRequest = () => {
    setIsSending(true);
    // Symulacja requestu do chmury po cenzurze
    setTimeout(() => {
      setIsSending(false);
      setResult({
        totalIncome: "45,200 PLN",
        totalExpenses: "12,150 PLN",
        taxToPay: "3,966 PLN",
        formType: "PIT-36",
      });
    }, 3000);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Podsumowanie Danych</Text>
          <Text style={styles.subtitle}>Pakiet przygotowany bezpiecznie do weryfikacji.</Text>
        </View>

        {!result ? (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Ocenzurowana Paczka JSON</Text>
                <View style={styles.badgeSafe}>
                  <Text style={styles.badgeSafeText}>Safe</Text>
                </View>
              </View>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>
                {`{\n  "documents": 2,\n  "currency": "PLN",\n  "total_revenue": 45200.00,\n  "total_costs": 12150.00,\n  "year": 2025,\n  "pii_removed": true\n}`}
                </Text>
              </View>
            </View>

            <View style={styles.actionContainer}>
              <Text style={styles.actionText}>Dane nie zawierają wrażliwych informacji na Twój temat. Możesz je teraz bezpiecznie przesłać do Gemini celem dokładnych wyliczeń.</Text>
              <Pressable
                style={[styles.geminiBtn, isSending && styles.geminiBtnDisabled]}
                onPress={handleGeminiRequest}
                disabled={isSending}
              >
                {isSending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.geminiBtnText}>Pobierz rozliczenie z Gemini</Text>
                    <Text style={styles.geminiSubText}>API Cloud Inference</Text>
                  </>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.resultContainer}>
            <View style={styles.successHeader}>
              <Text style={styles.successEmoji}>🎉</Text>
              <Text style={styles.successTitle}>Rozliczenie Gotowe (Gemini)</Text>
            </View>
            
            <View style={styles.resultGrid}>
              <View style={styles.resultBox}>
                <Text style={styles.resultLabel}>Przychód</Text>
                <Text style={styles.resultValue}>{result.totalIncome}</Text>
              </View>
              <View style={styles.resultBox}>
                <Text style={styles.resultLabel}>Koszty</Text>
                <Text style={styles.resultValue}>{result.totalExpenses}</Text>
              </View>
            </View>

            <View style={[styles.resultBox, styles.highlightBox]}>
              <Text style={styles.resultLabelHighlight}>Należny podatek</Text>
              <Text style={styles.resultValueHighlight}>{result.taxToPay}</Text>
            </View>

            <Pressable style={styles.primaryBtn} onPress={() => router.push("/")}>
              <Text style={styles.primaryBtnText}>Zamknij i Zapisz</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 40 },
  header: { marginBottom: 32 },
  title: { fontSize: 32, fontWeight: "800", color: "#FFFFFF" },
  subtitle: { fontSize: 16, color: "#A1A1AA", marginTop: 8 },
  card: { backgroundColor: "#171717", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#262626", marginBottom: 32 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: "600", color: "#FFFFFF" },
  badgeSafe: { backgroundColor: "rgba(16, 185, 129, 0.15)", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: "rgba(16, 185, 129, 0.3)" },
  badgeSafeText: { color: "#34D399", fontSize: 12, fontWeight: "600" },
  codeBlock: { backgroundColor: "#000000", padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "#262626" },
  codeText: { color: "#60A5FA", fontFamily: "monospace", fontSize: 13, lineHeight: 20 },
  actionContainer: { alignItems: "center" },
  actionText: { color: "#A1A1AA", fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 20 },
  geminiBtn: { backgroundColor: "#3B82F6", borderRadius: 16, paddingVertical: 16, alignItems: "center", width: "100%", shadowColor: "#3B82F6", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  geminiBtnDisabled: { opacity: 0.7 },
  geminiBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  geminiSubText: { color: "#BFDBFE", fontSize: 12, marginTop: 4 },
  resultContainer: { marginTop: 10 },
  successHeader: { alignItems: "center", marginBottom: 32 },
  successEmoji: { fontSize: 48, marginBottom: 16 },
  successTitle: { fontSize: 24, fontWeight: "700", color: "#FFFFFF" },
  resultGrid: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  resultBox: { backgroundColor: "#171717", borderRadius: 16, padding: 20, flex: 1, marginHorizontal: 4, borderWidth: 1, borderColor: "#262626" },
  resultLabel: { color: "#A1A1AA", fontSize: 14, marginBottom: 8 },
  resultValue: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  highlightBox: { marginHorizontal: 4, borderColor: "#8B5CF6", backgroundColor: "rgba(139, 92, 246, 0.05)", borderWidth: 2 },
  resultLabelHighlight: { color: "#A78BFA", fontSize: 14, marginBottom: 8 },
  resultValueHighlight: { color: "#FFFFFF", fontSize: 28, fontWeight: "800" },
  primaryBtn: { backgroundColor: "#FFFFFF", borderRadius: 16, paddingVertical: 16, alignItems: "center", width: "100%", marginTop: 32 },
  primaryBtnText: { color: "#000000", fontSize: 16, fontWeight: "700" },
});
