import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { amountInWords } from "./amount-in-words";

/**
 * The exact shape this renderer needs. Declared explicitly rather than
 * reusing a Prisma type so it is obvious at a glance that every value on the
 * page comes from a stored invoice row — never from a request body. A
 * client-supplied total on a tax document would be a forgery vector, so the
 * caller must load the invoice from the database and hand it over whole.
 */
export interface InvoicePdfData {
  invoiceNo: string;
  docType: "TAX_INVOICE" | "ESTIMATE";
  issueDate: Date | null;
  dueDate: Date;
  status: string;
  placeOfSupply: string;
  paymentTerms: string | null;
  quotationRef: string | null;
  serviceLocation: string | null;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  workspace: {
    name: string;
    gstin: string | null;
    address: string | null;
    website: string | null;
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNo: string | null;
    bankIfsc: string | null;
    invoiceTerms: string[];
    invoiceDeclaration: string | null;
  };
  brand: { name: string; tagline: string | null; website: string | null } | null;
  city: { name: string; state: string; gstStateCode: string };
  client: { name: string; address: string | null; gstin: string | null; gstStateCode: string | null };
  project: { name: string; eventDate: Date | null };
  items: Array<{
    description: string;
    detail: string | null;
    qty: number;
    unit: string | null;
    rate: number;
    discountPct: number;
    hsnSac: string | null;
    scope: "FIXED" | "VARIABLE";
  }>;
  payments: Array<{ amount: number; receivedAt: Date; method: string }>;
  creditNotes: Array<{ amount: number; reason: string }>;
  debitNotes: Array<{ amount: number; reason: string }>;
}

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => INR.format(n);

/**
 * "INR", not "₹".
 *
 * pdfkit's built-in Helvetica is WinAnsi-encoded and has no U+20B9 glyph — it
 * renders the rupee sign as a stray "1". The fix would be embedding a TTF
 * that carries it, but that puts a font file on the critical path of issuing
 * a tax invoice: if it is missing from the API image, registerFont throws and
 * NO invoice renders at all. A hard dependency with that blast radius is not
 * worth a typographic nicety, and "INR" is unambiguous and standard on Indian
 * tax invoices. If the glyph is wanted later, embed the font and change this
 * one constant.
 */
const RUPEE = "INR";

/**
 * ASCII hyphen, for the same reason as RUPEE above: Helvetica's WinAnsi
 * encoding has no U+2212 MINUS SIGN, and pdfkit renders it as a stray quote
 * mark — which on a line reading "Less: discount" turns a deduction into
 * something unreadable.
 */
const MINUS = "-";
const date = (d: Date | null) =>
  d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** Ink, matching the supplied design's restrained palette. */
const INK = "#1a1a1a";
const MUTED = "#777";
const RULE = "#d8d4cc";
const ACCENT = "#8a6d3b";

/**
 * One line's arithmetic, in one place. The printed document shows rate,
 * discount and taxable value as separate columns, and they must agree: doing
 * this per-column at draw time is how a PDF ends up with a discount that does
 * not reconcile against its own total.
 */
function lineMaths(item: InvoicePdfData["items"][number]) {
  const gross = item.qty * item.rate;
  const discount = gross * (item.discountPct / 100);
  const taxable = gross - discount;
  return { gross, discount, taxable };
}

/**
 * Server-side invoice PDF rendering.
 *
 * Library choice: `pdfkit`. It is a mature, pure-Node streaming PDF writer
 * with no browser engine and no React runtime behind it. The alternatives
 * considered were `@react-pdf/renderer` (pulls in a React reconciler plus a
 * yoga-layout wasm binary — a lot of machinery for a fixed-layout tax
 * document that no one is composing interactively) and HTML-to-PDF via
 * Puppeteer (a full Chromium per render, a heavy and fragile dependency to
 * put on the critical path of issuing an invoice). pdfkit draws exactly what
 * it is told, in-process, with no headless browser to keep alive.
 *
 * The layout follows the invoice design Anant supplied on 2026-09-15:
 * letterhead, the bill-to / service-location / amount-payable band, the
 * metadata grid, line items split into FIXED SCOPE and VARIABLE SCOPE
 * sections, then the tax summary, amount in words, bank details, terms and
 * signature block.
 *
 * TWO DOCUMENT TYPES, one layout. AMM raises a TAX_INVOICE (the GST document)
 * and an ESTIMATE (the pre-event quotation) off the same data. Only the
 * differences that are legally load-bearing vary: the title, the
 * "ORIGINAL FOR RECIPIENT" marker (a tax-invoice concept), whether the
 * balance is a demand or an indication, and the declaration. Everything else
 * is deliberately identical, because two divergent layouts would drift.
 *
 * NOTE ON THE ESTIMATE. Both PDFs supplied were byte-different but render
 * pixel-identical, and both are titled TAX INVOICE — so no estimate design
 * was actually provided. The estimate variant here is derived from the tax
 * invoice with the minimum set of changes above. Its wording is marked in
 * ESTIMATE_DECLARATION and should be confirmed by AMM before it goes to a
 * customer.
 */
