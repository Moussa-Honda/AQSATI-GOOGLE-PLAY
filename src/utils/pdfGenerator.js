import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { settingsService, installmentService, managerService } from '../services/database';

export const PDF_MODES = {
  GLOBAL_STATEMENT:    'GLOBAL_STATEMENT',
  CUSTOMERS_SUMMARY:   'CUSTOMERS_SUMMARY',
  CONTRACT_STATEMENT:  'CONTRACT_STATEMENT',
  INSTALLMENT_RECEIPT: 'INSTALLMENT_RECEIPT',
  CUSTODY_STATEMENT:  'CUSTODY_STATEMENT',
  MANAGERS_OVERDUE_SUMMARY: 'MANAGERS_OVERDUE_SUMMARY',
};

const fmt     = (n) => Number(n || 0).toLocaleString('en-US');
const fmtDate = (d) => {
  if (!d) return '-';
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return String(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  } catch { return String(d); }
};
const today = () => fmtDate(new Date().toISOString());

const getPaidAmount = (installment) => {
  const actualPaid = Number(installment?.actual_paid || 0);
  const status = String(installment?.status || '').trim().toLowerCase();
  return status === 'paid' && actualPaid <= 0
    ? Number(installment?.amount || 0)
    : actualPaid;
};

const loadSettings = async () => {
  try {
    return {
      businessName:    (await settingsService.get('business_name'))      || '',
      businessContact: (await settingsService.get('business_contact'))   || '',
      taxNumber:       (await settingsService.get('tax_number'))          || '',
      showDetails:     (await settingsService.get('show_details_on_pdf')) === 'true',
      stampEnabled:    (await settingsService.get('pdf_stamp_enabled'))    === 'true',
      stampImage:      (await settingsService.get('pdf_stamp_image'))      || '',
      stampText:       (await settingsService.get('pdf_stamp_text'))       || '',
      signatureEnabled: (await settingsService.get('pdf_signature_enabled')) === 'true',
      signatureImage:   (await settingsService.get('pdf_signature_image'))   || '',
      signatureText:    (await settingsService.get('pdf_signature_text'))    || '',
      ibanNumber:      (await settingsService.get('iban_number'))         || '',
    };
  } catch {
    return { businessName:'', businessContact:'', taxNumber:'', showDetails:false, stampEnabled:false, stampImage:'', stampText:'', signatureEnabled:false, signatureImage:'', signatureText:'', ibanNumber:'' };
  }
};

