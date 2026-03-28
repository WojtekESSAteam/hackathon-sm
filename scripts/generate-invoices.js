#!/usr/bin/env node
/**
 * Generates fake PDF invoices for testing the invoice scanning app.
 *
 * Usage:
 *   node scripts/generate-invoices.js            # generates 5 invoices
 *   node scripts/generate-invoices.js 20          # generates 20 invoices
 *   node scripts/generate-invoices.js --out ./my-dir  # custom output dir
 */

const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

// --- Configuration -----------------------------------------------------------

const args = process.argv.slice(2);
let count = 5;
let outDir = path.join(__dirname, "..", "sample-invoices");

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" && args[i + 1]) {
    outDir = path.resolve(args[++i]);
  } else if (!isNaN(Number(args[i]))) {
    count = Number(args[i]);
  }
}

fs.mkdirSync(outDir, { recursive: true });

// --- Fake data pools ---------------------------------------------------------

function randomNIP() {
  const digits = Array.from({ length: 10 }, () => randInt(0, 9));
  return `${digits.slice(0, 3).join("")}-${digits.slice(3, 6).join("")}-${digits.slice(6, 8).join("")}-${digits.slice(8, 10).join("")}`;
}

const companies = [
  { name: "ByteCode Sp. z o.o.", address: "ul. Marszalkowska 12, 00-590 Warszawa" },
  { name: "TechPol S.A.", address: "ul. Dluga 45, 31-147 Krakow" },
  { name: "DataSoft Sp. z o.o.", address: "ul. Piotrkowska 88, 90-001 Lodz" },
  { name: "CyberNova Sp. z o.o.", address: "ul. Swidnicka 33, 50-066 Wroclaw" },
  { name: "NetPoint S.A.", address: "ul. Sw. Marcin 21, 61-803 Poznan" },
  { name: "CloudWorks Sp. z o.o.", address: "ul. Starowislna 17, 31-038 Krakow" },
  { name: "InfoSys Polska Sp. z o.o.", address: "ul. Grunwaldzka 102, 80-244 Gdansk" },
  { name: "SmartDev S.A.", address: "ul. Pilsudskiego 5, 35-075 Rzeszow" },
];

const clients = [
  { name: "Jan Kowalski", address: "ul. Kwiatowa 7, 00-001 Warszawa" },
  { name: "Anna Nowak", address: "ul. Lipowa 15, 30-002 Krakow" },
  { name: "Piotr Wisniewski", address: "ul. Polna 22, 60-003 Poznan" },
  { name: "Maria Wojciechowska", address: "ul. Lesna 9, 50-004 Wroclaw" },
  { name: "Tomasz Kaminski", address: "ul. Ogrodowa 31, 90-005 Lodz" },
  { name: "Katarzyna Lewandowska", address: "ul. Morska 44, 80-006 Gdansk" },
  { name: "Michal Zielinski", address: "ul. Sloneczna 18, 35-007 Rzeszow" },
  { name: "Agnieszka Szymanska", address: "ul. Parkowa 56, 40-008 Katowice" },
];

const items = [
  { desc: "Uslugi programistyczne", unitPrice: [150, 450] },
  { desc: "Projektowanie UI/UX", unitPrice: [120, 350] },
  { desc: "Hosting w chmurze (miesiecznie)", unitPrice: [50, 250] },
  { desc: "Administracja baz danych", unitPrice: [200, 400] },
  { desc: "Konsulting IT", unitPrice: [250, 600] },
  { desc: "Tworzenie aplikacji mobilnych", unitPrice: [300, 700] },
  { desc: "Optymalizacja SEO", unitPrice: [100, 300] },
  { desc: "Raport analityczny", unitPrice: [500, 1200] },
  { desc: "Audyt bezpieczenstwa", unitPrice: [800, 2000] },
  { desc: "Dokumentacja techniczna", unitPrice: [80, 250] },
  { desc: "Integracja API", unitPrice: [350, 900] },
  { desc: "Testowanie QA (za godzine)", unitPrice: [120, 300] },
  { desc: "Utrzymanie serwerow", unitPrice: [150, 400] },
  { desc: "Licencja oprogramowania (roczna)", unitPrice: [1000, 5000] },
];

