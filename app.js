// ===================== Brand config =====================
// Ganti path logo di /assets setelah file logo asli di-upload (lihat assets/README.md)
const BRANDS = {
  melanao: {
    label: "Melanao Indonesia",
    tagline: "Halal Food Photographer",
    phone: "0813 8748 3295",
    email: "melanaoproject@gmail.com",
    logo: "assets/logo-melanao.png",
    accent: "#c96f3e",
    accentSoft: "#f4e3d8",
    code: "MEL",
    dpTermsTemplate: (dp) =>
      `**Down Payment (DP) sebesar ${dp}%** dari total invoice dibayarkan sebagai konfirmasi jadwal dan penguncian slot produksi.`,
    remainingTermsTemplate: (remaining) =>
      `**Sisa pembayaran ${remaining}%** dilakukan maksimal **3 hari kalender** setelah klien menerima hasil preview foto dan sebelum file final dikirimkan.`,
    quotationTerms: [
      "**Down Payment (DP) sebesar 50% atau Full Payment** dari total invoice dibayarkan sebagai konfirmasi jadwal dan penguncian slot produksi.",
      "**Sisa pembayaran 50%** dilakukan maksimal **3 hari kalender** setelah klien menerima hasil preview foto dan sebelum file final dikirimkan.",
    ],
  },
  omoji: {
    label: "Omoji Indonesia",
    tagline: "Hair Care & Skin Care Learning Hub",
    phone: "0877 4148 2699",
    email: "omojimask.id@gmail.com",
    logo: "assets/logo-omoji.png",
    accent: "#b06a8f",
    accentSoft: "#f3e2ec",
    code: "OMJ",
    dpTermsTemplate: (dp) =>
      `**Down Payment (DP) sebesar ${dp}%** dari total invoice dibayarkan sebagai konfirmasi jadwal dan kelas yang dipelajari.`,
    remainingTermsTemplate: () =>
      `**Sisa pembayaran** dilakukan maksimal **7 hari sebelum** kelas dilaksanakan.`,
    quotationTerms: [
      "Pembayaran kelas dilakukan secara penuh (full payment) sebelum pelaksanaan kelas.",
      "Pendaftaran dinyatakan sah setelah pembayaran diterima.",
    ],
  },
};

const PAYMENT_INFO = {
  bank: "BCA",
  accountName: "CV Karya Mudra Gemilang",
  accountNumber: "6080757814",
  qr: "assets/qr-bca.jpg",
};

// ===================== State =====================
const state = {
  brand: "melanao",
  type: "quotation", // "quotation" | "dp" | "final"
  items: [
    { service: "", detail: "", price: 0, qty: 1 },
  ],
};

let adminPasscode = null;
let pendingPasscodeAction = null;
let listLoadedOnce = false;
let lastInvoices = [];
let statusFilter = "all";
let brandFilter = "all";
let searchQuery = "";
let sortOrder = "desc";

const MONTH_NAMES = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

// ===================== Helpers =====================
function rupiah(n) {
  n = Math.round(n || 0);
  return "Rp" + n.toLocaleString("id-ID");
}