// ─── Shared CSS ───────────────────────────────────────────────────────────────
const BASE_CSS = `
  @font-face { font-family:'Amiri'; src:url('/fonts/Amiri-Regular.ttf') format('truetype'); }
  * { box-sizing:border-box; margin:0; padding:0; }
  body, .pdf-page-root { 
    font-family:'Tajawal','Amiri','Arial Unicode MS',Arial,sans-serif; 
    direction:rtl; 
    background:#ffffff !important; 
    width:794px; 
    color:#0f172a !important; 
  }
  .pdf-page-root * {
    color: #0f172a;
  }
  .pdf-page-root .header, .pdf-page-root .header *, .pdf-page-root .strip, .pdf-page-root .strip * {
    color: #ffffff !important;
  }
  .header { background:#1e293b; color:#ffffff !important; padding:18px 24px 14px;
            display:flex; justify-content:space-between; align-items:flex-start; }
  .header .title { font-size:22px; font-weight:bold; color:#ffffff !important; }
  .header .sub   { font-size:11px; margin-top:4px; opacity:.9; color:#f1f5f9 !important; }
  .header .co    { font-size:15px; text-align:left; line-height:1.7; color:#ffffff !important; }
  .header .co small { display:block; font-size:10px; opacity:.85; color:#e2e8f0 !important; }
  .divider { height:1px; background:#e2e8f0; margin:0 24px; }
  .info { display:flex; justify-content:space-between; padding:14px 24px; color:#0f172a !important; }
  .info-col { display:flex; flex-direction:column; gap:6px; }
  .lbl { font-size:11px; color:#64748b !important; }
  .val { font-size:13px; font-weight:bold; color:#0f172a !important; }
  table { width:calc(100% - 48px); margin:0 24px; border-collapse:collapse; background:#ffffff !important; }
  th { background:#1e293b; color:#ffffff !important; padding:10px 8px; font-size:12px; text-align:center; vertical-align:middle; border:1px solid #334155; }
  td { padding:8px 8px; font-size:12px; border:1px solid #cbd5e1; text-align:center; vertical-align:middle; color:#0f172a !important; background:#ffffff; }
  tr:nth-child(even) td { background:#f8fafc; }
  .totals { margin:14px 24px 0; border:1px solid #cbd5e1; border-radius:6px; overflow:hidden; background:#ffffff !important; }
  .tot-row { display:flex; justify-content:space-between; padding:9px 14px; font-size:12px; color:#0f172a !important; }
  .tot-row.grand, .tot-row.grand * { background:#1e293b; color:#ffffff !important; font-size:13px; font-weight:bold; }
  .green { color:#059669 !important; font-weight:bold; }
  .red   { color:#dc2626 !important; font-weight:bold; }
  .amber { color:#d97706 !important; font-weight:bold; }
  .footer { display:flex; justify-content:space-between; padding:12px 24px 0; border-top:1px solid #cbd5e1; margin:18px 24px 0; color:#334155 !important; }
  .iban  { font-size:11px; color:#334155 !important; margin-top:4px; direction:ltr; text-align:right; font-weight:bold; }
  .sig-line { border-top:1px solid #94a3b8; width:120px; margin-top:16px; }
  .pdf-stamp { min-width:115px; text-align:center; color:#334155 !important; }
  .pdf-stamp-label { font-size:10px; color:#64748b !important; margin-bottom:5px; }
  .pdf-stamp img { display:block; width:92px; height:48px; object-fit:contain; margin:0 auto; }
  .pdf-stamp-text { display:inline-block; max-width:110px; border:1.5px solid #0f766e; border-radius:999px; padding:8px 11px; color:#0f766e !important; font-size:11px; font-weight:bold; transform:rotate(-5deg); }
  .pdf-signature { min-width:125px; text-align:center; color:#334155 !important; }
  .pdf-signature img { display:block; width:120px; height:50px; object-fit:contain; margin:2px auto 0; }
  .pdf-signature-text { display:inline-block; max-width:120px; color:#334155 !important; font-size:12px; font-weight:bold; margin-top:10px; }
  .strip { background:#1e293b; color:#ffffff !important; text-align:center; padding:10px; font-size:13px; margin-top:14px; }
  /* Receipt */
  .receipt-amt-label { text-align:center; font-size:13px; padding:10px 0 6px; color:#0f172a !important; }
  .receipt-amt-box { border:2px solid #059669; background:#ecfdf5; border-radius:6px;
                     margin:0 80px; padding:12px 0; text-align:center;
                     font-size:28px; font-weight:bold; color:#059669 !important; }
  .detail-card { margin:14px 24px 0; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; }
  .detail-row  { display:flex; justify-content:space-between; padding:9px 14px; font-size:12px; border-bottom:1px solid #e2e8f0; color:#0f172a !important; }
  .detail-row:last-child { border-bottom:none; }
  .detail-label { color:#64748b !important; font-size:11px; }
  .sigs { display:flex; justify-content:space-between; padding:14px 24px 0; color:#0f172a !important; }
  .sig-block { text-align:center; font-size:11px; color:#0f172a !important; }
`;

// ─── HTML builders ────────────────────────────────────────────────────────────
const wrap = (body) => `
<div class="pdf-page-root" style="background:#ffffff !important; color:#0f172a !important; width:794px; direction:rtl; font-family:'Tajawal','Amiri',sans-serif; -webkit-font-smoothing:antialiased;">
  <style>${BASE_CSS}</style>
  ${body}
</div>`;

const businessDetailsHTML = (s) => {
  if (!s.showDetails) return '';

  const lines = [
    s.businessName ? `<div>${s.businessName}</div>` : '',
    s.businessContact ? `<small>جوال: ${s.businessContact}</small>` : '',
    s.taxNumber ? `<small>الرقم الضريبي: ${s.taxNumber}</small>` : '',
  ].filter(Boolean);

  return lines.join('');
};

const headerHTML = (title, sub, s, managedBy = null) => `
<div class="header">
  <div>
    <div class="title">${title}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
    ${managedBy ? `<div class="sub" style="font-size:9px; opacity:0.7; margin-top:2px;">هذا الحساب يدار بالنيابة بواسطة: ${managedBy}</div>` : ''}
  </div>
  <div class="co">${businessDetailsHTML(s)}</div>
</div>`;

const escapeHTML = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

const pdfStampHTML = (s) => {
  if (!s.stampEnabled) return '';
  const text = escapeHTML(s.stampText || s.businessName || 'معتمد');
  return `<div class="pdf-stamp"><div class="pdf-stamp-label">الختم</div>${s.stampImage ? `<img src="${s.stampImage}" alt="" />` : `<div class="pdf-stamp-text">${text}</div>`}</div>`;
};

const pdfSignatureHTML = (s) => {
  if (!s.signatureEnabled) return '<div class="sig-line"></div>';
  const text = escapeHTML(s.signatureText || s.businessName || 'توقيع الإدارة');
  return s.signatureImage
    ? `<img src="${s.signatureImage}" alt="" />`
    : `<div class="pdf-signature-text">${text}</div>`;
};

