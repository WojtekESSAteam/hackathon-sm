import { useState, useEffect, useCallback } from "react";
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File, Directory, Paths } from "expo-file-system";
import { useOCR, OCR_POLISH } from "react-native-executorch";
import { Link, useRouter } from "expo-router";

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
  if (invNum) fields.push({ label: "Invoice Number", value: invNum });

  // Data wystawienia: DD.MM.YYYY (only after "Data wystawienia")
  const date = grab(/Data\s*wystawienia[:\s]*(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/i);
  if (date) fields.push({ label: "Issue Date", value: date });

  // Termin platnosci: DD.MM.YYYY
  const termin = grab(/Termin\s*p[lł]atno[sś]ci[:\s]*(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/i);
  if (termin) fields.push({ label: "Payment Due", value: termin });

  // Sprzedawca: everything between "Sprzedawca:" and "NIP" (strip FAKTURA VAT prefix)
  const seller = grab(/Sprzedawca[:\s]+(?:FAKTURA\s*VAT\s*)?(.+?)(?=\s*NIP\b)/i);
  if (seller) fields.push({ label: "Seller", value: maskSensitive(seller) });

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
  if (buyer) fields.push({ label: "Buyer", value: maskSensitive(buyer) });

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
  if (netto) fields.push({ label: "Net Total", value: cleanAmount(netto) + " PLN" });

  // VAT: "VAT (89): 302.76 zI" — require parens with rate to skip "Cena netto VAT Netto Brutto" header
  // OCR often renders "zł" as "zI" or "zl"
  const vat = grab(/VAT\s*\(\d+%?\)[:\s]*([\d,\.]+)/i);
  if (vat) fields.push({ label: "VAT", value: cleanAmount(vat) + " PLN" });

  // Do zapłaty / Do zaplaty: number
  const payment = grab(/Do\s*zap[lł]aty[:\s]*([\d,\.]+)/i);
  if (payment) fields.push({ label: "Amount Due", value: cleanAmount(payment) + " PLN" });

  if (fields.length === 0) {
    fields.push({ label: "Status", value: "No invoice fields recognized" });
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
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [picking, setPicking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ksefSyncing, setKsefSyncing] = useState(false);
  const [ksefProgress, setKsefProgress] = useState(0);
  const [ksefStage, setKsefStage] = useState("");

  // Custom popup state
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

  // OCR for text extraction from images (Polish) — loads automatically
  const ocr = useOCR({ model: OCR_POLISH });

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
      showPopup("error", "Error", err.message ?? "Failed to pick documents");
    } finally {
      setPicking(false);
    }
  }, []);

  const scanWithCamera = useCallback(async () => {
    setPicking(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        showPopup("warning", "Permission needed", "Camera access is required to scan invoices.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.9,
        allowsEditing: true,
      });

      if (result.canceled || !result.assets?.length) return;

      ensureInvoicesDir();
      const asset = result.assets[0];
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const dest = new File(invoicesDir, `${id}.jpg`);
      const src = new File(asset.uri);
      src.copy(dest);

      const current = await loadIndex();
      const newInv: Invoice = {
        id,
        name: `Scan_${new Date().toISOString().slice(0, 10)}_${id.slice(-4)}.jpg`,
        uri: dest.uri,
        addedAt: Date.now(),
        size: asset.fileSize ?? undefined,
      };

      const updated = [...current, newInv];
      saveIndex(updated);
      setInvoices(updated);

      // Auto-run OCR on the scanned invoice
      if (ocr.isReady) {
        const withProcessing = updated.map((inv) =>
          inv.id === id
            ? { ...inv, summary: { fields: [], rawOcr: "", status: "processing" as const } }
            : inv
        );
        setInvoices([...withProcessing]);

        try {
          const ocrResult = await ocr.forward(dest.uri);
          const sorted = [...ocrResult].sort((a, b) => {
            const ay = Math.min(...a.bbox.map((p) => p.y));
            const by = Math.min(...b.bbox.map((p) => p.y));
            if (Math.abs(ay - by) < 15) {
              return Math.min(...a.bbox.map((p) => p.x)) - Math.min(...b.bbox.map((p) => p.x));
            }
            return ay - by;
          });
          const rawOcrText = sorted.map((d) => d.text).join(" ");
          const fields = rawOcrText.trim() ? extractInvoiceFields(rawOcrText) : [{ label: "Status", value: "No text detected" }];

          const final = withProcessing.map((inv) =>
            inv.id === id ? { ...inv, summary: { fields, rawOcr: rawOcrText, status: "done" as const } } : inv
          );
          setInvoices([...final]);
          saveIndex([...final]);
        } catch {
          const errState = withProcessing.map((inv) =>
            inv.id === id ? { ...inv, summary: { fields: [], rawOcr: "", status: "error" as const, error: "OCR failed" } } : inv
          );
          setInvoices([...errState]);
          saveIndex([...errState]);
        }
      }
    } catch (err: any) {
      showPopup("error", "Error", err.message ?? "Camera failed");
    } finally {
      setPicking(false);
    }
  }, [ocr]);

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
    showPopup(
      "confirm",
      "Remove invoice",
      `Remove "${inv.name}"?`,
      () => removeInvoice(inv.id),
      "Remove",
      "Cancel",
    );
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
          { label: "Invoice Number", value: "FV/2025/01/0042" },
          { label: "Issue Date", value: "15.01.2025" },
          { label: "Payment Due", value: "29.01.2025" },
          { label: "Seller", value: "NetSoft Sp. z o.o." },
          { label: "Buyer", value: "K**** W****" },
          { label: "Seller Tax ID", value: "541****238" },
          { label: "Net Total", value: "12450.00 PLN" },
          { label: "VAT", value: "2863.50 PLN" },
          { label: "Amount Due", value: "15313.50 PLN" },
        ],
      },
      {
        name: "FV/2025/01/0089",
        fields: [
          { label: "Invoice Number", value: "FV/2025/01/0089" },
          { label: "Issue Date", value: "22.01.2025" },
          { label: "Payment Due", value: "05.02.2025" },
          { label: "Seller", value: "CloudBase S.A." },
          { label: "Buyer", value: "M**** Z****" },
          { label: "Seller Tax ID", value: "782****519" },
          { label: "Net Total", value: "8900.00 PLN" },
          { label: "VAT", value: "2047.00 PLN" },
          { label: "Amount Due", value: "10947.00 PLN" },
        ],
      },
      {
        name: "FV/2025/02/0015",
        fields: [
          { label: "Invoice Number", value: "FV/2025/02/0015" },
          { label: "Issue Date", value: "03.02.2025" },
          { label: "Payment Due", value: "17.02.2025" },
          { label: "Seller", value: "DataPro Consulting Sp. z o.o." },
          { label: "Buyer", value: "A**** N****" },
          { label: "Seller Tax ID", value: "639****871" },
          { label: "Net Total", value: "22100.00 PLN" },
          { label: "VAT", value: "5083.00 PLN" },
          { label: "Amount Due", value: "27183.00 PLN" },
        ],
      },
      {
        name: "FV/2025/02/0103",
        fields: [
          { label: "Invoice Number", value: "FV/2025/02/0103" },
          { label: "Issue Date", value: "18.02.2025" },
          { label: "Payment Due", value: "04.03.2025" },
          { label: "Seller", value: "SecureIT Solutions Sp. z o.o." },
          { label: "Buyer", value: "P**** K****" },
          { label: "Seller Tax ID", value: "418****654" },
          { label: "Net Total", value: "5670.00 PLN" },
          { label: "VAT", value: "1304.10 PLN" },
          { label: "Amount Due", value: "6974.10 PLN" },
        ],
      },
      {
        name: "FV/2025/03/0027",
        fields: [
          { label: "Invoice Number", value: "FV/2025/03/0027" },
          { label: "Issue Date", value: "10.03.2025" },
          { label: "Payment Due", value: "24.03.2025" },
          { label: "Seller", value: "WebDev Masters Sp. z o.o." },
          { label: "Buyer", value: "T**** B****" },
          { label: "Seller Tax ID", value: "325****792" },
          { label: "Net Total", value: "16350.00 PLN" },
          { label: "VAT", value: "3760.50 PLN" },
          { label: "Amount Due", value: "20110.50 PLN" },
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
    showPopup(
      "success",
      "KSeF Sync Complete",
      `Downloaded ${ksefInvoices.length} invoices from the National e-Invoice System.`
    );
  }, []);

  const scanAndMask = useCallback(async () => {
    if (!ocr.isReady) {
      showPopup("warning", "OCR not ready", "Please wait for the OCR model to load.");
      return;
    }

    const unscanned = invoices.filter((inv) => !inv.summary || inv.summary.status === "error");
    if (unscanned.length === 0) {
      showPopup("success", "All done", "All invoices have already been scanned.");
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
              fields: [{ label: "Status", value: "No text detected in image" }],
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

  const statusText = ocr.error
    ? `Error: ${ocr.error.message}`
    : ocr.isReady
      ? "Ready"
      : `Downloading model... ${Math.round(ocr.downloadProgress * 100)}%`;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.dashboardTitle}>
              Safe<Text style={styles.titleAccent}>Taxes</Text>
            </Text>
            <Text style={styles.subtitle}>Hybrid tax settlements</Text>
          </View>
          <Link href="/upload" asChild>
            <Pressable style={styles.chatBtn}>
              <View style={styles.chatIcon}>
                <View style={styles.chatBubble} />
                <View style={styles.chatBubbleTail} />
              </View>
            </Pressable>
          </Link>
        </View>

        {/* Scanner section */}
        <View style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>Invoices</Text>
            <View style={[
              styles.statusPill,
              ocr.isReady && styles.statusPillReady,
              ocr.error && styles.statusPillError,
            ]}>
              {!ocr.isReady && !ocr.error && (
                <ActivityIndicator size="small" color="#8B5CF6" style={{ marginRight: 6 }} />
              )}
              <Text style={[
                styles.statusPillText,
                ocr.isReady && styles.statusPillTextReady,
                ocr.error && styles.statusPillTextError,
              ]}>
                {statusText}
              </Text>
            </View>
          </View>

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

          {/* Invoice list */}
          {invoices.length > 0 && (
            <View style={styles.listSection}>
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
                      style={styles.chatRowBtn}
                      onPress={() => {
                        const dataStr = inv.summary?.fields
                          .map((f) => `${f.label}: ${f.value}`)
                          .join("\n");
                        router.push({
                          pathname: "/chat",
                          params: { invoiceData: dataStr, invoiceName: inv.name, invoiceId: inv.id },
                        } as any);
                      }}
                    >
                      <Text style={styles.chatRowBtnText}>💬</Text>
                    </TouchableOpacity>

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
              No invoices yet. Add invoices or sync from KSeF.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* Bottom action bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.bottomSideIcon, styles.bottomSideIconKsef]}
          onPress={syncFromKsef}
          disabled={ksefSyncing || scanning}
          activeOpacity={0.7}
        >
          <Text style={styles.ksefArrow}>↓</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomSideIcon, styles.bottomSideIconCamera]}
          onPress={scanWithCamera}
          disabled={picking}
          activeOpacity={0.7}
        >
          <View style={styles.cameraIcon}>
            <View style={styles.cameraBody} />
            <View style={styles.cameraLens} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomSideIcon, styles.bottomSideIconMask]}
          onPress={scanAndMask}
          disabled={scanning || !ocr.isReady || invoices.length === 0}
          activeOpacity={0.7}
        >
          {scanning ? (
            <ActivityIndicator color="#A78BFA" size="small" />
          ) : (
            <View style={styles.maskIconOuter}>
              <View style={styles.maskIconInner} />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bottomCenterBtn}
          onPress={pickInvoices}
          disabled={picking}
          activeOpacity={0.8}
        >
          {picking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.bottomCenterIcon}>+</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Custom popup modal */}
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
              {popup.onConfirm && popup.cancelLabel && (
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
                  !popup.onConfirm && { flex: 1 },
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
  safeArea: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  root: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  dashboardTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -1,
  },
  titleAccent: {
    color: "#8B5CF6",
  },
  subtitle: {
    fontSize: 14,
    color: "#A1A1AA",
    marginTop: 2,
    fontWeight: "500",
  },
  chatBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.3)",
  },
  chatIcon: {
    width: 22,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  chatBubble: {
    width: 20,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#8B5CF6",
  },
  chatBubbleTail: {
    position: "absolute",
    bottom: -2,
    right: 2,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderBottomWidth: 5,
    borderLeftColor: "transparent",
    borderBottomColor: "#8B5CF6",
    transform: [{ rotate: "20deg" }],
  },
  scannerContainer: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  scannerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: 20,
  },
  scannerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(139, 92, 246, 0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.2)",
  },
  statusPillReady: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  statusPillError: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#A78BFA",
  },
  statusPillTextReady: {
    color: "#34D399",
  },
  statusPillTextError: {
    color: "#F87171",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
    paddingBottom: 28,
    paddingTop: 10,
    backgroundColor: "rgba(10, 10, 10, 0.95)",
    borderTopWidth: 1,
    borderTopColor: "#1C1C1E",
  },
  bottomSideIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#171717",
    borderWidth: 1,
    borderColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomSideIconKsef: {
    borderColor: "rgba(245, 158, 11, 0.25)",
  },
  bottomSideIconCamera: {
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  cameraIcon: {
    width: 22,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBody: {
    width: 20,
    height: 14,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: "#34D399",
  },
  cameraLens: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#34D399",
  },
  bottomSideIconMask: {
    borderColor: "rgba(139, 92, 246, 0.25)",
  },
  ksefArrow: {
    fontSize: 20,
    color: "#F59E0B",
    fontWeight: "700",
  },
  maskIconOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#A78BFA",
    alignItems: "center",
    justifyContent: "center",
  },
  maskIconInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#A78BFA",
  },
  bottomCenterBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#8B5CF6",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  bottomCenterIcon: {
    fontSize: 28,
    fontWeight: "500",
    color: "#FFFFFF",
    marginTop: -1,
  },
  listSection: {
    width: "100%",
    marginTop: 16,
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
  chatRowBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(139, 92, 246, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.2)",
  },
  chatRowBtnText: {
    fontSize: 14,
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