const ESTIMATE_DECLARATION =
  "This is an estimate, not a tax invoice. Quantities, scope and taxes are indicative and " +
  "will be confirmed against actuals on the event date. No input tax credit may be claimed against this document.";

@Injectable()
export class InvoicePdfService {
  render(data: InvoicePdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      try {
        this.draw(doc, data);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private readonly left = 40;
  private readonly right = 555;

  private title(d: InvoicePdfData): string {
    return d.docType === "ESTIMATE" ? "ESTIMATE" : "TAX INVOICE";
  }

  // ---------------------------------------------------------------- header
  private letterhead(doc: PDFKit.PDFDocument, d: InvoicePdfData, y = 40): number {
    const { left, right } = this;

    doc.fontSize(13).font("Helvetica-Bold").fillColor(INK).text(d.workspace.name.toUpperCase(), left, y, { width: 300 });
    if (d.brand) {
      doc.fontSize(7.5).font("Helvetica").fillColor(ACCENT).text(d.brand.name.toUpperCase(), left, doc.y + 1, { width: 300 });
    }
    doc.fontSize(7).font("Helvetica").fillColor(MUTED);
    const identity = [d.workspace.address, d.workspace.gstin ? `GSTIN ${d.workspace.gstin}` : null, d.brand?.website ?? d.workspace.website]
      .filter(Boolean)
      .join(" · ");
    doc.text(identity, left, doc.y + 3, { width: 300 });

    doc.fontSize(17).font("Helvetica").fillColor(INK).text(this.title(d), left, y, { align: "right", width: right - left, characterSpacing: 2 });
    doc.fontSize(8).font("Helvetica").fillColor(MUTED);
    doc.text(`${d.invoiceNo} · ${date(d.issueDate)}`, left, doc.y + 2, { align: "right", width: right - left });
    if (d.docType === "TAX_INVOICE") {
      doc.fontSize(7).fillColor(ACCENT).text("ORIGINAL FOR RECIPIENT", left, doc.y + 1, { align: "right", width: right - left, characterSpacing: 1 });
    }

    const bottom = Math.max(doc.y, y + 44) + 8;
    doc.moveTo(left, bottom).lineTo(right, bottom).lineWidth(1).strokeColor(INK).stroke();
    return bottom + 14;
  }

  private label(doc: PDFKit.PDFDocument, s: string, x: number, y: number, width: number): void {
    doc.fontSize(6.5).font("Helvetica-Bold").fillColor(ACCENT).text(s.toUpperCase(), x, y, { width, characterSpacing: 1 });
  }

  private draw(doc: PDFKit.PDFDocument, d: InvoicePdfData): void {
    const { left, right } = this;
    let y = this.letterhead(doc, d);

    // ------------------------------------- bill to / service / amount band
    const colW = (right - left) / 3;
    const c1 = left;
    const c2 = left + colW + 6;
    const c3 = left + colW * 2 + 12;
    const bandTop = y;

    this.label(doc, "Bill to", c1, y, colW);
    doc.fontSize(10.5).font("Helvetica").fillColor(INK).text(d.client.name, c1, y + 12, { width: colW - 10 });
    doc.fontSize(7.5).fillColor(MUTED);
    doc.text(d.client.address ?? "Billing address as per client records", c1, doc.y + 3, { width: colW - 10 });
    doc.text(`GSTIN / UIN  ${d.client.gstin ?? "—"}`, c1, doc.y + 4, { width: colW - 10 });
    doc.text(`State  ${d.city.name} (${d.city.gstStateCode})`, c1, doc.y + 2, { width: colW - 10 });
    const c1Bottom = doc.y;

    this.label(doc, "Service location", c2, bandTop, colW);
    doc.fontSize(10).font("Helvetica").fillColor(INK).text(d.serviceLocation ?? `${d.city.name}`, c2, bandTop + 12, { width: colW - 10 });
    doc.fontSize(7.5).fillColor(MUTED);
    doc.text(`Event        ${d.project.name}`, c2, doc.y + 4, { width: colW - 10 });
    doc.text(`Event date   ${date(d.project.eventDate)}`, c2, doc.y + 2, { width: colW - 10 });
    const c2Bottom = doc.y;

    // The balance a customer actually owes: the invoice total, less what they
    // have paid, less any credit note, plus any debit note. Credit and debit
    // notes never alter the issued invoice row (it is immutable), so this is
    // the only place the net position is expressed.
    const paid = d.payments.reduce((s, p) => s + p.amount, 0);
    const credited = d.creditNotes.reduce((s, n) => s + n.amount, 0);
    const debited = d.debitNotes.reduce((s, n) => s + n.amount, 0);
    const balance = d.total - paid - credited + debited;

    this.label(doc, d.docType === "ESTIMATE" ? "Estimated total" : "Amount payable", c3, bandTop, colW);
    doc.fontSize(15).font("Helvetica").fillColor(INK).text(`${RUPEE} ${money(d.docType === "ESTIMATE" ? d.total : balance)}`, c3, bandTop + 12, { width: colW - 10 });
    doc.fontSize(7.5).fillColor(MUTED);
    doc.text(
      d.docType === "ESTIMATE" ? "Indicative — subject to final scope" : `Balance due by ${date(d.dueDate)}`,
      c3,
      doc.y + 3,
      { width: colW - 10 },
    );
    if (d.docType === "TAX_INVOICE") {
      const pillY = doc.y + 5;
      const pillW = Math.min(colW - 10, doc.widthOfString(d.status.replace(/_/g, " ")) + 22);
      doc.rect(c3, pillY, pillW, 14).lineWidth(0.7).strokeColor(ACCENT).stroke();
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(ACCENT).text(d.status.replace(/_/g, " "), c3, pillY + 4, { width: pillW, align: "center", characterSpacing: 1 });
      doc.y = pillY + 16;
    }

    y = Math.max(c1Bottom, c2Bottom, doc.y) + 12;

    // --------------------------------------------------------- metadata grid
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 8;
    const meta: Array<[string, string]> = [
      ["Invoice no.", d.invoiceNo],
      ["Invoice date", date(d.issueDate)],
      ["Due date", date(d.dueDate)],
      ["Payment terms", d.paymentTerms ?? "—"],
      ["Place of supply", `${d.placeOfSupply}`],
      ["Reverse charge", "No"],
      ["Quotation ref.", d.quotationRef ?? "—"],
      ["Project", d.project.name],
    ];
    const cellW = (right - left) / 4;
    let metaBottom = y;
    meta.forEach(([k, v], i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = left + col * cellW;
      const cy = y + row * 30;
      doc.fontSize(6.5).font("Helvetica").fillColor(MUTED).text(k, x, cy, { width: cellW - 8 });
      doc.fontSize(8).font("Helvetica").fillColor(INK).text(v, x, cy + 9, { width: cellW - 8 });
      metaBottom = Math.max(metaBottom, doc.y);
    });
    y = metaBottom + 12;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 10;

    // ----------------------------------------------------------- line items
    const intraState = d.igst <= 0;
    // Widths sized to the longest value each column actually carries at 7.5pt
    // — "2,18,300.00" needs ~46pt. The first cut squeezed the tax and total
    // columns to 26pt and they overprinted each other on a real invoice.
    const cols = { n: left, desc: left + 16, hsn: 218, qty: 244, rate: 286, disc: 332, taxable: 358, t1: 408, t2: 452, total: 496 };
    const W = { n: 14, hsn: 24, qty: 40, rate: 44, disc: 24, taxable: 48, tax: 42, total: right - 496 };

    const header = (yy: number): number => {
      doc.fontSize(6).font("Helvetica-Bold").fillColor(MUTED);
      doc.text("#", cols.n, yy);
      doc.text("DESCRIPTION OF SERVICE / GOODS", cols.desc, yy, { width: cols.hsn - cols.desc - 6 });
      doc.text("HSN\nSAC", cols.hsn, yy, { width: W.hsn });
      doc.text("QTY", cols.qty, yy, { width: W.qty, align: "right" });
      doc.text("RATE", cols.rate, yy, { width: W.rate, align: "right" });
      doc.text("DISC.", cols.disc, yy, { width: W.disc, align: "right" });
      doc.text("TAXABLE\nVALUE", cols.taxable, yy, { width: W.taxable, align: "right" });
      if (intraState) {
        doc.text("CGST\n9%", cols.t1, yy, { width: W.tax, align: "right" });
        doc.text("SGST\n9%", cols.t2, yy, { width: W.tax, align: "right" });
      } else {
        doc.text("IGST\n18%", cols.t1, yy, { width: cols.total - cols.t1 - 6, align: "right" });
      }
      doc.text("TOTAL", cols.total, yy, { width: W.total, align: "right" });
      const bottom = yy + 18;
      doc.moveTo(left, bottom).lineTo(right, bottom).lineWidth(0.5).strokeColor(RULE).stroke();
      return bottom + 7;
    };

    y = header(y);

    // The two printed sections. An invoice with nothing billed on actuals
    // simply has no VARIABLE heading — an empty section header would imply a
    // section the customer should look for.
    const sections: Array<[string, InvoicePdfData["items"]]> = [
      ["FIXED SCOPE — CONTRACTED RATES", d.items.filter((i) => i.scope === "FIXED")],
      ["VARIABLE SCOPE — BILLED ON ACTUALS", d.items.filter((i) => i.scope === "VARIABLE")],
    ];

    // Tax is apportioned per line from the invoice's stored totals rather than
    // recomputed at 9%: the stored figures are what was filed, and a renderer
    // that arrives at its own numbers can disagree with the return.
    const totalTaxable = d.items.reduce((s, i) => s + lineMaths(i).taxable, 0);
    const share = (taxable: number, pot: number) => (totalTaxable > 0 ? (taxable / totalTaxable) * pot : 0);

    let n = 0;
    for (const [heading, items] of sections) {
      if (items.length === 0) continue;

      if (y > 690) {
        doc.addPage();
        y = this.letterhead(doc, d);
        y = header(y);
      }
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(ACCENT).text(heading, cols.n, y, { characterSpacing: 1 });
      y = doc.y + 6;

      for (const item of items) {
        n += 1;
        const { taxable } = lineMaths(item);
        const t1 = intraState ? share(taxable, d.cgst) : share(taxable, d.igst);
        const t2 = intraState ? share(taxable, d.sgst) : 0;
        const lineTotal = taxable + t1 + t2;

        const descW = cols.hsn - cols.desc - 6;
        const descH = doc.fontSize(8).font("Helvetica").heightOfString(item.description, { width: descW });
        const detailH = item.detail ? doc.fontSize(6.5).font("Helvetica-Oblique").heightOfString(item.detail, { width: descW }) : 0;
        const rowH = Math.max(descH + detailH + 6, 18);

        if (y + rowH > 720) {
          doc.addPage();
          y = this.letterhead(doc, d);
          y = header(y);
        }

        doc.fontSize(7.5).font("Helvetica").fillColor(MUTED).text(String(n).padStart(2, "0"), cols.n, y, { width: W.n });
        doc.fontSize(8).font("Helvetica").fillColor(INK).text(item.description, cols.desc, y, { width: descW });
        if (item.detail) {
          doc.fontSize(6.5).font("Helvetica-Oblique").fillColor(MUTED).text(item.detail, cols.desc, doc.y + 1, { width: descW });
        }

        doc.fontSize(7.5).font("Helvetica").fillColor(INK);
        doc.text(item.hsnSac ?? "—", cols.hsn, y, { width: W.hsn });
        doc.text(`${item.qty}${item.unit ? ` ${item.unit}` : ""}`, cols.qty, y, { width: W.qty, align: "right" });
        doc.text(money(item.rate), cols.rate, y, { width: W.rate, align: "right" });
        doc.text(item.discountPct > 0 ? `${item.discountPct}%` : "—", cols.disc, y, { width: W.disc, align: "right" });
        doc.text(money(taxable), cols.taxable, y, { width: W.taxable, align: "right" });
        if (intraState) {
          doc.text(money(t1), cols.t1, y, { width: W.tax, align: "right" });
          doc.text(money(t2), cols.t2, y, { width: W.tax, align: "right" });
        } else {
          doc.text(money(t1), cols.t1, y, { width: cols.total - cols.t1 - 6, align: "right" });
        }
        doc.text(money(lineTotal), cols.total, y, { width: W.total, align: "right" });

        y += rowH;
      }
      y += 4;
    }

    // ------------------------------------------------- summary (second page)
    doc.addPage();
    y = this.letterhead(doc, d);

    const halfW = (right - left) / 2 - 12;
    const rightX = left + halfW + 24;
    const summaryTop = y;

    // --- tax summary table (left)
    this.label(doc, "Tax summary", left, y, halfW);
    y += 12;
    // Every column gets an explicit width and right-alignment. Without them
    // the SGST and Total-tax figures overprinted each other.
    const tw = 56;
    const taxCols = intraState
      ? [left, left + 34, left + 34 + tw, left + 34 + tw * 2, left + 34 + tw * 3]
      : [left, left + 34, left + 34 + tw, left + 34 + tw * 2];
    const taxHead = intraState ? ["Rate", "Taxable amt.", "CGST", "SGST", "Total tax"] : ["Rate", "Taxable amt.", "IGST", "Total tax"];
    const taxVals = intraState
      ? ["18%", money(d.taxableAmount), money(d.cgst), money(d.sgst), money(d.cgst + d.sgst)]
      : ["18%", money(d.taxableAmount), money(d.igst), money(d.igst)];

    doc.fontSize(6.5).font("Helvetica").fillColor(MUTED);
    taxHead.forEach((h, i) => doc.text(h, taxCols[i]!, y, { width: i === 0 ? 34 : tw, align: i === 0 ? "left" : "right" }));
    y += 11;
    doc.moveTo(left, y).lineTo(left + halfW, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 5;
    doc.fontSize(7.5).fillColor(INK);
    taxVals.forEach((v, i) => doc.text(v, taxCols[i]!, y, { width: i === 0 ? 34 : tw, align: i === 0 ? "left" : "right" }));
    y += 22;

    // --- amount in words (left)
    doc.rect(left, y, halfW, 46).lineWidth(0.5).strokeColor(RULE).stroke();
    this.label(doc, "Total amount payable — in words", left + 8, y + 7, halfW - 16);
    doc.fontSize(9).font("Helvetica").fillColor(INK).text(amountInWords(d.total), left + 8, y + 20, { width: halfW - 16 });
    const wordsBottom = Math.max(y + 46, doc.y + 6);

    // --- summary column (right)
    let sy = summaryTop;
    this.label(doc, "Summary", rightX, sy, halfW);
    sy += 14;
    const gross = d.items.reduce((s, i) => s + lineMaths(i).gross, 0);
    const discount = d.items.reduce((s, i) => s + lineMaths(i).discount, 0);
    const line = (k: string, v: string, bold = false) => {
      doc.fontSize(bold ? 9 : 8).font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(bold ? INK : MUTED).text(k, rightX, sy, { width: halfW - 90 });
      doc.fillColor(INK).text(v, rightX + halfW - 90, sy, { width: 90, align: "right" });
      sy += bold ? 16 : 14;
    };
    line("Gross amount", money(gross));
    if (discount > 0) line("Less: discount", `${MINUS} ${money(discount)}`);
    line("Taxable value", money(d.taxableAmount));
    if (intraState) {
      line("CGST @ 9%", money(d.cgst));
      line("SGST @ 9%", money(d.sgst));
    } else {
      line("IGST @ 18%", money(d.igst));
    }
    line("Round off", `${d.roundOff < 0 ? MINUS : "+"} ${money(Math.abs(d.roundOff))}`);
    doc.moveTo(rightX, sy).lineTo(right, sy).lineWidth(0.5).strokeColor(RULE).stroke();
    sy += 6;
    line(d.docType === "ESTIMATE" ? "ESTIMATED TOTAL" : "GRAND TOTAL", `${RUPEE} ${money(d.total)}`, true);

    if (d.docType === "TAX_INVOICE") {
      if (paid > 0) line("Advance received", `${MINUS} ${money(paid)}`);
      if (credited > 0) line("Credit notes", `${MINUS} ${money(credited)}`);
      if (debited > 0) line("Debit notes", `+ ${money(debited)}`);
      sy += 4;
      doc.rect(rightX, sy, halfW, 22).lineWidth(0.8).strokeColor(ACCENT).stroke();
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(ACCENT).text("BALANCE DUE", rightX + 8, sy + 7, { characterSpacing: 1 });
      doc.fontSize(10).font("Helvetica").fillColor(INK).text(`${RUPEE} ${money(balance)}`, rightX, sy + 6, { width: halfW - 8, align: "right" });
      sy += 30;
    }

    y = Math.max(wordsBottom, sy) + 18;

    // --- bank details. Only rendered when configured: an invoice showing
    //     "Bank name —" invites a customer to pay into nothing.
    if (d.docType === "TAX_INVOICE" && d.workspace.bankName) {
      this.label(doc, "Bank details for payment", left, y, halfW);
      y += 12;
      doc.rect(left, y, halfW, 60).lineWidth(0.5).strokeColor(RULE).stroke();
      let by = y + 8;
      for (const [k, v] of [
        ["Bank name", d.workspace.bankName],
        ["A/c holder", d.workspace.bankAccountName],
        ["A/c number", d.workspace.bankAccountNo],
        ["IFSC code", d.workspace.bankIfsc],
      ] as Array<[string, string | null]>) {
        if (!v) continue;
        doc.fontSize(7).font("Helvetica").fillColor(MUTED).text(k, left + 8, by, { width: 70 });
        doc.fontSize(7.5).fillColor(INK).text(v, left + 82, by, { width: halfW - 90 });
        by += 13;
      }
      y = Math.max(y + 60, by) + 6;
      doc.fontSize(6.5).font("Helvetica-Oblique").fillColor(MUTED).text(
        `Please quote invoice no. ${d.invoiceNo} in the payment reference. Cheques and transfers in favour of ${d.workspace.name}.`,
        left,
        y,
        { width: halfW },
      );
      y = doc.y + 16;
    }

    // --- terms + declaration + signature
    if (d.workspace.invoiceTerms.length > 0) {
      this.label(doc, "Terms & conditions", left, y, halfW);
      let ty = y + 12;
      doc.fontSize(7).font("Helvetica").fillColor(INK);
      d.workspace.invoiceTerms.forEach((term, i) => {
        doc.text(`${i + 1}.  ${term}`, left, ty, { width: halfW });
        ty = doc.y + 4;
      });
      y = ty;
    }

    const declaration = d.docType === "ESTIMATE" ? ESTIMATE_DECLARATION : d.workspace.invoiceDeclaration;
    if (declaration) {
      y += 6;
      this.label(doc, "Declaration", left, y, halfW);
      doc.fontSize(6.5).font("Helvetica").fillColor(MUTED).text(declaration, left, y + 10, { width: halfW });
      y = doc.y;
    }

    const sigY = Math.max(y, summaryTop + 300);
    doc.fontSize(7).font("Helvetica").fillColor(MUTED).text("Receiver's signature", rightX, sigY - 120, { width: halfW });
    doc.moveTo(rightX, sigY - 8).lineTo(right, sigY - 8).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.fontSize(7.5).fillColor(INK).text(`For ${d.workspace.name}`, rightX, sigY, { width: halfW, align: "right" });
    doc.fontSize(6.5).fillColor(MUTED).text("Authorised signatory", rightX, doc.y + 2, { width: halfW, align: "right" });

    // ------------------------------------------------------------- footers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.fontSize(6.5).font("Helvetica").fillColor(MUTED);
      doc.text(
        `${d.workspace.name} · ${d.workspace.website ?? ""} · GSTIN ${d.workspace.gstin ?? "—"}\n` +
          `Computer-generated ${d.docType === "ESTIMATE" ? "estimate" : "invoice"}. Contents are confidential and intended for the addressee.`,
        left,
        795,
        { width: right - left, align: "center" },
      );
      doc.text(`${d.invoiceNo}   PAGE ${i + 1} OF ${range.count}`, left, 795, { width: right - left, align: "right" });
    }
  }
}