const footerHTML = (s) => `
<div class="footer">
  <div class="pdf-signature"><div>توقيع الإدارة</div>${pdfSignatureHTML(s)}</div>
  ${pdfStampHTML(s)}
  <div style="text-align:left"><div>معلومات الدفع</div>${s.ibanNumber ? `<div class="iban">IBAN: ${s.ibanNumber}</div>` : ''}</div>
</div>
<div class="strip">شكراً لتعاملكم معنا</div>`;

const totalsHTML = (total, paid, remain) => `
<div class="totals">
  <div class="tot-row"><span style="font-weight:bold; color:#1e293b;">إجمالي العقد :</span><span style="font-weight:bold; color:#1e293b;">${fmt(Math.round(total))} ر.س</span></div>
  <div class="tot-row"><span style="font-weight:bold; color:#1e293b;">إجمالي المدفوع :</span><span class="green" style="font-weight:bold;">${fmt(Math.round(paid))} ر.س</span></div>
  <div class="tot-row grand"><span>المتبقي :</span><span style="font-weight:bold; color:#ffffff !important;">${fmt(Math.round(remain))} ر.س</span></div>
</div>`;

// ─── Mode 1: Global Summary ───────────────────────────────────────────────────
const buildGlobalHTML = async (customer, contracts, s, managedBy = null) => {
  let rows = '', grandTotal = 0, grandPaid = 0, grandRemain = 0;
  for (const c of contracts) {
    if (!c?.id) continue;
    let insts = [];
    try { insts = (await installmentService.getByContractId(c.id)) || []; } catch { /* Keep the statement printable if installments fail to load. */ }
    const total  = c.total_amount   || 0;
    const disc   = c.discount_amount || 0;
    const paid   = insts.reduce((s, i) => s + getPaidAmount(i), 0);
    const remain = Math.max(0, total - paid - disc);
    rows += `<tr>
      <td style="font-weight:bold; color:#0f172a;">${c.title || '#' + c.id}</td>
      <td style="font-weight:bold; color:#0f172a;">${fmt(Math.round(total))} ر.س</td>
      <td class="green" style="font-weight:bold;">${fmt(Math.round(paid))} ر.س</td>
      <td class="${remain > 0 ? 'red' : 'green'}" style="font-weight:bold;">${fmt(Math.round(remain))} ر.س</td>
    </tr>`;
    grandTotal += total; grandPaid += paid; grandRemain += remain;
  }
  return wrap(`
    ${headerHTML('كشف حساب شامل', `العميل: ${customer?.name || ''}`, s, managedBy)}
    <div class="info">
      <div class="info-col">
        <div class="lbl">اسم العميل</div><div class="val">${customer?.name || '—'}</div>
        <div class="lbl">رقم الجوال</div><div class="val" style="direction:ltr; text-align:right;">${customer?.phone || '—'}</div>
      </div>
      <div class="info-col" style="text-align:left">
        <div class="lbl">تاريخ الكشف</div><div class="val" style="direction:ltr; text-align:left;">${today()}</div>
        <div class="lbl">عدد العقود</div><div class="val" style="color:#0f172a;">${contracts.length}</div>
      </div>
    </div>
    <div class="divider" style="margin-bottom:10px"></div>
    <table><thead><tr><th>اسم العقد</th><th>إجمالي العقد</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="padding:16px; color:#64748b;">لا توجد عقود</td></tr>'}</tbody></table>
    ${totalsHTML(grandTotal, grandPaid, grandRemain)}
     ${footerHTML(s)}`);
};

