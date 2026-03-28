import { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

export default function Processing() {
  const router = useRouter();
  const [logs, setLogs] = useState<string[]>(["> Starting ExecuTorch engine..."]);
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: 100,
      duration: 11000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    const sequence = [
      { text: "> Loading Gemma 3 2B model to memory...", delay: 1500 },
      { text: "> Reading first invoice...", delay: 3000 },
      { text: "> Tax ID detected: 123-***-**-**", delay: 4500 },
      { text: "> Name detected and redacted...", delay: 6000 },
      { text: "> Bank account detected: PL**********...", delay: 7500 },
      { text: "> Converting output data to JSON format...", delay: 9000 },
      { text: "> Local redaction finished. Status: Safe.", delay: 10500 },
    ];

    const timeouts: NodeJS.Timeout[] = [];
    sequence.forEach((item) => {
      timeouts.push(
        setTimeout(() => {
          setLogs((prev) => [...prev, item.text]);
        }, item.delay)
      );
    });

    const finalTimeout = setTimeout(() => {
      router.push("/summary" as any);
    }, 12500);

    return () => {
      timeouts.forEach(clearTimeout);
      clearTimeout(finalTimeout);
    };
  }, []);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Local Protection</Text>
          <Text style={styles.subtitle}>On-Device AI Processing</Text>
        </View>

        <View style={styles.terminalContainer}>
          <View style={styles.terminalHeader}>
            <View style={styles.dotRed} />
            <View style={styles.dotYellow} />
            <View style={styles.dotGreen} />
            <Text style={styles.terminalTitle}>bash - executorch</Text>
          </View>
          <View style={styles.terminalBody}>
            {logs.map((log, index) => (
              <Text key={index} style={styles.terminalText}>
                <Text style={styles.terminalPrompt}>~$ </Text>{log}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.progressContainer}>
          <View style={styles.progressBarBackground}>
            <Animated.View style={[styles.progressBarFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.progressText}>Redacting data...</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 40, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: 40 },
  title: { fontSize: 28, fontWeight: "800", color: "#FFFFFF" },
  subtitle: { fontSize: 16, color: "#8B5CF6", marginTop: 8, fontWeight: "600" },
  terminalContainer: {
    backgroundColor: "#121212",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#262626",
    overflow: "hidden",
    height: 350,
  },
  terminalHeader: {
    backgroundColor: "#1A1A1A",
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#262626",
  },
  dotRed: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444", marginRight: 6 },
  dotYellow: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#F59E0B", marginRight: 6 },
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#10B981", marginRight: 16 },
  terminalTitle: { color: "#71717A", fontSize: 12, fontFamily: "monospace" },
  terminalBody: { padding: 16, flex: 1 },
  terminalText: { color: "#34D399", fontSize: 14, fontFamily: "monospace", marginBottom: 8, lineHeight: 20 },
  terminalPrompt: { color: "#A1A1AA" },
  progressContainer: { marginTop: 40 },
  progressBarBackground: { height: 8, backgroundColor: "#262626", borderRadius: 4, overflow: "hidden" },
  progressBarFill: { height: "100%", backgroundColor: "#8B5CF6", borderRadius: 4 },
  progressText: { color: "#A1A1AA", fontSize: 14, textAlign: "center", marginTop: 16, fontWeight: "500" },
});