const sym = "zl";
const taxRates = [0.23, 0.08, 0.05, 0];

// --- Helpers -----------------------------------------------------------------

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) => +(Math.random() * (max - min) + min).toFixed(2);
const fmtMoney = (n) => `${n.toFixed(2)} ${sym}`;

function randomDate(startYear = 2023, endYear = 2026) {
  const y = randInt(startYear, endYear);
  const m = randInt(1, 12);
  const d = randInt(1, 28);
  return new Date(y, m - 1, d);
}

function fmtDate(d) {
  return d.toLocaleDateString("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// --- PDF generation ----------------------------------------------------------

function generateInvoice(index) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const invoiceNum = `FV/${String(randInt(1, 999)).padStart(3, "0")}/${randInt(2023, 2026)}`;
  const company = pick(companies);
  const companyNIP = randomNIP();
  const client = pick(clients);
  const clientNIP = randomNIP();
  const taxRate = pick(taxRates);
  const issueDate = randomDate();
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + pick([14, 30, 45, 60]));

  const lineItems = [];
  const numItems = randInt(2, 6);
  for (let i = 0; i < numItems; i++) {
    const item = pick(items);
    const qty = randInt(1, 20);
    const priceNetto = randFloat(item.unitPrice[0], item.unitPrice[1]);
    const vatAmount = +(priceNetto * taxRate).toFixed(2);
    const priceBrutto = +(priceNetto + vatAmount).toFixed(2);
    lineItems.push({
      desc: item.desc, qty, priceNetto,
      vatAmount: +(vatAmount * qty).toFixed(2),
      totalNetto: +(qty * priceNetto).toFixed(2),
      totalBrutto: +(qty * priceBrutto).toFixed(2),
    });
  }

  const sumNetto = +lineItems.reduce((s, i) => s + i.totalNetto, 0).toFixed(2);
  const sumVat = +lineItems.reduce((s, i) => s + i.vatAmount, 0).toFixed(2);
  const sumBrutto = +lineItems.reduce((s, i) => s + i.totalBrutto, 0).toFixed(2);

  const safeInvoiceNum = invoiceNum.replace(/\//g, "-");
  const filePath = path.join(outDir, `${safeInvoiceNum}.pdf`);
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Header
  doc.fontSize(24).font("Helvetica-Bold").text("FAKTURA VAT", { align: "right" });
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").text(invoiceNum, { align: "right" });

  // Sprzedawca (seller)
  doc.fontSize(12).font("Helvetica-Bold").text("Sprzedawca:", 50, 50);
  doc.fontSize(10).font("Helvetica-Bold").text(company.name);
  doc.fontSize(9).font("Helvetica").text(company.address);
  doc.font("Helvetica-Bold").text(`NIP: ${companyNIP}`);

  doc.moveDown(1);

  // Nabywca (buyer)
  doc.fontSize(12).font("Helvetica-Bold").text("Nabywca:");
  doc.fontSize(10).font("Helvetica-Bold").text(client.name);
  doc.fontSize(9).font("Helvetica").text(client.address);
  doc.font("Helvetica-Bold").text(`NIP: ${clientNIP}`);

  // Dates
  const dateX = 350;
  const dateY = doc.y - 60;
  doc.fontSize(9).font("Helvetica-Bold").text("Data wystawienia:", dateX, dateY, { continued: true });
  doc.font("Helvetica").text(`  ${fmtDate(issueDate)}`);
  doc.font("Helvetica-Bold").text("Termin platnosci:", dateX, doc.y, { continued: true });
  doc.font("Helvetica").text(`  ${fmtDate(dueDate)}`);
  doc.font("Helvetica-Bold").text("Waluta:", dateX, doc.y, { continued: true });
  doc.font("Helvetica").text("  PLN");

  doc.moveDown(2);

  // Table header
  const tableTop = doc.y;
  const col = { desc: 50, qty: 250, priceNetto: 300, vat: 380, totalNetto: 430, totalBrutto: 480 };

  doc.rect(50, tableTop - 4, 500, 18).fill("#4a90d9");
  doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
  doc.text("Opis", col.desc, tableTop, { width: 190 });
  doc.text("Ilosc", col.qty, tableTop, { width: 40, align: "right" });
  doc.text("Cena netto", col.priceNetto, tableTop, { width: 70, align: "right" });
  doc.text("VAT", col.vat, tableTop, { width: 40, align: "right" });
  doc.text("Netto", col.totalNetto, tableTop, { width: 50, align: "right" });
  doc.text("Brutto", col.totalBrutto, tableTop, { width: 60, align: "right" });

  doc.fillColor("#000000");

  // Table rows
  let y = tableTop + 22;
  lineItems.forEach((item, i) => {
    if (i % 2 === 0) {
      doc.rect(50, y - 4, 500, 18).fill("#f0f4f8");
      doc.fillColor("#000000");
    }
    doc.fontSize(8).font("Helvetica");
    doc.text(item.desc, col.desc, y, { width: 190 });
    doc.text(String(item.qty), col.qty, y, { width: 40, align: "right" });
    doc.text(fmtMoney(item.priceNetto), col.priceNetto, y, { width: 70, align: "right" });
    doc.text(fmtMoney(item.vatAmount), col.vat, y, { width: 40, align: "right" });
    doc.text(fmtMoney(item.totalNetto), col.totalNetto, y, { width: 50, align: "right" });
    doc.text(fmtMoney(item.totalBrutto), col.totalBrutto, y, { width: 60, align: "right" });
    y += 20;
  });

  // Totals
  y += 10;
  doc.moveTo(300, y).lineTo(550, y).stroke();
  y += 8;
  doc.fontSize(9).font("Helvetica");
  doc.text("Razem netto:", 300, y, { width: 130, align: "right" });
  doc.text(fmtMoney(sumNetto), col.totalBrutto, y, { width: 60, align: "right" });
  y += 16;
  doc.text(`VAT (${(taxRate * 100).toFixed(0)}%):`, 300, y, { width: 130, align: "right" });
  doc.text(fmtMoney(sumVat), col.totalBrutto, y, { width: 60, align: "right" });
  y += 18;
  doc.moveTo(300, y).lineTo(550, y).stroke();
  y += 8;
  doc.fontSize(12).font("Helvetica-Bold").text("Do zaplaty:", 300, y, { width: 130, align: "right" });
  doc.text(fmtMoney(sumBrutto), col.totalBrutto, y, { width: 60, align: "right" });

  // Footer
  doc.fontSize(8).font("Helvetica").fillColor("#888888");
  doc.text("Dziekujemy za wspolprace!", 50, 750, { align: "center", width: 500 });
  doc.text("Prosimy o terminowa wplate na wskazany rachunek bankowy.", 50, 762, { align: "center", width: 500 });

  doc.end();

  return new Promise((resolve) => {
    stream.on("finish", () => {
      console.log(`  ✓ ${safeInvoiceNum}.pdf  (${numItems} pozycji, brutto: ${fmtMoney(sumBrutto)})`);
      resolve(filePath);
    });
  });
}

// --- Main --------------------------------------------------------------------

async function main() {
  console.log(`Generating ${count} fake invoice(s) in ${outDir}\n`);
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(generateInvoice(i));
  }
  await Promise.all(promises);
  console.log(`\nDone! ${count} invoices saved to ${outDir}`);
}

main().catch(console.error);