// ─── Mode 2: Customers Summary ────────────────────────────────────────────────
const buildCustomersSummaryHTML = (customers, summaries, s, scopeName = null, reportTitle = null) => {
  let grandTotal = 0;
  let grandPaid = 0;
  let grandRemain = 0;

  const rows = customers.map((customer) => {
    const summary = summaries?.[customer.id] || {};
    const total = Number(summary.total_contracts || 0);
    const paid = Number(summary.total_paid || 0);
    const remain = Math.max(0, Number(summary.total_remaining ?? (total - paid - Number(summary.total_discounts || 0))));

    grandTotal += total;
    grandPaid += paid;
    grandRemain += remain;

    return `<tr>
      <td style="font-weight:bold; color:#0f172a; text-align:right;">${escapeHTML(customer.name || 'عميل')}</td>
      <td style="direction:ltr; color:#0f172a;">${escapeHTML(customer.phone || '—')}</td>
      <td style="font-weight:bold; color:#0f172a;">${fmt(Math.round(total))} ر.س</td>
      <td class="green" style="font-weight:bold;">${fmt(Math.round(paid))} ر.س</td>
      <td class="${remain > 0 ? 'red' : 'green'}" style="font-weight:bold;">${fmt(Math.round(remain))} ر.س</td>
    </tr>`;
  }).join('');

  return wrap(`
    ${headerHTML(reportTitle || 'كشف شامل للعملاء', scopeName ? `الحساب: ${escapeHTML(scopeName)}` : 'جميع العملاء', s)}
    <div class="info">
      <div class="info-col">
        <div class="lbl">نطاق التقرير</div><div class="val">${scopeName ? escapeHTML(scopeName) : 'العملاء الشخصيون'}</div>
      </div>
      <div class="info-col" style="text-align:left">
        <div class="lbl">تاريخ التقرير</div><div class="val" style="direction:ltr; text-align:left;">${today()}</div>
        <div class="lbl">عدد العملاء</div><div class="val">${customers.length}</div>
      </div>
    </div>
    <div class="divider" style="margin-bottom:10px"></div>
    <table>
      <thead><tr>
        <th style="text-align:right;">اسم العميل</th>
        <th>رقم الجوال</th>
        <th>إجمالي المبلغ</th>
        <th>المبلغ المدفوع</th>
        <th>المبلغ المتبقي</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:16px; color:#64748b;">لا يوجد عملاء</td></tr>'}</tbody>
    </table>
    ${totalsHTML(grandTotal, grandPaid, grandRemain)}
    ${footerHTML(s)}`);
};

// ─── Mode: Managers Overdue Summary ──────────────────────────────────────────
const buildManagersOverdueHTML = (managers, s) => {
  let grandContracts = 0;
  let grandPaid = 0;
  let grandRemain = 0;
  let grandOverdueCustomers = 0;

  const rows = managers.map((mgr) => {
    const total = Number(mgr.total_contracts || 0);
    const paid = Number(mgr.total_paid || 0);
    const remain = Number(mgr.total_remaining || 0);
    const overdueCount = Number(mgr.overdue_customer_count || 0);

    grandContracts += total;
    grandPaid += paid;
    grandRemain += remain;
    grandOverdueCustomers += overdueCount;

    return `<tr>
      <td style="font-weight:bold; color:#0f172a; text-align:right;">${escapeHTML(mgr.name || 'مدير')}</td>
      <td style="direction:ltr; color:#0f172a;">${escapeHTML(mgr.phone || '—')}</td>
      <td style="font-weight:bold; color:#dc2626;">${fmt(overdueCount)}</td>
      <td style="font-weight:bold; color:#0f172a;">${fmt(Math.round(total))} ر.س</td>
      <td class="green" style="font-weight:bold;">${fmt(Math.round(paid))} ر.س</td>
      <td class="${remain > 0 ? 'red' : 'green'}" style="font-weight:bold;">${fmt(Math.round(remain))} ر.س</td>
    </tr>`;
  }).join('');

  return wrap(`
    ${headerHTML('كشف إجمالي المتعثرين', 'تقرير الحسابات بالنيابة - المتعثرين', s)}
    <div class="info">
      <div class="info-col">
        <div class="lbl">نوع التقرير</div><div class="val">ملخص المتعثرين بالنيابة</div>
      </div>
      <div class="info-col" style="text-align:left">
        <div class="lbl">تاريخ التقرير</div><div class="val" style="direction:ltr; text-align:left;">${today()}</div>
        <div class="lbl">عدد الحسابات</div><div class="val">${managers.length}</div>
      </div>
    </div>
    <div class="divider" style="margin-bottom:10px"></div>
    <table>
      <thead><tr>
        <th style="text-align:right;">اسم المدير / الحساب</th>
        <th>رقم الجوال</th>
        <th>العملاء المتعثرون</th>
        <th>إجمالي العقود</th>
        <th>المدفوع</th>
        <th>المتبقي للتحصيل</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="padding:16px; color:#64748b;">لا يوجد حسابات متعثرة</td></tr>'}</tbody>
    </table>
    ${totalsHTML(grandContracts, grandPaid, grandRemain)}
    ${footerHTML(s)}`);
};


