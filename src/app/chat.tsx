import { File, Paths } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

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

export interface Invoice {
  id: string;
  name: string;
  uri: string;
  addedAt: number;
  size?: number;
  summary?: InvoiceSummary;
}

const invoicesIndexFile = new File(Paths.document, "invoices_index.json");

async function loadIndex(): Promise<Invoice[]> {
  try {
    if (!invoicesIndexFile.exists) return [];
    const raw = await invoicesIndexFile.text();
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

const { width, height } = Dimensions.get("window");
const DRAWER_WIDTH = width * 0.75;

type Message = {
  id: string;
  text: string;
  sender: "user" | "ai";
  attachedInvoices?: Invoice[];
};

const MOCK_HISTORY = [
  { id: "h1", title: "Jan 2025 Settlement", date: "Today" },
  { id: "h2", title: "Business Expenses Analysis", date: "Yesterday" },
  { id: "h3", title: "VAT Declaration Q4", date: "Last week" },
  { id: "h4", title: "Invoice #102 Clarification", date: "Last week" },
];

export default function Chat() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const invoiceDataParam = params.invoiceData;
  const invoiceData = Array.isArray(invoiceDataParam) ? invoiceDataParam[0] : invoiceDataParam;
  
  const invoiceNameParam = params.invoiceName;
  const invoiceName = Array.isArray(invoiceNameParam) ? invoiceNameParam[0] : invoiceNameParam;

  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      text: "Hello! I am your AI tax assistant powered by Gemini. You can ask me anything about your finances or attach sanitized invoices for analysis.",
      sender: "ai",
    },
  ]);
  const [attachedInvoices, setAttachedInvoices] = useState<Invoice[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  // States for Invoice Modal
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [availableInvoices, setAvailableInvoices] = useState<Invoice[]>([]);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());

  // Load invoices on mount
  useEffect(() => {
    loadIndex().then(setAvailableInvoices);
  }, []);

  // Auto-attach invoice if navigated from Dashboard/Upload
  useEffect(() => {
    if (invoiceData) {
      const autoInvoice: Invoice = {
        id: "auto-" + Date.now(),
        name: invoiceName || "Załączona faktura z zewnątrz",
        uri: "",
        addedAt: Date.now(),
        summary: {
          fields: [],
          rawOcr: invoiceData,
          status: "done"
        }
      };
      setAttachedInvoices((prev) => {
        if (prev.length === 0) return [autoInvoice];
        return prev;
      });
      if (!input) {
        setInput(`Proszę o analizę faktury${invoiceName ? ` ${invoiceName}` : ""}.`);
      }
    }
  }, [invoiceData, invoiceName]);

  const drawerTranslation = useSharedValue(-DRAWER_WIDTH);
  const backdropOpacity = useSharedValue(0);

  const toggleDrawer = () => {
    Keyboard.dismiss();
    const willOpen = drawerTranslation.value !== 0;
    setIsDrawerOpen(willOpen);

    drawerTranslation.value = withTiming(willOpen ? 0 : -DRAWER_WIDTH, {
      duration: 300,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });

    backdropOpacity.value = withTiming(willOpen ? 0.5 : 0, {
      duration: 300,
    });
  };

  const handleSend = async () => {
    if (!input.trim() && attachedInvoices.length === 0) return;

    const newUserMsg: Message = {
      id: Date.now().toString(),
      text: input,
      sender: "user",
      attachedInvoices: [...attachedInvoices],
    };

    setMessages((prev) => [...prev, newUserMsg]);
    setInput("");
    setAttachedInvoices([]);
    setIsTyping(true);

    try {
      const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "Brak klucza API. Upewnij się, że w .env.local jest zmienna EXPO_PUBLIC_GEMINI_API_KEY i zrestartuj serwer z wyczyszczeniem cache.",
        );
      }

      const historyContext = messages
        .map((m) => `${m.sender === "ai" ? "Gemini" : "Użytkownik"}: ${m.text}`)
        .join("\n");

      let promptText = newUserMsg.text;
      if (newUserMsg.attachedInvoices && newUserMsg.attachedInvoices.length > 0) {
        promptText += `\n\n[ZANONIMIZOWANE DANE FAKTUR]:\n`;
        newUserMsg.attachedInvoices.forEach(inv => {
          let dataStr = inv.summary?.rawOcr || "";
          if (inv.summary?.fields && inv.summary.fields.length > 0) {
            dataStr = inv.summary.fields.map(f => `${f.label}: ${f.value}`).join("\n");
          }
          promptText += `--- Faktura: ${inv.name} ---\n${dataStr}\n\n`;
        });
        promptText += "Proszę przeanalizować załączone dokumenty w kontekście podatków.";
      }

      const requestBody = {
        system_instruction: {
          parts: [
            {
              text: "You are an AI tax assistant. Your task is to help users analyze their financial documentation based on anonymized invoice data. You MUST ALWAYS respond in English, regardless of the language the user writes in. Keep it concise and professional.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Historia czatu:\n${historyContext}\n\nUżytkownik: ${promptText}`,
              },
            ],
          },
        ],
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        throw new Error(`Błąd połączenia z API Gemini: ${response.status}`);
      }

      const data = await response.json();
      const aiText =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Brak odpowiedzi od modelu.";

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: aiText,
          sender: "ai",
        },
      ]);
    } catch (error: any) {
      console.error("Błąd API Gemini:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: `⚠️ Wystąpił błąd: ${error.message}`,
          sender: "ai",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const drawerAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: drawerTranslation.value }],
    };
  });

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: backdropOpacity.value,
      pointerEvents: backdropOpacity.value > 0 ? "auto" : "none",
    } as any;
  });

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.iconBtn} onPress={toggleDrawer}>
          <Text style={styles.iconText}>☰</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Gemini Chat</Text>
        <Pressable style={styles.iconBtn} onPress={() => router.push("/")}>
          <Text style={styles.iconTextX}>✕</Text>
        </Pressable>
      </View>

      {/* Main Chat Area */}
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={() =>
            scrollViewRef.current?.scrollToEnd({ animated: true })
          }
        >
          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.messageWrapper,
                msg.sender === "user" ? styles.msgRight : styles.msgLeft,
              ]}
            >
              <View
                style={[
                  styles.messageBubble,
                  msg.sender === "user" ? styles.bubbleUser : styles.bubbleAi,
                ]}
              >
                {msg.sender === "ai" && (
                  <Text style={styles.aiLabel}>✨ Gemini AI</Text>
                )}

                {msg.attachedInvoices && msg.attachedInvoices.length > 0 && (
                  <View style={styles.attachedInvoiceCard}>
                    <Text style={styles.attachedInvoiceHeader}>
                      📄 Załączono {msg.attachedInvoices.length} faktur(y)
                    </Text>
                    <Text style={styles.attachedInvoiceDetails}>
                      Wysłano zanonimizowane dane z OCR do analizy...
                    </Text>
                  </View>
                )}

                {msg.text ? (
                  <Text style={styles.messageText}>{msg.text}</Text>
                ) : null}
              </View>
            </View>
          ))}
          {isTyping && (
            <View style={[styles.messageWrapper, styles.msgLeft]}>
              <View
                style={[
                  styles.messageBubble,
                  styles.bubbleAi,
                  styles.typingBubble,
                ]}
              >
                <Text style={styles.typingText}>Gemini is typing...</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Custom Attachment Cards Above Input */}
        {attachedInvoices.length > 0 && (
          <View 
            style={{ 
              flexDirection: "row", 
              flexWrap: "wrap", 
              marginHorizontal: 16, 
              marginBottom: 8,
              gap: 8 
            }}
          >
            {attachedInvoices.map((inv) => (
              <View 
                key={inv.id} 
                style={[
                  styles.attachmentPreviewContainer, 
                  { 
                    marginHorizontal: 0, 
                    marginBottom: 0, 
                    paddingVertical: 6, 
                    paddingHorizontal: 10, 
                    borderRadius: 20,
                    maxWidth: "100%",
                    alignSelf: "flex-start",
                  }
                ]}
              >
                <View style={[styles.attachmentPreviewIcon, { width: 24, height: 24, marginRight: 6, borderRadius: 6 }]}>
                  <Text style={[styles.attachmentPreviewIconText, { fontSize: 12 }]}>📄</Text>
                </View>
                <View style={[styles.attachmentPreviewTextContainer, { flexShrink: 1 }]}>
                  <Text style={[styles.attachmentPreviewTitle, { fontSize: 13, marginBottom: 0, lineHeight: 18 }]} numberOfLines={2}>
                    {inv.name}
                  </Text>
                </View>
                <Pressable
                  style={[styles.attachmentPreviewRemove, { width: 20, height: 20, marginLeft: 8 }]}
                  onPress={() => {
                    setAttachedInvoices(prev => prev.filter(i => i.id !== inv.id));
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={[styles.attachmentPreviewRemoveText, { fontSize: 10 }]}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Input Bar */}
        <View style={styles.inputContainer}>
          <Pressable
            style={styles.attachBtn}
            onPress={() => {
              setSelectedInvoiceIds(new Set(attachedInvoices.map(i => i.id)));
              setIsModalVisible(true);
            }}
          >
            <Text style={styles.attachBtnIcon}>📎</Text>
          </Pressable>

          <TextInput
            style={styles.textInput}
            placeholder="Write something..."
            placeholderTextColor="#71717A"
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
          />

          <Pressable
            style={[
              styles.sendBtn,
              !input.trim() && attachedInvoices.length === 0 && styles.sendBtnDisabled,
            ]}
            disabled={!input.trim() && attachedInvoices.length === 0}
            onPress={handleSend}
          >
            <Text style={styles.sendBtnIcon}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Backdrop for Slide Menu */}
      <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
        <Pressable style={{ flex: 1 }} onPress={toggleDrawer} />
      </Animated.View>

      {/* Slide Menu (Chat History) */}
      <Animated.View
        style={[styles.drawer, drawerAnimatedStyle, { paddingTop: insets.top }]}
      >
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle}>Chat History</Text>
          <Pressable onPress={toggleDrawer} style={styles.closeDrawerBtn}>
            <Text style={styles.closeDrawerText}>✕</Text>
          </Pressable>
        </View>

        <Pressable
          style={styles.newChatBtn}
          onPress={() => {
            setMessages([]);
            toggleDrawer();
          }}
        >
          <Text style={styles.newChatBtnText}>+ New Chat</Text>
        </Pressable>

        <ScrollView style={styles.historyList}>
          <Text style={styles.historySection}>Recent</Text>
          {MOCK_HISTORY.map((item) => (
            <Pressable key={item.id} style={styles.historyItem}>
              <Text style={styles.historyItemTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.historyItemDate}>{item.date}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>

      {/* Invoice Selection Modal */}
      <Modal visible={isModalVisible} animationType="slide" transparent>
         <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
               <View style={styles.modalHeader}>
                 <Text style={styles.modalTitle}>Wybierz faktury do analizy</Text>
                 <Pressable onPress={() => setIsModalVisible(false)} style={styles.modalCloseBtn}>
                   <Text style={styles.modalCloseText}>✕</Text>
                 </Pressable>
               </View>
               <ScrollView style={styles.modalList}>
                  {availableInvoices.length === 0 ? (
                    <Text style={styles.modalEmptyText}>Brak wgranych faktur. Dodaj dokumenty na ekranie Upload.</Text>
                  ) : (
                    availableInvoices.map(inv => {
                      const isSelected = selectedInvoiceIds.has(inv.id);
                      return (
                         <Pressable 
                           key={inv.id} 
                           style={[styles.modalInvoiceItem, isSelected && styles.modalInvoiceItemSelected]}
                           onPress={() => {
                              setSelectedInvoiceIds(prev => {
                                 const next = new Set(prev);
                                 if (next.has(inv.id)) next.delete(inv.id);
                                 else next.add(inv.id);
                                 return next;
                              });
                           }}
                         >
                           <View style={styles.modalInvoiceIcon}>
                             <Text style={styles.modalInvoiceIconText}>📄</Text>
                           </View>
                           <View style={styles.modalInvoiceInfo}>
                             <Text style={styles.modalInvoiceName} numberOfLines={1}>{inv.name}</Text>
                             <Text style={styles.modalInvoiceStatus}>
                                {inv.summary?.status === "done" ? "Skrót gotowy (OCR)" : "Brak pełnego skrótu OCR"}
                             </Text>
                           </View>
                           <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                              {isSelected && <Text style={styles.checkboxCheck}>✓</Text>}
                           </View>
                         </Pressable>
                      );
                    })
                  )}
               </ScrollView>
               <View style={styles.modalFooter}>
                  <Pressable 
                    style={styles.modalConfirmBtn}
                    onPress={() => {
                       const selected = availableInvoices.filter(i => selectedInvoiceIds.has(i.id));
                       const autoAttached = attachedInvoices.filter(i => i.id.startsWith("auto-"));
                       setAttachedInvoices([...autoAttached, ...selected]);
                       setIsModalVisible(false);
                    }}
                  >
                     <Text style={styles.modalConfirmText}>Dołącz faktury ({selectedInvoiceIds.size})</Text>
                  </Pressable>
               </View>
            </View>
         </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#262626",
  },
  headerTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" },
  iconBtn: { padding: 8, borderRadius: 8, backgroundColor: "#171717" },
  iconText: { color: "#FFFFFF", fontSize: 18 },
  iconTextX: { color: "#A1A1AA", fontSize: 16 },

  chatArea: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },

  messageWrapper: { marginBottom: 16, flexDirection: "row" },
  msgLeft: { justifyContent: "flex-start" },
  msgRight: { justifyContent: "flex-end" },

  messageBubble: {
    maxWidth: "80%",
    padding: 14,
    borderRadius: 20,
  },
  bubbleUser: {
    backgroundColor: "#3B82F6",
    borderBottomRightRadius: 4,
  },
  bubbleAi: {
    backgroundColor: "#171717",
    borderWidth: 1,
    borderColor: "#262626",
    borderBottomLeftRadius: 4,
  },
  messageText: { color: "#FFFFFF", fontSize: 15, lineHeight: 22 },
  aiLabel: {
    color: "#A78BFA",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },

  typingBubble: { paddingVertical: 10, paddingHorizontal: 14 },
  typingText: { color: "#A1A1AA", fontSize: 14, fontStyle: "italic" },

  attachedInvoiceCard: {
    backgroundColor: "rgba(0,0,0,0.2)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#4ADE80",
  },
  attachedInvoiceHeader: {
    color: "#4ADE80",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4,
  },
  attachedInvoiceDetails: { color: "#E4E4E7", fontSize: 12, lineHeight: 16 },

  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    paddingHorizontal: 16,
    backgroundColor: "#000000",
    borderTopWidth: 1,
    borderTopColor: "#262626",
    marginBottom: Platform.OS === "ios" ? 8 : 0,
  },
  textInput: {
    flex: 1,
    backgroundColor: "#171717",
    color: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 20,
    maxHeight: 120,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#262626",
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#171717",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#262626",
  },
  attachBtnActive: {
    backgroundColor: "#064E3B",
    borderColor: "#059669",
  },
  attachBtnIcon: { color: "#FFFFFF", fontSize: 20 },

  attachmentPreviewContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#171717",
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.4)",
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  attachmentPreviewIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "rgba(139, 92, 246, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  attachmentPreviewIconText: { fontSize: 20 },
  attachmentPreviewTextContainer: { flex: 1 },
  attachmentPreviewTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  attachmentPreviewSub: {
    color: "#A78BFA",
    fontSize: 12,
  },
  attachmentPreviewRemove: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  attachmentPreviewRemoveText: {
    color: "#F87171",
    fontSize: 14,
    fontWeight: "700",
  },

  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: "#3F3F46", opacity: 0.5 },
  sendBtnIcon: { color: "#000000", fontSize: 20, fontWeight: "900" },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    zIndex: 10,
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: "#171717",
    zIndex: 20,
    borderRightWidth: 1,
    borderRightColor: "#262626",
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#262626",
  },
  drawerTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" },
  closeDrawerBtn: { padding: 4 },
  closeDrawerText: { color: "#A1A1AA", fontSize: 18 },

  newChatBtn: {
    margin: 16,
    paddingVertical: 12,
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  newChatBtnText: { color: "#60A5FA", fontSize: 16, fontWeight: "600" },

  historyList: { flex: 1, paddingHorizontal: 16 },
  historySection: {
    color: "#A1A1AA",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  historyItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#262626",
  },
  historyItemTitle: { color: "#FFFFFF", fontSize: 15, marginBottom: 4 },
  historyItemDate: { color: "#71717A", fontSize: 12 },

  /* Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#171717",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: height * 0.7,
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#262626",
  },
  modalTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  modalCloseBtn: { padding: 4 },
  modalCloseText: { color: "#A1A1AA", fontSize: 20 },
  modalList: { flex: 1, padding: 16 },
  modalEmptyText: { color: "#71717A", fontSize: 15, textAlign: "center", marginTop: 40 },
  modalInvoiceItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#262626",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  modalInvoiceItemSelected: {
    backgroundColor: "rgba(139, 92, 246, 0.15)",
    borderColor: "rgba(139, 92, 246, 0.5)",
  },
  modalInvoiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#171717",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  modalInvoiceIconText: { fontSize: 20 },
  modalInvoiceInfo: { flex: 1 },
  modalInvoiceName: { color: "#FFFFFF", fontSize: 15, fontWeight: "600", marginBottom: 4 },
  modalInvoiceStatus: { color: "#A1A1AA", fontSize: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#52525B",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  checkboxSelected: {
    backgroundColor: "#8B5CF6",
    borderColor: "#8B5CF6",
  },
  checkboxCheck: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  modalFooter: { padding: 24, borderTopWidth: 1, borderTopColor: "#262626" },
  modalConfirmBtn: {
    backgroundColor: "#8B5CF6",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  modalConfirmText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
