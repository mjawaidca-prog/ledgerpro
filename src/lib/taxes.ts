/**
 * Canadian tax rate system.
 * GST (5%) is federal. HST replaces GST+PST in some provinces.
 * PST is separate provincial tax in BC, SK, MB, QC.
 */

export type Province = 'AB' | 'BC' | 'MB' | 'NB' | 'NL' | 'NS' | 'NT' | 'NU' | 'ON' | 'PE' | 'QC' | 'SK' | 'YT';

interface TaxInfo {
  province: Province;
  provinceName: string;
  gst: number;
  hst: number;
  pst: number;
  totalRate: number;
  label: string;
}

export const CANADIAN_TAX_RATES: Record<Province, TaxInfo> = {
  AB: { province: 'AB', provinceName: 'Alberta',                   gst: 5.0, hst: 0,  pst: 0,    totalRate: 5.0,   label: '5% GST' },
  BC: { province: 'BC', provinceName: 'British Columbia',          gst: 5.0, hst: 0,  pst: 7.0,  totalRate: 12.0,  label: '5% GST + 7% PST' },
  MB: { province: 'MB', provinceName: 'Manitoba',                  gst: 5.0, hst: 0,  pst: 7.0,  totalRate: 12.0,  label: '5% GST + 7% PST' },
  NB: { province: 'NB', provinceName: 'New Brunswick',             gst: 0,    hst: 15, pst: 0,    totalRate: 15.0,  label: '15% HST' },
  NL: { province: 'NL', provinceName: 'Newfoundland and Labrador', gst: 0,    hst: 15, pst: 0,    totalRate: 15.0,  label: '15% HST' },
  NS: { province: 'NS', provinceName: 'Nova Scotia',               gst: 0,    hst: 15, pst: 0,    totalRate: 15.0,  label: '15% HST' },
  NT: { province: 'NT', provinceName: 'Northwest Territories',     gst: 5.0, hst: 0,  pst: 0,    totalRate: 5.0,   label: '5% GST' },
  NU: { province: 'NU', provinceName: 'Nunavut',                   gst: 5.0, hst: 0,  pst: 0,    totalRate: 5.0,   label: '5% GST' },
  ON: { province: 'ON', provinceName: 'Ontario',                   gst: 0,    hst: 13, pst: 0,    totalRate: 13.0,  label: '13% HST' },
  PE: { province: 'PE', provinceName: 'Prince Edward Island',      gst: 0,    hst: 15, pst: 0,    totalRate: 15.0,  label: '15% HST' },
  QC: { province: 'QC', provinceName: 'Quebec',                    gst: 5.0, hst: 0,  pst: 9.975, totalRate: 14.975, label: '5% GST + 9.975% QST' },
  SK: { province: 'SK', provinceName: 'Saskatchewan',              gst: 5.0, hst: 0,  pst: 6.0,  totalRate: 11.0,  label: '5% GST + 6% PST' },
  YT: { province: 'YT', provinceName: 'Yukon',                     gst: 5.0, hst: 0,  pst: 0,    totalRate: 5.0,   label: '5% GST' },
};

export function getTaxRate(province: Province): TaxInfo {
  return CANADIAN_TAX_RATES[province] || CANADIAN_TAX_RATES['AB'];
}

export function calculateTax(subtotal: number, province: Province): {
  subtotal: number;
  gst: number;
  hst: number;
  pst: number;
  totalTax: number;
  total: number;
  rate: number;
  label: string;
} {
  const rates = getTaxRate(province);
  const gstAmount = Math.round(subtotal * (rates.gst / 100) * 100) / 100;
  const hstAmount = Math.round(subtotal * (rates.hst / 100) * 100) / 100;
  const pstAmount = Math.round(subtotal * (rates.pst / 100) * 100) / 100;
  const totalTax = Math.round((gstAmount + hstAmount + pstAmount) * 100) / 100;
  const total = Math.round((subtotal + totalTax) * 100) / 100;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    gst: gstAmount,
    hst: hstAmount,
    pst: pstAmount,
    totalTax,
    total,
    rate: rates.totalRate,
    label: rates.label,
  };
}

export function fiscalYearDates(startDate: string): { start: Date; end: Date } {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return { start, end };
}

export const PROVINCE_OPTIONS = Object.values(CANADIAN_TAX_RATES).map((t) => ({
  value: t.province,
  label: `${t.provinceName} — ${t.label}`,
}));

export const BUSINESS_TYPES = [
  { value: 'sole_proprietor', label: 'Sole Proprietor' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'nonprofit', label: 'Non-Profit Organization' },
  { value: 'other', label: 'Other' },
];