// ─── Mode 2: Contract Detail ──────────────────────────────────────────────────
const ORDINAL_UNITS = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
const COMPOUND_ORDINAL_UNITS = ['', 'الحادي', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع'];
const ORDINAL_TENS = ['', '', 'العشرون', 'الثلاثون', 'الأربعون', 'الخمسون', 'الستون', 'السبعون', 'الثمانون', 'التسعون'];
const CARDINAL_UNITS = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const CARDINAL_TEENS = ['', '', '', '', '', '', '', '', '', '', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const CARDINAL_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const CARDINAL_HUNDREDS = ['', 'المائة', 'المائتان', 'الثلاثمائة', 'الأربعمائة', 'الخمسمائة', 'الستمائة', 'السبعمائة', 'الثمانمائة', 'التسعمائة'];
const CARDINAL_SCALES = [
  { value: 1000000000000000, singular: 'الكوادريليون', dual: 'الكوادريليونان', plural: 'كوادريليونات', counted: 'كوادريليون' },
  { value: 1000000000000, singular: 'التريليون', dual: 'التريليونان', plural: 'تريليونات', counted: 'تريليون' },
  { value: 1000000000, singular: 'المليار', dual: 'الملياران', plural: 'مليارات', counted: 'مليار' },
  { value: 1000000, singular: 'المليون', dual: 'المليونان', plural: 'ملايين', counted: 'مليون' },
  { value: 1000, singular: 'الألف', dual: 'الألفان', plural: 'آلاف', counted: 'ألف' },
];

const getArabicOrdinalUnder100 = (number) => {
  if (number <= 10) return ORDINAL_UNITS[number];
  if (number < 20) return `${COMPOUND_ORDINAL_UNITS[number - 10]} عشر`;
  const unit = number % 10;
  const ten = Math.floor(number / 10);
  return unit === 0 ? ORDINAL_TENS[ten] : `${COMPOUND_ORDINAL_UNITS[unit]} وال${ORDINAL_TENS[ten].slice(2)}`;
};

const getArabicCardinalUnder100 = (number) => {
  if (number < 10) return CARDINAL_UNITS[number];
  if (number < 20) return CARDINAL_TEENS[number];
  const unit = number % 10;
  const ten = Math.floor(number / 10);
  return unit === 0 ? CARDINAL_TENS[ten] : `${CARDINAL_UNITS[unit]} و${CARDINAL_TENS[ten]}`;
};

const getArabicCardinalUnder1000 = (number) => {
  if (number < 100) return getArabicCardinalUnder100(number);
  const hundred = Math.floor(number / 100);
  const remainder = number % 100;
  return remainder === 0 ? CARDINAL_HUNDREDS[hundred] : `${CARDINAL_HUNDREDS[hundred]} و${getArabicCardinalUnder100(remainder)}`;
};

const getArabicScaleText = (count, scale) => {
  if (count === 1) return scale.singular;
  if (count === 2) return scale.dual;
  if (count <= 10) return `${getArabicCardinal(count)} ${scale.plural}`;
  return `${getArabicCardinal(count)} ${scale.counted}`;
};

const getArabicCardinal = (number) => {
  if (number < 1000) return getArabicCardinalUnder1000(number);
  const scale = CARDINAL_SCALES.find(item => number >= item.value);
  if (!scale) return fmt(number);
  const count = Math.floor(number / scale.value);
  const remainder = number % scale.value;
  const scaleText = getArabicScaleText(count, scale);
  return remainder === 0 ? scaleText : `${scaleText} و${getArabicCardinal(remainder)}`;
};

const getArabicOrdinal = (number) => {
  const value = Number(number);
  if (!Number.isFinite(value) || value < 1) return String(number || '');
  const normalized = Math.trunc(value);
  if (normalized < 100) return getArabicOrdinalUnder100(normalized);
  const remainder = normalized % 100;
  return remainder === 0
    ? getArabicCardinal(normalized)
    : `${getArabicCardinal(normalized - remainder)} و${getArabicOrdinalUnder100(remainder)}`;
};

const buildContractHTML = async (customer, contract, s, managedBy = null, passedInstallments = null) => {
  let insts = passedInstallments;
  if (!Array.isArray(insts) || insts.length === 0) {
    try {
      const contractId = Number(contract.id);
      insts = (await installmentService.getByContractId(contractId)) || [];
    } catch (e) {
      console.warn('Could not load installments for contract statement:', e);
      insts = [];
    }
  }

  const total  = Number(contract.total_amount || 0);
  const disc   = Number(contract.discount_amount || 0);
  const paid   = insts.reduce((sum, i) => sum + getPaidAmount(i), 0);
  const remain = Math.max(0, total - paid - disc);

  const rows = insts.map((inst, idx) => {
    const origAmount = Number(inst.amount || 0);
    const paidAmount = getPaidAmount(inst);
    const remainingAmount = Math.max(0, origAmount - paidAmount);
    const isPaid = inst.status === 'paid' || (paidAmount > 0 && remainingAmount <= 0.009);
    const isPartial = !isPaid && paidAmount > 0 && remainingAmount > 0;
    const isPostponed = inst.status === 'postponed' && !isPaid;

    const cls = isPaid ? 'green' : isPostponed || isPartial ? 'amber' : 'red';
    const lbl = isPaid ? 'مدفوع' : isPostponed ? 'مؤجل' : isPartial ? 'مدفوع جزئياً' : 'متبقي';

    return `<tr>
      <td style="font-weight:bold; color:#0f172a;">#${idx + 1} (${getArabicOrdinal(idx + 1)})</td>
      <td style="font-family:Arial,sans-serif; direction:ltr; color:#0f172a;">${fmtDate(inst.due_date)}</td>
      <td style="font-weight:bold; color:#0f172a;">${fmt(Math.round(origAmount))} ر.س</td>
      <td class="green" style="font-weight:bold;">${fmt(Math.round(paidAmount))} ر.س</td>
      <td class="${remainingAmount > 0 ? 'red' : 'green'}" style="font-weight:bold;">${fmt(Math.round(remainingAmount))} ر.س</td>
      <td class="${cls}" style="font-weight:bold;">${lbl}</td>
    </tr>`;
  }).join('');

  return wrap(`
    ${headerHTML('كشف حساب عقد', `العقد: ${contract.title || '#'+contract.id}`, s, managedBy)}
    <div class="info">
      <div class="info-col">
        <div class="lbl">اسم العميل</div><div class="val">${customer?.name || '—'}</div>
        <div class="lbl">رقم الجوال</div><div class="val" style="direction:ltr; text-align:right;">${customer?.phone || '—'}</div>
        ${contract.guarantor_name ? `<div class="lbl">الكفيل</div><div class="val">${contract.guarantor_name} ${contract.guarantor_phone ? `(${contract.guarantor_phone})` : ''}</div>` : ''}
      </div>
      <div class="info-col" style="text-align:left">
        <div class="lbl">تاريخ الكشف</div><div class="val" style="direction:ltr; text-align:left;">${today()}</div>
        <div class="lbl">إجمالي العقد</div><div class="val" style="color:#0f172a;">${fmt(Math.round(total))} ر.س</div>
        <div class="lbl">عدد الأقساط</div><div class="val" style="color:#0f172a;">${insts.length} قسط</div>
      </div>
    </div>
    <div class="divider" style="margin-bottom:10px"></div>
    <table>
      <thead>
        <tr>
          <th>رقم القسط</th>
          <th>تاريخ الاستحقاق</th>
          <th>مبلغ القسط</th>
          <th>المسدد</th>
          <th>المتبقي</th>
          <th>الحالة</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6" style="padding:16px; color:#64748b;">لا توجد أقساط مسجلة لهذا العقد</td></tr>'}
      </tbody>
    </table>
    ${totalsHTML(total, paid, remain)}
     ${footerHTML(s)}
  `);
};

// ─── Mode 3: Receipt ──────────────────────────────────────────────────────────
const buildReceiptHTML = (customer, installment, contract, s, managedBy = null) => {
  const amt = Math.round(installment.actual_paid || installment.amount || 0);
  return wrap(`
    ${headerHTML('سند قبض', `رقم الإيصال: ${installment.id}-${new Date().getFullYear()}`, s, managedBy)}
    <div class="receipt-amt-label">تم استلام مبلغ وقدره</div>
    <div class="receipt-amt-box">${fmt(amt)} ر.س</div>
    <div class="detail-card">
      <div class="detail-row"><span class="detail-label">اسم العميل</span><span style="font-weight:bold; color:#0f172a;">${customer?.name || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">اسم العقد</span><span style="font-weight:bold; color:#0f172a;">${contract?.title || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">وصف القسط</span><span style="font-weight:bold; color:#0f172a;">القسط #${installment.id}</span></div>
      <div class="detail-row"><span class="detail-label">تاريخ الاستحقاق</span><span style="font-family:Arial,sans-serif; direction:ltr; color:#0f172a;">${fmtDate(installment.due_date)}</span></div>
      <div class="detail-row"><span class="detail-label">تاريخ السداد</span><span style="font-family:Arial,sans-serif; direction:ltr; color:#0f172a;">${fmtDate(installment.paid_at) || today()}</span></div>
      <div class="detail-row"><span class="detail-label">المبلغ المسدد</span><span class="green" style="font-weight:bold;">${fmt(amt)} ر.س</span></div>
    </div>
      <div class="sigs">
        <div class="sig-block"><div>توقيع المستلم</div><div class="sig-line" style="margin:auto;margin-top:16px"></div></div>
        <div class="sig-block"><div>توقيع العميل</div><div class="sig-line" style="margin:auto;margin-top:16px"></div></div>
      </div>
      ${s.signatureEnabled ? `<div style="margin:14px 24px 0; text-align:center">${pdfSignatureHTML(s)}</div>` : ''}
      ${pdfStampHTML(s)}
     ${s.ibanNumber ? `<div style="text-align:center;font-size:10px;color:#334155;margin-top:10px;direction:ltr">IBAN: ${s.ibanNumber}</div>` : ''}
    <div class="strip">شكراً لتعاملكم معنا</div>`);
};

// ─── Mode 4: Custody Statement ──────────────────────────────────────────────
const buildCustodyHTML = (custody, expenses, s) => {
  const totalSpent = expenses
    .filter((expense) => expense.entry_type !== 'receipt')
    .reduce((sum, expense) => sum + (expense.amount || 0), 0);
  const remaining = (custody.capital || 0) - totalSpent;

  const rows = expenses.map((exp) => `
    <tr>
      <td style="font-family:Arial,sans-serif; direction:ltr; color:#0f172a;">${fmtDate(exp.date)}</td>
      <td style="color:#0f172a;">${exp.entry_type === 'receipt' ? 'سند قبض: ' : ''}${exp.description || '—'}</td>
      <td class="${exp.entry_type === 'receipt' ? 'green' : 'red'}" style="font-weight:bold;">${exp.entry_type === 'receipt' ? '+' : '-'}${fmt(exp.amount)} ر.س</td>
    </tr>
  `).join('');

  return wrap(`
    ${headerHTML('كشف حساب عُهدة', `المسؤول: ${custody.name || ''}`, s)}
    <div class="info">
      <div class="info-col">
        <div class="lbl">اسم المسؤول</div><div class="val">${custody.name || '—'}</div>
        <div class="lbl">المبلغ المسلم</div><div class="val" style="color:#0f172a;">${fmt(custody.capital)} ر.س</div>
      </div>
      <div class="info-col" style="text-align:left">
        <div class="lbl">تاريخ التقرير</div><div class="val" style="direction:ltr; text-align:left;">${today()}</div>
        <div class="lbl">إجمالي العمليات</div><div class="val" style="color:#0f172a;">${expenses.length}</div>
      </div>
    </div>

    <div class="totals" style="background:#f8fafc; border-color:#e2e8f0; margin-bottom:20px">
      <div class="tot-row"><span class="lbl">إجمالي العهدة :</span><span class="val" style="color:#1e293b">${fmt(custody.capital)} ر.س</span></div>
      <div class="tot-row"><span class="lbl">إجمالي المنصرف :</span><span class="val red">${fmt(totalSpent)} ر.س</span></div>
      <div class="tot-row grand" style="background:${remaining < 0 ? '#be123c' : '#047857'}">
        <span>المتبقي :</span>
        <span style="font-weight:bold; color:#ffffff !important;">${fmt(remaining)} ر.س</span>
      </div>
    </div>

     <div style="padding:0 24px 8px; font-weight:bold; font-size:12px; color:#0f172a">سجل العمليات بالتفصيل:</div>
    <table>
      <thead>
        <tr>
          <th style="width:120px">التاريخ</th>
          <th>البيان / الوصف</th>
          <th style="width:120px">المبلغ</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="3" style="text-align:center; padding:20px; color:#64748b">لا توجد مصروفات مسجلة</td></tr>'}
      </tbody>
    </table>
     ${footerHTML(s)}
  `);
};

// ─── HTML → PDF via html2canvas ───────────────────────────────────────────────
const renderHTMLtoPDF = async (htmlString) => {
  // Create hidden container with explicit white background and dark text
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;z-index:-9999;background:#ffffff !important;color:#0f172a !important;direction:rtl;';
  container.innerHTML = htmlString;
  document.body.appendChild(container);

  // Force explicit styling on all inner elements to prevent text-slate-100 inheritance
  container.querySelectorAll('*').forEach(el => {
    if (el.closest('.header') || el.closest('.strip') || el.closest('.tot-row.grand')) {
      el.style.color = '#ffffff';
      return;
    }
    if (el.classList.contains('green')) {
      el.style.color = '#059669';
      return;
    }
    if (el.classList.contains('red')) {
      el.style.color = '#dc2626';
      return;
    }
    if (el.classList.contains('amber')) {
      el.style.color = '#d97706';
      return;
    }
    if (el.classList.contains('lbl') || el.classList.contains('detail-label')) {
      el.style.color = '#64748b';
      return;
    }
    el.style.color = '#0f172a';
  });

  // Wait for Amiri / Tajawal font to load
  try { await document.fonts.ready; } catch { /* Continue rendering with fallback fonts. */ }

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: 794,
      logging: false,
    });

    const imgData  = canvas.toDataURL('image/jpeg', 0.92);
    const imgW     = 210;                             // A4 width mm
    const imgH     = (canvas.height / canvas.width) * imgW;
    const pageH    = 297;                             // A4 height mm
    const doc      = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    let yOffset = 0;
    while (yOffset < imgH) {
      if (yOffset > 0) doc.addPage();
      doc.addImage(imgData, 'JPEG', 0, -yOffset, imgW, imgH);
      yOffset += pageH;
    }

    return doc;
  } finally {
    document.body.removeChild(container);
  }
};