function formatDate(isoStr) {
  if (!isoStr) return "-";
  const d = new Date(isoStr + "T00:00:00");
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

function slug(str) {
  return (str || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 16) || "CLIENT";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function el(id) { return document.getElementById(id); }

// ===================== Item rows =====================
function addItem() {
  state.items.push({ service: "", detail: "", price: 0, qty: 1 });
  renderItems();
  renderPreview();
}

function removeItem(idx) {
  if (state.items.length === 1) return;
  state.items.splice(idx, 1);
  renderItems();
  renderPreview();
}

function renderItems() {
  const wrap = el("itemsList");
  wrap.innerHTML = "";
  state.items.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
      ${state.items.length > 1 ? `<button type="button" class="remove-item" data-idx="${idx}">✕ hapus</button>` : ""}
      <div class="field">
        <label>Nama Jasa / Item</label>
        <input type="text" class="item-service" data-idx="${idx}" value="${escapeAttr(item.service)}" placeholder="cth. Melanao Studio Full Day" />
      </div>
      <div class="field">
        <label>Detail (opsional)</label>
        <textarea class="item-detail" data-idx="${idx}" placeholder="Deskripsi paket / ketentuan...">${escapeHtml(item.detail)}</textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Harga (Rp)</label>
          <input type="number" class="item-price" data-idx="${idx}" value="${item.price}" min="0" />
        </div>
        <div class="field">
          <label>Qty</label>
          <input type="number" class="item-qty" data-idx="${idx}" value="${item.qty}" min="1" />
        </div>
      </div>
      <div class="row-total">Subtotal: ${rupiah(item.price * item.qty)}</div>
    `;
    wrap.appendChild(row);
  });
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// ===================== Calculations =====================
function calc() {
  const subtotal = state.items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  const additionalFee = Number(el("additionalFee").value) || 0;

  const promoType = document.querySelector("#promoTypeToggle .pill.active")?.dataset.value || "percent";
  const promoValueRaw = Number(el("promoValue").value) || 0;
  const discountAmount = promoType === "percent"
    ? Math.round((subtotal * promoValueRaw) / 100)
    : Math.min(promoValueRaw, subtotal); // never discount below zero

  const total = subtotal - discountAmount + additionalFee;

  let dpAmount = 0, remainingBalance = 0, dpPercent = 0, paidAmount = 0;

  if (state.type === "dp") {
    dpPercent = Number(el("dpPercent").value) || 0;
    dpAmount = Math.round((total * dpPercent) / 100);
    remainingBalance = total - dpAmount;
  } else if (state.type === "final") {
    paidAmount = Number(el("dpPaidAmount").value) || 0;
    remainingBalance = total - paidAmount;
  }

  return { subtotal, additionalFee, promoType, promoValueRaw, discountAmount, total, dpAmount, remainingBalance, dpPercent, paidAmount };
}

// ===================== Preview render =====================
function renderPreview() {
  const brand = BRANDS[state.brand];
  document.documentElement.style.setProperty("--brand-accent", brand.accent);
  document.documentElement.style.setProperty("--brand-accent-soft", brand.accentSoft);

  const isQuotation = state.type === "quotation";
  const c = calc();
  const clientName = el("clientName").value || "-";
  const contactPerson = el("contactPerson").value || "-";
  const clientPhone = el("clientPhone").value || "-";
  const invoiceDate = el("invoiceDate").value;
  const dueDate = el("dueDate").value;
  const invoiceCode = buildInvoiceCode();

  const rows = state.items.map((it) => `
    <tr>
      <td>
        ${escapeHtml(it.service) || "-"}
        ${it.detail ? `<div class="detail">${escapeHtml(it.detail)}</div>` : ""}
      </td>
      <td class="num">${rupiah(it.price)}</td>
      <td class="num">${it.qty}</td>
      <td class="num">${rupiah(it.price * it.qty)}</td>
    </tr>
  `).join("");

  let summaryHtml = "";
  const additionalFeeNote = el("additionalFeeNote").value;
  const promoNote = el("promoNote").value;
  const promoTag = c.promoType === "percent" && c.promoValueRaw ? ` ${c.promoValueRaw}%` : "";
  const showBreakdown = c.additionalFee > 0 || c.discountAmount > 0;
  const feeBreakdownHtml = showBreakdown
    ? `
      <div class="row"><span>Subtotal</span><span>${rupiah(c.subtotal)}</span></div>
      ${c.discountAmount > 0 ? `<div class="row"><span>Diskon${promoTag}${promoNote ? ` (${escapeHtml(promoNote)})` : ""}</span><span>-${rupiah(c.discountAmount)}</span></div>` : ""}
      ${c.additionalFee > 0 ? `<div class="row"><span>Biaya Tambahan${additionalFeeNote ? ` (${escapeHtml(additionalFeeNote)})` : ""}</span><span>${rupiah(c.additionalFee)}</span></div>` : ""}
    `
    : "";
  if (isQuotation) {
    summaryHtml = `
      <div class="row title">Total Summary :</div>
      ${feeBreakdownHtml}
      <div class="row highlight"><span>Total Quotation</span><span>${rupiah(c.total)}</span></div>
    `;
  } else if (state.type === "dp") {
    summaryHtml = `
      <div class="row title">Total Summary :</div>
      ${feeBreakdownHtml}
      <div class="row"><span>Total Invoice</span><span>${rupiah(c.total)}</span></div>
      <div class="row highlight"><span>DP (${c.dpPercent}%) — Due Now</span><span>${rupiah(c.dpAmount)}</span></div>
      <div class="row"><span>Remaining Balance</span><span>${rupiah(c.remainingBalance)}</span></div>
    `;
  } else {
    summaryHtml = `
      <div class="row title">Total Summary :</div>
      ${feeBreakdownHtml}
      <div class="row"><span>Total Invoice</span><span>${rupiah(c.total)}</span></div>
      <div class="row"><span>Paid (DP)</span><span>${rupiah(c.paidAmount)}</span></div>
      <div class="row highlight"><span>Remaining Balance — Due Now</span><span>${rupiah(c.remainingBalance)}</span></div>
    `;
  }

  let termsHtml;
  if (isQuotation) {
    termsHtml = brand.quotationTerms.map((t) => `<li>${mdBoldToHtml(t)}</li>`).join("");
  } else {
    const dpPercentForTerms = state.type === "dp" ? (c.dpPercent || 50) : 50;
    const remainingPercentForTerms = 100 - dpPercentForTerms;
    termsHtml = state.brand === "melanao"
      ? `
        <li>${mdBoldToHtml(brand.dpTermsTemplate(dpPercentForTerms))}</li>
        <li>${mdBoldToHtml(brand.remainingTermsTemplate(remainingPercentForTerms))}</li>
      `
      : `
        <li>${mdBoldToHtml(brand.dpTermsTemplate(dpPercentForTerms))}</li>
        <li>${mdBoldToHtml(brand.remainingTermsTemplate())}</li>
      `;
  }

  const metaLeftHtml = isQuotation
    ? `
      <div class="label">Quotation Date :</div>
      <div class="value">${formatDate(invoiceDate)}</div>
    `
    : `
      <div class="label">Invoice Code :</div>
      <div class="value">${invoiceCode}</div>
      <div class="value">${formatDate(invoiceDate)}</div>
      <div class="label">Due Date :</div>
      <div class="value">${formatDate(dueDate)}</div>
    `;

  el("invoicePreview").innerHTML = `
    <div class="inv-header">
      <img src="${brand.logo}" onerror="this.style.display='none'" alt="logo" />
      <div>
        <p class="brand-name">${brand.label}</p>
        <p class="brand-meta">${brand.tagline}<br>${brand.phone}<br>${brand.email}</p>
      </div>
    </div>

    <div class="inv-meta-row">
      <div>${metaLeftHtml}</div>
      <div class="bill-to">
        <div class="label">Bill to :</div>
        <div class="value">${escapeHtml(clientName)}<br>${escapeHtml(contactPerson)}</div>
        <div class="value">${escapeHtml(clientPhone)}</div>
      </div>
    </div>

    <table class="inv-table">
      <thead>
        <tr><th>Service</th><th class="num">${isQuotation ? "Rate" : "Price"}</th><th class="num">Qty</th><th class="num">Total</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="summary-block"><div class="summary-inner">${summaryHtml}</div></div>

    <hr class="hr" />
    <div class="terms-title">Payment Terms :</div>
    <ul class="terms-list">${termsHtml}</ul>
    <hr class="hr" />

    <div class="payinfo-title">Payment Information</div>
    <div class="payinfo-row">
      <img src="${PAYMENT_INFO.qr}" onerror="this.style.display='none'" alt="QR" />
      <div class="payinfo-details">
        Bank : ${PAYMENT_INFO.bank}<br>
        Account Name : ${PAYMENT_INFO.accountName}<br>
        Account Number : ${PAYMENT_INFO.accountNumber}<br>
        Email : ${brand.email}
      </div>
    </div>
  `;
}

function mdBoldToHtml(s) {
  return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function buildInvoiceCode() {
  const brand = BRANDS[state.brand];
  const dateStr = (el("invoiceDate").value || todayISO()).replace(/-/g, "");
  const typeTag = { quotation: "QUOTE", dp: "DP", final: "LUNAS" }[state.type];
  return `${brand.code}-${dateStr}-${slug(el("clientName").value)}-${typeTag}`;
}

// ===================== PDF export =====================
async function downloadPdf() {
  const statusEl = el("statusMsg");
  if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
    statusEl.textContent = "Library PDF belum ke-load (cek koneksi internet / reload halaman).";
    statusEl.className = "status err";
    return;
  }
  const node = el("invoicePreview");
  const invoiceCode = buildInvoiceCode();
  statusEl.textContent = "Menyiapkan PDF...";
  statusEl.className = "status";
  try {
    // Render the invoice to a canvas, then build the PDF manually with jsPDF
    // directly (mm units — well-documented, no ambiguous unit conversion)
    // instead of the html2pdf.js wrapper, whose automatic px-based page
    // sizing turned out to size pages incorrectly and misplace content.
    const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/jpeg", 0.98);
    // 96 CSS px per inch, 25.4mm per inch; divide out the html2canvas scale
    // factor to get back to real-world mm matching the on-screen size.
    const pxToMm = 25.4 / 96 / 2;
    const pdfWidthMm = canvas.width * pxToMm;
    const pdfHeightMm = canvas.height * pxToMm;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: pdfHeightMm >= pdfWidthMm ? "portrait" : "landscape",
      unit: "mm",
      format: [pdfWidthMm, pdfHeightMm],
    });
    pdf.addImage(imgData, "JPEG", 0, 0, pdfWidthMm, pdfHeightMm);
    const pdfUrl = pdf.output("bloburl");

    el("pdfFrame").src = pdfUrl;
    const link = el("pdfDownloadLink");
    link.href = pdfUrl;
    link.download = `${invoiceCode}.pdf`;
    el("pdfModal").classList.remove("hidden");
    statusEl.textContent = "PDF berhasil dibuat ✓";
    statusEl.className = "status ok";
  } catch (err) {
    statusEl.textContent = "Gagal bikin PDF: " + err.message;
    statusEl.className = "status err";
  }
}

// ===================== Save to Notion =====================
function gatherPayload() {
  const c = calc();
  return {
    brand: state.brand,
    type: state.type,
    invoiceCode: buildInvoiceCode(),
    clientName: el("clientName").value,
    contactPerson: el("contactPerson").value,
    clientPhone: el("clientPhone").value,
    invoiceDate: el("invoiceDate").value || todayISO(),
    dueDate: el("dueDate").value || null,
    items: state.items,
    subtotal: c.subtotal,
    additionalFee: c.additionalFee,
    additionalFeeNote: el("additionalFeeNote").value,
    promoType: c.promoType,
    promoValueRaw: c.promoValueRaw,
    discountAmount: c.discountAmount,
    promoNote: el("promoNote").value,
    total: c.total,
    dpPercent: c.dpPercent,
    dpAmount: c.dpAmount,
    paidAmount: c.paidAmount,
    remainingBalance: c.remainingBalance,
    dpPaidDate: el("dpPaidDate").value || null,
    existingPageUrl: el("existingPageUrl").value || null,
    internalNotes: el("internalNotes").value,
  };
}

async function saveToNotion(passcode) {
  const statusEl = el("statusMsg");
  statusEl.textContent = "Menyimpan ke Notion...";
  statusEl.className = "status";
  try {
    const res = await fetch("/api/save-invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-passcode": passcode,
      },
      body: JSON.stringify(gatherPayload()),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal menyimpan");
    statusEl.textContent = "Berhasil disimpan ke Notion ✓";
    statusEl.className = "status ok";
    if (data.url) window.open(data.url, "_blank");
  } catch (err) {
    statusEl.textContent = "Gagal: " + err.message;
    statusEl.className = "status err";
  }
}

// ===================== Passcode helper (shared by Save-to-Notion & list view) =====================
function withPasscode(action) {
  if (adminPasscode) {
    action(adminPasscode);
    return;
  }
  pendingPasscodeAction = action;
  el("passcodeModal").classList.remove("hidden");
  el("passcodeInput").value = "";
  el("passcodeInput").focus();
}

// ===================== Invoice list view =====================
function populateListFilters() {
  const monthSel = el("listMonth");
  const yearSel = el("listYear");
  monthSel.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");

  const now = new Date();
  const currentYear = now.getFullYear();
  yearSel.innerHTML = [currentYear - 1, currentYear, currentYear + 1]
    .map((y) => `<option value="${y}">${y}</option>`).join("");

  monthSel.value = String(now.getMonth() + 1);
  yearSel.value = String(currentYear);
}

function statusBadgeClass(status) {
  if (status === "Lunas") return "lunas";
  if (status === "DP Masuk") return "dp-masuk";
  return "belum-bayar";
}

function applyFilterAndRender() {
  const brandScoped = brandFilter === "all" ? lastInvoices : lastInvoices.filter((inv) => inv.brand === brandFilter);
  let filtered = statusFilter === "all" ? brandScoped : brandScoped.filter((inv) => inv.status === statusFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((inv) => (inv.name || "").toLowerCase().includes(q) || (inv.brand || "").toLowerCase().includes(q));
  }
  filtered = [...filtered].sort((a, b) => {
    const da = a.invoiceDate || "";
    const db = b.invoiceDate || "";
    if (da === db) return 0;
    return sortOrder === "asc" ? (da < db ? -1 : 1) : (da > db ? -1 : 1);
  });
  renderSummary(filtered);
  renderTable(filtered);
}

function renderSummary(invoices) {
  const cardsEl = el("summaryCards");
  const totalCount = invoices.length;
  // "Total Nilai" = uang yang beneran udah diterima, dihitung per baris sesuai
  // status invoice itu sendiri (bukan sekadar total tagihan) — jadi kalau lagi
  // difilter "DP Masuk" misalnya, angkanya jumlah DP yang masuk, bukan total invoice-nya.
  const receivedValue = invoices.reduce((sum, inv) => {
    if (inv.status === "Lunas") return sum + (inv.total || 0);
    if (inv.status === "DP Masuk") return sum + (inv.dpAmount || 0);
    return sum;
  }, 0);
  const lunasCount = invoices.filter((inv) => inv.status === "Lunas").length;
  const belumLunasCount = totalCount - lunasCount;

  cardsEl.innerHTML = `
    <div class="summary-card"><div class="label">Jumlah Invoice</div><div class="value">${totalCount}</div></div>
    <div class="summary-card"><div class="label">Total Nilai</div><div class="value">${rupiah(receivedValue)}</div></div>
    <div class="summary-card"><div class="label">Lunas</div><div class="value">${lunasCount}</div></div>
    <div class="summary-card"><div class="label">Belum Lunas</div><div class="value">${belumLunasCount}</div></div>
  `;
}

function renderTable(invoices) {
  const bodyEl = el("listTableBody");

  if (!invoices.length) {
    bodyEl.innerHTML = `<tr class="empty-row"><td colspan="10">Gak ada invoice yang cocok sama filter ini.</td></tr>`;
    return;
  }

  bodyEl.innerHTML = invoices.map((inv) => `
    <tr>
      <td>${escapeHtml(inv.name) || "-"}</td>
      <td><span class="brand-badge ${(inv.brand || "").toLowerCase()}">${escapeHtml(inv.brand) || "-"}</span></td>
      <td>${formatDate(inv.invoiceDate)}</td>
      <td>${formatDate(inv.dueDate)}</td>
      <td>${formatDate(inv.dpDate)}</td>
      <td>${formatDate(inv.fullPaymentDate)}</td>
      <td class="num">${inv.total ? rupiah(inv.total) : "-"}</td>
      <td class="num">${inv.dpAmount ? rupiah(inv.dpAmount) : "-"}</td>
      <td><span class="status-badge ${statusBadgeClass(inv.status)}">${escapeHtml(inv.status)}</span></td>
      <td>
        <div class="row-actions">
          ${inv.url ? `<a href="${inv.url}" target="_blank" rel="noopener">Buka</a>` : ""}
          ${paymentActionButtons(inv)}
          ${inv.id ? `<button type="button" class="btn-mini btn-danger" data-action="delete" data-id="${inv.id}">Hapus</button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");
}

// ===================== Continue DP invoice → Final Payment =====================
// "Invoice DP" -> "Alamii Food"
function deriveClientNameFromInvoiceName(invoiceName) {
  const parts = (invoiceName || "").split("—");
  return (parts.length > 1 ? parts[parts.length - 1] : invoiceName || "").trim();
}

async function continueToFinalPayment(inv, passcode) {
  document.querySelector('#viewToggle .pill[data-value="create"]')?.click();

  const brandBtn = document.querySelector(`#brandToggle .pill[data-value="${(inv.brand || "").toLowerCase()}"]`);
  if (brandBtn) brandBtn.click();

  document.querySelector('#docTypeToggle .pill[data-value="invoice"]')?.click();
  document.querySelector('#typeToggle .pill[data-value="final"]')?.click();

  el("clientName").value = deriveClientNameFromInvoiceName(inv.name);
  el("existingPageUrl").value = inv.url || "";
  el("dpPaidAmount").value = inv.dpAmount || 0;
  renderPreview();
  el("contactPerson").focus();

  const statusEl = el("statusMsg");
  statusEl.textContent = "Nama klien, link Notion, & nominal DP udah ke-prefill. Lagi narik item dari invoice DP-nya...";
  statusEl.className = "status";

  try {
    const res = await fetch(`/api/get-invoice-items?pageUrl=${encodeURIComponent(inv.url || "")}`, {
      headers: { "x-admin-passcode": passcode },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal ambil item");
    if (data.items && data.items.length) {
      state.items = data.items;
      renderItems();
      renderPreview();
      statusEl.textContent = `${data.items.length} item dari invoice DP berhasil ditarik otomatis. Tambahin item/biaya baru kalau ada (misal overtime), terus cek lagi totalnya.`;
      statusEl.className = "status ok";
    } else {
      statusEl.textContent = "Gak nemu item di invoice DP-nya — masukin manual ya.";
      statusEl.className = "status err";
    }
  } catch (err) {
    statusEl.textContent = "Gagal narik item otomatis (" + err.message + ") — masukin manual ya.";
    statusEl.className = "status err";
  }
}

function paymentActionButtons(inv) {
  if (!inv.id) return "";
  if (inv.status === "Lunas") {
    return `<button type="button" class="btn-mini btn-undo" data-action="undo_full_payment" data-id="${inv.id}">Batalkan Lunas</button>`;
  }
  if (inv.status === "DP Masuk") {
    return `
      <button type="button" class="btn-mini btn-continue" data-action="continue_final" data-id="${inv.id}">Lanjut ke Pelunasan</button>
      <button type="button" class="btn-mini" data-action="full_payment_received" data-id="${inv.id}">Tandai Lunas</button>
      <button type="button" class="btn-mini btn-undo" data-action="undo_dp" data-id="${inv.id}">Batalkan DP</button>
    `;
  }
  // Belum Bayar
  return `
    <button type="button" class="btn-mini" data-action="dp_received" data-id="${inv.id}">Tandai DP</button>
    <button type="button" class="btn-mini" data-action="full_payment_received" data-id="${inv.id}">Tandai Lunas</button>
  `;
}

async function loadInvoiceList(passcode) {
  const statusEl = el("listStatusMsg");
  statusEl.textContent = "Memuat...";
  statusEl.className = "status";
  try {
    const year = el("listYear").value;
    const month = el("listMonth").value;
    const res = await fetch(`/api/list-invoices?year=${year}&month=${month}`, {
      headers: { "x-admin-passcode": passcode },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal memuat data");
    lastInvoices = data.invoices;
    applyFilterAndRender();
    statusEl.textContent = `${data.invoices.length} invoice ditemukan`;
    statusEl.className = "status ok";
  } catch (err) {
    statusEl.textContent = "Gagal: " + err.message;
    statusEl.className = "status err";
    adminPasscode = null; // passcode might be wrong — force re-prompt next attempt
  }
}

// ===================== Mark payment status =====================
let pendingPayment = null; // { inv, action }

const PAYMENT_ACTION_LABELS = {
  dp_received: "Tandai DP Diterima",
  full_payment_received: "Tandai Lunas",
  undo_dp: "Batalkan Status DP",
  undo_full_payment: "Batalkan Status Lunas",
};

function openPaymentModal(inv, action) {
  pendingPayment = { inv, action };
  el("paymentModalTitle").textContent = PAYMENT_ACTION_LABELS[action] || "Tandai Pembayaran";
  el("paymentDate").value = todayISO();
  const isUndo = action.startsWith("undo_");
  el("paymentMetodeField").classList.toggle("hidden", isUndo);
  if (!isUndo) el("paymentMetode").value = "Transfer";
  el("paymentModal").classList.remove("hidden");
}

async function markPayment(passcode) {
  if (!pendingPayment) return;
  const { inv, action } = pendingPayment;
  const date = el("paymentDate").value || todayISO();
  const isUndo = action.startsWith("undo_");
  const statusEl = el("listStatusMsg");
  statusEl.textContent = "Menyimpan status...";
  statusEl.className = "status";
  try {
    const res = await fetch("/api/update-payment-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-passcode": passcode },
      body: JSON.stringify({
        pageId: inv.id,
        action,
        date,
        brand: inv.brand,
        invoiceName: inv.name,
        total: inv.total,
        dpAmount: inv.dpAmount,
        metodePembayaran: isUndo ? null : el("paymentMetode").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal update status");
    if (data.cashflowWarning) {
      statusEl.textContent = "Status invoice terupdate, tapi gagal dicatat ke Cashflow CV: " + data.cashflowWarning;
      statusEl.className = "status err";
    } else {
      statusEl.textContent = (action === "dp_received" || action === "full_payment_received")
        ? "Status berhasil diupdate ✓ & tercatat di Cashflow CV"
        : "Status berhasil diupdate ✓";
      statusEl.className = "status ok";
    }
    loadInvoiceList(passcode);
  } catch (err) {
    statusEl.textContent = "Gagal: " + err.message;
    statusEl.className = "status err";
  }
}

// ===================== Delete invoice =====================
async function deleteInvoice(inv, passcode) {
  const statusEl = el("listStatusMsg");
  statusEl.textContent = "Menghapus invoice...";
  statusEl.className = "status";
  try {
    const res = await fetch("/api/delete-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-passcode": passcode },
      body: JSON.stringify({ pageId: inv.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal menghapus");
    statusEl.textContent = "Invoice berhasil dihapus (diarsipkan di Notion) ✓";
    statusEl.className = "status ok";
    loadInvoiceList(passcode);
  } catch (err) {
    statusEl.textContent = "Gagal: " + err.message;
    statusEl.className = "status err";
  }
}

// ===================== Field visibility per doc type =====================
function updateFieldVisibility() {
  const isQuotation = state.type === "quotation";
  const isDp = state.type === "dp";
  const isFinal = state.type === "final";

  el("dpFields").classList.toggle("hidden", !isDp);
  el("finalFields").classList.toggle("hidden", !isFinal);
  el("dueDateField").classList.toggle("hidden", isQuotation);
  el("invoiceDateLabel").textContent = isQuotation ? "Tanggal Quotation" : "Tanggal Invoice";

  const urlLabel = el("existingPageUrlLabel");
  if (isQuotation) {
    urlLabel.textContent = "Link Quotation di Notion (kalau ada — biar dokumen ini ditambahin ke page yang sama, bukan bikin baris baru)";
  } else if (isDp) {
    urlLabel.textContent = "Link Quotation/Invoice sebelumnya di Notion (kalau ada — biar ditambahin ke page yang sama, bukan bikin baris baru)";
  } else {
    urlLabel.textContent = "Link Invoice DP di Notion — WAJIB diisi kalau klien ini sebelumnya udah DP (pakai tombol \"Lanjut ke Pelunasan\" di Daftar Invoice biar otomatis). Kosongin kalau klien ini langsung lunas tanpa DP sebelumnya.";
  }
}

// ===================== Event wiring =====================
function wireToggle(containerId, onChange) {
  const container = el(containerId);
  container.querySelectorAll(".pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(btn.dataset.value);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  el("invoiceDate").value = todayISO();
  renderItems();
  updateFieldVisibility();
  renderPreview();

  wireToggle("brandToggle", (val) => { state.brand = val; renderPreview(); });

  wireToggle("docTypeToggle", (val) => {
    el("invoiceTypeGroup").classList.toggle("hidden", val !== "invoice");
    if (val === "quotation") {
      state.type = "quotation";
    } else {
      const activeSub = document.querySelector("#typeToggle .pill.active");
      state.type = activeSub ? activeSub.dataset.value : "dp";
    }
    updateFieldVisibility();
    renderPreview();
  });

  wireToggle("typeToggle", (val) => {
    state.type = val;
    updateFieldVisibility();
    renderPreview();
  });

  wireToggle("promoTypeToggle", (val) => {
    el("promoValueLabel").textContent = val === "percent" ? "Jumlah Diskon (%)" : "Jumlah Diskon (Rp)";
    renderPreview();
  });

  el("addItemBtn").addEventListener("click", addItem);

  el("itemsList").addEventListener("input", (e) => {
    const idx = Number(e.target.dataset.idx);
    if (Number.isNaN(idx)) return;
    if (e.target.classList.contains("item-service")) state.items[idx].service = e.target.value;
    if (e.target.classList.contains("item-detail")) state.items[idx].detail = e.target.value;
    if (e.target.classList.contains("item-price")) state.items[idx].price = Number(e.target.value);
    if (e.target.classList.contains("item-qty")) state.items[idx].qty = Number(e.target.value);
    // Update just this row's subtotal label instead of rebuilding the whole
    // list, so the input the admin is typing in never loses focus/cursor.
    const row = e.target.closest(".item-row");
    const totalEl = row.querySelector(".row-total");
    const it = state.items[idx];
    totalEl.textContent = `Subtotal: ${rupiah(it.price * it.qty)}`;
    renderPreview();
  });

  el("itemsList").addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-item")) {
      removeItem(Number(e.target.dataset.idx));
    }
  });

  // re-render on any other form field change
  document.querySelectorAll(".form-panel input, .form-panel select").forEach((f) => {
    f.addEventListener("input", renderPreview);
    f.addEventListener("change", renderPreview);
  });

  el("downloadPdfBtn").addEventListener("click", downloadPdf);

  el("saveNotionBtn").addEventListener("click", () => {
    const dpPaidNow = Number(el("dpPaidAmount").value) || 0;
    if (state.type === "final" && !el("existingPageUrl").value && dpPaidNow > 0) {
      const proceed = confirm(
        "Kamu isi 'DP yang Sudah Diterima' tapi belum isi 'Link Quotation/Invoice sebelumnya di Notion'. Tanpa link, ini bakal bikin ROW BARU yang terpisah dari invoice DP-nya (bukan lanjutan di row yang sama).\n\nLanjut bikin baru?"
      );
      if (!proceed) return;
    }
    withPasscode((code) => saveToNotion(code));
  });
  el("passcodeCancel").addEventListener("click", () => {
    el("passcodeModal").classList.add("hidden");
    pendingPasscodeAction = null;
  });
  el("passcodeConfirm").addEventListener("click", () => {
    const code = el("passcodeInput").value;
    el("passcodeModal").classList.add("hidden");
    if (!code) return;
    adminPasscode = code;
    if (pendingPasscodeAction) {
      const action = pendingPasscodeAction;
      pendingPasscodeAction = null;
      action(code);
    }
  });
  el("pdfCloseBtn").addEventListener("click", () => {
    el("pdfModal").classList.add("hidden");
    el("pdfFrame").src = "";
  });

  // ---- View tabs ----
  populateListFilters();
  wireToggle("viewToggle", (val) => {
    el("createView").classList.toggle("hidden", val !== "create");
    el("listView").classList.toggle("hidden", val !== "list");
    if (val === "list" && !listLoadedOnce) {
      listLoadedOnce = true;
      withPasscode((code) => loadInvoiceList(code));
    }
  });
  el("refreshListBtn").addEventListener("click", () => withPasscode((code) => loadInvoiceList(code)));
  el("listMonth").addEventListener("change", () => withPasscode((code) => loadInvoiceList(code)));
  el("listYear").addEventListener("change", () => withPasscode((code) => loadInvoiceList(code)));
  wireToggle("statusFilter", (val) => { statusFilter = val; applyFilterAndRender(); });
  wireToggle("brandFilter", (val) => { brandFilter = val; applyFilterAndRender(); });
  el("searchInput").addEventListener("input", () => {
    searchQuery = el("searchInput").value;
    applyFilterAndRender();
  });
  el("sortOrder").addEventListener("change", () => {
    sortOrder = el("sortOrder").value;
    applyFilterAndRender();
  });

  el("listTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-mini");
    if (!btn) return;
    const inv = lastInvoices.find((i) => i.id === btn.dataset.id);
    if (!inv) return;
    if (btn.dataset.action === "continue_final") {
      withPasscode((code) => continueToFinalPayment(inv, code));
      return;
    }
    if (btn.dataset.action === "delete") {
      const proceed = confirm(
        `Yakin mau hapus invoice "${inv.name}"?\n\nIni bakal diarsipkan di Notion (masuk Trash) — masih bisa dipulihkan dari sana kalau salah hapus, tapi bakal langsung ilang dari daftar invoice di sini.`
      );
      if (!proceed) return;
      withPasscode((code) => deleteInvoice(inv, code));
      return;
    }
    openPaymentModal(inv, btn.dataset.action);
  });
  el("paymentCancel").addEventListener("click", () => {
    el("paymentModal").classList.add("hidden");
    pendingPayment = null;
  });
  el("paymentConfirm").addEventListener("click", () => {
    el("paymentModal").classList.add("hidden");
    withPasscode((code) => markPayment(code));
  });
});
