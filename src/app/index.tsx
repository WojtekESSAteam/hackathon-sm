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
import { useOCR, OCR_POLISH } from "react-native-executorch";
import { Link } from "expo-router";

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

// Direct regex extraction — each field uses a self-contained pattern.
// No section splitting needed. Each regex captures only its specific value.
function extractInvoiceFields(ocrText: string): InvoiceField[] {
  const fields: InvoiceField[] = [];
  const t = ocrText.replace(/\s+/g, " ");

  // Helper: first match or null
  const grab = (re: RegExp) => {
    const m = t.match(re);
    return m ? m[1].trim() : null;
  };

  // Invoice number: FVI239/2024, FV/123, FV1-2024
  const invNum = grab(/\b(FV[A-Z]?\d*[\/\-]\d{1,4}(?:[\/\-]\d{2,4})?)\b/i);
  if (invNum) fields.push({ label: "Numer faktury", value: invNum });

  // Data wystawienia: DD.MM.YYYY (only after "Data wystawienia")
  const date = grab(/Data\s*wystawienia[:\s]*(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/i);
  if (date) fields.push({ label: "Data wystawienia", value: date });

  // Termin platnosci: DD.MM.YYYY
  const termin = grab(/Termin\s*p[lł]atno[sś]ci[:\s]*(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/i);
  if (termin) fields.push({ label: "Termin płatności", value: termin });

  // Sprzedawca: everything between "Sprzedawca:" and "NIP" (strip FAKTURA VAT prefix)
  const seller = grab(/Sprzedawca[:\s]+(?:FAKTURA\s*VAT\s*)?(.+?)(?=\s*NIP\b)/i);
  if (seller) fields.push({ label: "Sprzedawca", value: maskSensitive(seller) });

  // Nabywca: name between "Waluta: PLN" and the table header "Opis|Cena|Ilosc"
  // OCR pattern: "Nabywca: Termin platnosci: ... Waluta: PLN <NAME> <address> Opis Ilosc..."
  let buyer = grab(/Waluta[:\s]*PLN\s+(.+?)(?=\s*(?:Opis|Ilosc|Cena|Lp\b))/i);
  // Fallback: if no Waluta section, get text between Nabywca and table header, stripping Termin/Waluta
  if (!buyer) {
    buyer = grab(/Nabywca[:\s]+(.+?)(?=\s*(?:Opis|Ilosc|Cena|Lp\b))/i);
    if (buyer) {
      buyer = buyer
        .replace(/Termin\s*p[lł]atno[sś]ci[:\s]*\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4}/i, "")
        .replace(/Waluta[:\s]*[A-Z]{3}/i, "")
        .trim();
    }
  }
  if (buyer) fields.push({ label: "Nabywca", value: maskSensitive(buyer) });

  // NIP(s)
  const nipAll = [...t.matchAll(/NIP[:\s]*([\d\-\s]{10,13})/gi)];
  nipAll.forEach((m, i) => {
    fields.push({
      label: i === 0 ? "NIP sprzedawcy" : "NIP nabywcy",
      value: maskNip(m[1].trim()),
    });
  });

  // Razem netto: number right after "Razem netto:"
  const netto = grab(/Razem\s*netto[:\s]*([\d,\.]+)/i);
  if (netto) fields.push({ label: "Razem netto", value: cleanAmount(netto) + " zł" });

  // VAT: "VAT (89): 302.76 zI" — require parens with rate to skip "Cena netto VAT Netto Brutto" header
  // OCR often renders "zł" as "zI" or "zl"
  const vat = grab(/VAT\s*\(\d+%?\)[:\s]*([\d,\.]+)/i);
  if (vat) fields.push({ label: "VAT", value: cleanAmount(vat) + " zł" });

  // Do zapłaty / Do zaplaty: number
  const payment = grab(/Do\s*zap[lł]aty[:\s]*([\d,\.]+)/i);
  if (payment) fields.push({ label: "Do zapłaty", value: cleanAmount(payment) + " zł" });

  if (fields.length === 0) {
    fields.push({ label: "Status", value: "Nie rozpoznano pól faktury" });
  }

  return fields;
}

function cleanAmount(raw: string): string {
  return raw.replace(/\s/g, "").replace(",", ".").trim();
}

function maskNip(nip: string): string {
  const digits = nip.replace(/[\s\-]/g, "");
  if (digits.length >= 10) {
    return digits.slice(0, 3) + "****" + digits.slice(7);
  }
  return nip;
}

function maskSensitive(text: string): string {
  return text
    // Remove street addresses (ul. ...)
    .replace(/,?\s*ul\.\s*[^\n,;]+/gi, "")
    // Remove postal codes with city (00-000 Miasto)
    .replace(/,?\s*\d{2}-\d{3}\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export default function Index() {
  const [started, setStarted] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [picking, setPicking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ksefSyncing, setKsefSyncing] = useState(false);
  const [ksefProgress, setKsefProgress] = useState(0);
  const [ksefStage, setKsefStage] = useState("");

  // OCR for text extraction from images (Polish)
  const ocr = useOCR({ model: OCR_POLISH, preventLoad: !started });

  useEffect(() => {
    ensureInvoicesDir();
    loadIndex().then(setInvoices);
  }, []);

  const pickInvoices = useCallback(async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/png", "image/jpeg", "image/webp"],
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
        const ext = asset.name.split(".").pop() || "jpg";
        const dest = new File(invoicesDir, `${id}.${ext}`);
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

  const syncFromKsef = useCallback(async () => {
    setKsefSyncing(true);
    setKsefProgress(0);

    const stages = [
      "Connecting to KSeF API...",
      "Authenticating with certificate...",
      "Fetching invoice list...",
      "Downloading invoices...",
      "Validating XML schemas...",
      "Processing invoice data...",
      "Finalizing sync...",
    ];

    // Fake KSeF invoices
    const ksefInvoices: { name: string; fields: InvoiceField[] }[] = [
      {
        name: "FV/2025/01/0042",
        fields: [
          { label: "Numer faktury", value: "FV/2025/01/0042" },
          { label: "Data wystawienia", value: "15.01.2025" },
          { label: "Termin płatności", value: "29.01.2025" },
          { label: "Sprzedawca", value: "NetSoft Sp. z o.o." },
          { label: "Nabywca", value: "K**** W****" },
          { label: "NIP sprzedawcy", value: "541****238" },
          { label: "Razem netto", value: "12450.00 zł" },
          { label: "VAT", value: "2863.50 zł" },
          { label: "Do zapłaty", value: "15313.50 zł" },
        ],
      },
      {
        name: "FV/2025/01/0089",
        fields: [
          { label: "Numer faktury", value: "FV/2025/01/0089" },
          { label: "Data wystawienia", value: "22.01.2025" },
          { label: "Termin płatności", value: "05.02.2025" },
          { label: "Sprzedawca", value: "CloudBase S.A." },
          { label: "Nabywca", value: "M**** Z****" },
          { label: "NIP sprzedawcy", value: "782****519" },
          { label: "Razem netto", value: "8900.00 zł" },
          { label: "VAT", value: "2047.00 zł" },
          { label: "Do zapłaty", value: "10947.00 zł" },
        ],
      },
      {
        name: "FV/2025/02/0015",
        fields: [
          { label: "Numer faktury", value: "FV/2025/02/0015" },
          { label: "Data wystawienia", value: "03.02.2025" },
          { label: "Termin płatności", value: "17.02.2025" },
          { label: "Sprzedawca", value: "DataPro Consulting Sp. z o.o." },
          { label: "Nabywca", value: "A**** N****" },
          { label: "NIP sprzedawcy", value: "639****871" },
          { label: "Razem netto", value: "22100.00 zł" },
          { label: "VAT", value: "5083.00 zł" },
          { label: "Do zapłaty", value: "27183.00 zł" },
        ],
      },
      {
        name: "FV/2025/02/0103",
        fields: [
          { label: "Numer faktury", value: "FV/2025/02/0103" },
          { label: "Data wystawienia", value: "18.02.2025" },
          { label: "Termin płatności", value: "04.03.2025" },
          { label: "Sprzedawca", value: "SecureIT Solutions Sp. z o.o." },
          { label: "Nabywca", value: "P**** K****" },
          { label: "NIP sprzedawcy", value: "418****654" },
          { label: "Razem netto", value: "5670.00 zł" },
          { label: "VAT", value: "1304.10 zł" },
          { label: "Do zapłaty", value: "6974.10 zł" },
        ],
      },
      {
        name: "FV/2025/03/0027",
        fields: [
          { label: "Numer faktury", value: "FV/2025/03/0027" },
          { label: "Data wystawienia", value: "10.03.2025" },
          { label: "Termin płatności", value: "24.03.2025" },
          { label: "Sprzedawca", value: "WebDev Masters Sp. z o.o." },
          { label: "Nabywca", value: "T**** B****" },
          { label: "NIP sprzedawcy", value: "325****792" },
          { label: "Razem netto", value: "16350.00 zł" },
          { label: "VAT", value: "3760.50 zł" },
          { label: "Do zapłaty", value: "20110.50 zł" },
        ],
      },
    ];

    // Animate through stages
    for (let i = 0; i < stages.length; i++) {
      setKsefStage(stages[i]);
      const duration = 400 + Math.random() * 800;
      const targetProgress = ((i + 1) / stages.length) * 100;

      // Smooth progress increment
      const steps = 10;
      const startProgress = (i / stages.length) * 100;
      for (let s = 0; s < steps; s++) {
        await new Promise((r) => setTimeout(r, duration / steps));
        setKsefProgress(startProgress + ((targetProgress - startProgress) * (s + 1)) / steps);
      }
    }

    // Add fake invoices to state
    const current = await loadIndex();
    const newInvoices: Invoice[] = ksefInvoices.map((kInv) => ({
      id: `ksef-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: kInv.name,
      uri: "",
      addedAt: Date.now(),
      summary: {
        fields: kInv.fields,
        rawOcr: `[KSeF e-Invoice] ${kInv.name}`,
        status: "done" as const,
      },
    }));

    const updated = [...current, ...newInvoices];
    saveIndex(updated);
    setInvoices(updated);

    setKsefSyncing(false);
    setKsefProgress(0);
    setKsefStage("");
    Alert.alert(
      "KSeF Sync Complete",
      `Downloaded ${ksefInvoices.length} invoices from the National e-Invoice System.`
    );
  }, []);

  const scanAndMask = useCallback(async () => {
    if (!ocr.isReady) {
      Alert.alert("OCR not ready", "Please wait for the OCR model to load.");
      return;
    }

    const unscanned = invoices.filter((inv) => !inv.summary || inv.summary.status === "error");
    if (unscanned.length === 0) {
      Alert.alert("All done", "All invoices have already been scanned.");
      return;
    }

    setScanning(true);

    const updated = [...invoices];
    for (const inv of unscanned) {
      const idx = updated.findIndex((i) => i.id === inv.id);
      updated[idx] = {
        ...updated[idx],
        summary: { fields: [], rawOcr: "", status: "processing" },
      };
      setInvoices([...updated]);

      try {
        // Step 1: OCR — extract raw text from invoice image
        const ocrResult = await ocr.forward(inv.uri);

        // Sort detections top-to-bottom, left-to-right for reading order
        const sorted = [...ocrResult].sort((a, b) => {
          const ay = Math.min(...a.bbox.map((p) => p.y));
          const by = Math.min(...b.bbox.map((p) => p.y));
          const lineThreshold = 15;
          if (Math.abs(ay - by) < lineThreshold) {
            const ax = Math.min(...a.bbox.map((p) => p.x));
            const bx = Math.min(...b.bbox.map((p) => p.x));
            return ax - bx;
          }
          return ay - by;
        });

        const rawOcrText = sorted.map((d) => d.text).join(" ");

        if (!rawOcrText.trim()) {
          updated[idx] = {
            ...updated[idx],
            summary: {
              fields: [{ label: "Status", value: "Nie wykryto tekstu na obrazie" }],
              rawOcr: "",
              status: "done",
            },
          };
          setInvoices([...updated]);
          saveIndex([...updated]);
          continue;
        }

        // Step 2: Extract fields using pattern matching (no LLM — no hallucination)
        const fields = extractInvoiceFields(rawOcrText);

        updated[idx] = {
          ...updated[idx],
          summary: {
            fields,
            rawOcr: rawOcrText,
            status: "done",
          },
        };
      } catch (err: any) {
        updated[idx] = {
          ...updated[idx],
          summary: {
            fields: [],
            rawOcr: "",
            status: "error",
            error: err.message ?? "Scan failed",
          },
        };
      }

      setInvoices([...updated]);
      saveIndex([...updated]);
    }

    setScanning(false);
  }, [invoices, ocr]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
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
        ? "OCR loaded and ready!"
        : `Downloading OCR model... ${Math.round(ocr.downloadProgress * 100)}%`;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.dashboardContainer}>
          <View style={styles.dashboardHeader}>
            <Text style={styles.dashboardTitle}>
              Safe<Text style={styles.titleAccent}>Taxes</Text>
            </Text>
            <Text style={styles.subtitle}>Hybrid tax settlements</Text>
          </View>

          <View style={styles.content}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.neonDot} />
                <Text style={styles.cardTitle}>Tax Year 2025</Text>
              </View>
              <Text style={styles.cardDesc}>
                Your assistant uses on-device OCR to read invoices and
                extract key data — all processed locally, offline, and private.
              </Text>

              <Link href="/upload" asChild>
                <Pressable style={styles.dashboardButton}>
                  <Text style={styles.dashboardButtonText}>Upload Documents</Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </View>

        <View style={styles.scannerContainer}>
          <Text style={styles.scannerTitle}>Invoice Scanner</Text>

          <Text style={styles.status}>{statusText}</Text>

          {!started && (
            <TouchableOpacity
              style={styles.scannerButton}
              onPress={() => setStarted(true)}
            >
              <Text style={styles.scannerButtonText}>Load OCR Model</Text>
            </TouchableOpacity>
          )}

          {started && !ocr.isReady && !ocr.error && (
            <ActivityIndicator size="large" color="#8B5CF6" />
          )}

          {ocr.isReady && (
            <View style={styles.successBadge}>
              <Text style={styles.successText}>OCR Model Ready</Text>
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
              <Text style={styles.scannerButtonText}>+ Add Invoices</Text>
            )}
          </TouchableOpacity>

          {/* KSeF sync button */}
          <TouchableOpacity
            style={[styles.scannerButton, styles.ksefButton]}
            onPress={syncFromKsef}
            disabled={ksefSyncing || scanning}
          >
            <Text style={styles.scannerButtonText}>Download from KSeF</Text>
          </TouchableOpacity>

          {/* KSeF progress overlay */}
          {ksefSyncing && (
            <View style={styles.ksefProgressBox}>
              <Text style={styles.ksefProgressTitle}>KSeF Synchronization</Text>
              <Text style={styles.ksefStageText}>{ksefStage}</Text>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${Math.round(ksefProgress)}%` }]} />
              </View>
              <Text style={styles.ksefPercentText}>{Math.round(ksefProgress)}%</Text>
            </View>
          )}

          {/* Scan & Mask button */}
          {invoices.length > 0 && ocr.isReady && (
            <TouchableOpacity
              style={[styles.scannerButton, styles.maskButton]}
              onPress={scanAndMask}
              disabled={scanning}
            >
              {scanning ? (
                <View style={styles.scanningRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.scannerButtonText}>  Scanning...</Text>
                </View>
              ) : (
                <Text style={styles.scannerButtonText}>Scan & Mask Invoices</Text>
              )}
            </TouchableOpacity>
          )}

          {/* Invoice list */}
          {invoices.length > 0 && (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Your Invoices ({invoices.length})</Text>
              {invoices.map((inv) => (
                <View key={inv.id}>
                  <TouchableOpacity
                    style={[
                      styles.invoiceRow,
                      inv.summary?.status === "done" && styles.invoiceRowScanned,
                    ]}
                    onPress={() => inv.summary?.status === "done" && toggleExpand(inv.id)}
                    onLongPress={() => confirmRemove(inv)}
                  >
                    <View style={[
                      styles.iconBox,
                      inv.summary?.status === "done" && styles.iconBoxScanned,
                    ]}>
                      <Text style={[
                        styles.iconText,
                        inv.summary?.status === "done" && styles.iconTextScanned,
                      ]}>
                        {inv.summary?.status === "processing" ? "..." :
                         inv.summary?.status === "done" ? "OK" :
                         inv.summary?.status === "error" ? "!" : "IMG"}
                      </Text>
                    </View>
                    <View style={styles.invoiceInfo}>
                      <Text style={styles.invoiceName} numberOfLines={1}>
                        {inv.name}
                      </Text>
                      <Text style={styles.invoiceMeta}>
                        {new Date(inv.addedAt).toLocaleDateString("en-US")}
                        {inv.size ? `  •  ${formatSize(inv.size)}` : ""}
                        {inv.summary?.status === "done"
                          ? `  •  ${inv.summary.fields.length} fields`
                          : ""}
                        {inv.summary?.status === "processing" ? "  •  Scanning..." : ""}
                        {inv.summary?.status === "error" ? "  •  Error" : ""}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => confirmRemove(inv)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.deleteButtonText}>✕</Text>
                    </TouchableOpacity>
                    {inv.summary?.status === "done" && (
                      <Text style={styles.expandArrow}>
                        {expandedId === inv.id ? "▲" : "▼"}
                      </Text>
                    )}
                  </TouchableOpacity>

                  {/* Expanded: structured fields */}
                  {expandedId === inv.id && inv.summary?.status === "done" && (
                    <View style={styles.summaryBox}>
                      <Text style={styles.summaryTitle}>Invoice Data (Masked)</Text>

                      {inv.summary.fields.map((field, i) => (
                        <View key={i} style={styles.fieldRow}>
                          <Text style={styles.fieldLabel}>{field.label}</Text>
                          <Text style={styles.fieldValue}>{field.value}</Text>
                        </View>
                      ))}

                    </View>
                  )}

                  {expandedId === inv.id && inv.summary?.status === "error" && (
                    <View style={[styles.summaryBox, styles.summaryBoxError]}>
                      <Text style={styles.summaryErrorText}>{inv.summary.error}</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {invoices.length === 0 && (
            <Text style={styles.emptyText}>
              No invoices added yet. Tap above to add invoice images.
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
    color: "#8B5CF6",
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
  iconBox: {
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
  iconText: {
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
  maskButton: {
    backgroundColor: "#8B5CF6",
    marginTop: 24,
    marginBottom: 8,
  },
  scanningRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  invoiceRowScanned: {
    borderColor: "rgba(139, 92, 246, 0.3)",
  },
  iconBoxScanned: {
    backgroundColor: "rgba(139, 92, 246, 0.15)",
    borderColor: "rgba(139, 92, 246, 0.3)",
  },
  iconTextScanned: {
    color: "#A78BFA",
  },
  deleteButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  deleteButtonText: {
    color: "#F87171",
    fontSize: 14,
    fontWeight: "700",
  },
  expandArrow: {
    color: "#A1A1AA",
    fontSize: 12,
    marginLeft: 8,
  },
  summaryBox: {
    backgroundColor: "#1C1C1E",
    marginTop: -4,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.2)",
  },
  summaryBoxError: {
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#8B5CF6",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  fieldRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#A1A1AA",
    width: 130,
  },
  fieldValue: {
    fontSize: 13,
    color: "#E4E4E7",
    flex: 1,
  },
  summaryErrorText: {
    fontSize: 13,
    color: "#F87171",
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
  ksefButton: {
    backgroundColor: "#F59E0B",
    marginTop: 12,
  },
  ksefProgressBox: {
    width: "100%",
    backgroundColor: "#171717",
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  ksefProgressTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#F59E0B",
    marginBottom: 12,
    textAlign: "center",
  },
  ksefStageText: {
    fontSize: 13,
    color: "#D4D4D8",
    marginBottom: 12,
    textAlign: "center",
  },
  progressBarBg: {
    width: "100%",
    height: 8,
    backgroundColor: "#262626",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 8,
    backgroundColor: "#F59E0B",
    borderRadius: 4,
  },
  ksefPercentText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F59E0B",
    textAlign: "center",
    marginTop: 8,
  },
});