// ─── Save & Share ─────────────────────────────────────────────────────────────
const saveAndShare = async (doc, fileName) => {
  const blob = doc.output('blob');

  if (!Capacitor.isNativePlatform()) {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: fileName,
          text: fileName,
          files: [file]
        });
        return true;
      } catch (err) {
        if (err.name === 'AbortError' || err.message?.includes('canceled') || err.message?.includes('cancelled')) {
          return true;
        }
      }
    }

    // Web fallback: download / view in browser
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }

  const b64 = doc.output('datauristring').split(',')[1];
  await Filesystem.writeFile({ path: fileName, data: b64, directory: Directory.Documents });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Documents });
  try {
    await Share.share({ title: fileName, text: fileName, url: uri, dialogTitle: 'مشاركة الملف' });
  } catch (err) {
    // If user canceled sharing, we don't treat it as a hard error
    if (err.message?.includes('canceled') || err.message?.includes('cancelled')) {
      return true; 
    }
    throw err;
  }
  return true;
};

// ─── Main dispatcher ──────────────────────────────────────────────────────────
export const generatePDF = async (customer, mode, specificData = {}) => {
  try {
    if (!customer && mode !== PDF_MODES.CUSTOMERS_SUMMARY && mode !== PDF_MODES.MANAGERS_OVERDUE_SUMMARY) { alert('بيانات العميل غير متوفرة'); return false; }
    const s    = await loadSettings();
    const date = today();
    const safe = (customer?.name || specificData.scopeName || 'العملاء').replace(/[^\w\u0600-\u06FF]/g, '_');
    let html, fileName;

    let managedBy = null;
    if (customer?.manager_id) {
      try {
        const manager = await managerService.getById(customer.manager_id);
        if (manager) managedBy = manager.name;
      } catch (e) { console.warn('Could not fetch manager info for PDF', e); }
    }

    if (mode === PDF_MODES.GLOBAL_STATEMENT) {
      const { contracts = [] } = specificData;
      html     = await buildGlobalHTML(customer, contracts, s, managedBy);
      fileName = `كشف_شامل_${safe}_${date}.pdf`;

    } else if (mode === PDF_MODES.CUSTOMERS_SUMMARY) {
      const { customers = [], summaries = {}, scopeName = null, reportTitle = null } = specificData;
      html = buildCustomersSummaryHTML(customers, summaries, s, scopeName, reportTitle);
      const titlePrefix = reportTitle ? reportTitle.replace(/[^\w\u0600-\u06FF]/g, '_') : 'كشف_العملاء';
      fileName = `${titlePrefix}_${safe}_${date}.pdf`;

    } else if (mode === PDF_MODES.MANAGERS_OVERDUE_SUMMARY) {
      const { managers = [] } = specificData;
      html = buildManagersOverdueHTML(managers, s);
      fileName = `كشف_إجمالي_المتعثرين_${date}.pdf`;

    } else if (mode === PDF_MODES.CONTRACT_STATEMENT) {
      const { contract, installments } = specificData;
      if (!contract) { alert('بيانات العقد غير متوفرة'); return false; }
      html     = await buildContractHTML(customer, contract, s, managedBy, installments);
      fileName = `كشف_عقد_${(contract.title||'').replace(/\s/g,'_')}_${date}.pdf`;

    } else if (mode === PDF_MODES.INSTALLMENT_RECEIPT) {
      const { installment, contract } = specificData;
      if (!installment) { alert('بيانات القسط غير متوفرة'); return false; }
      html     = buildReceiptHTML(customer, installment, contract || {}, s, managedBy);
      fileName = `إيصال_${installment.id}_${safe}_${date}.pdf`;

    } else if (mode === PDF_MODES.CUSTODY_STATEMENT) {
      const custody = customer; // In this mode, the first arg is the custody object
      const expenses = specificData || [];
      html = buildCustodyHTML(custody, expenses, s);
      fileName = `كشف_عهدة_${(custody.name || 'عُهدة').replace(/\s/g, '_')}_${date}.pdf`;

    } else { return false; }

    const doc = await renderHTMLtoPDF(html);
    return await saveAndShare(doc, fileName);

  } catch (err) {
    console.error('[PDF]', err);
    alert('حدث خطأ أثناء إنشاء PDF: ' + (err?.message || 'خطأ'));
    return false;
  }
};

export const generatePDFStatement = (customer, contracts) =>
  generatePDF(customer, PDF_MODES.GLOBAL_STATEMENT, { contracts });

export default generatePDF;
