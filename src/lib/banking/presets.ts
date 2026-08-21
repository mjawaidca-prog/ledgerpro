/**
 * Import presets — the 10 bank format signatures from the design.
 * ensureImportPresets() upserts the system presets; call it lazily from the
 * import-presets route and from prisma/seed.ts.
 */

import { db } from '@/lib/db';

interface SystemPreset {
  institution: 'RBC' | 'TD' | 'BMO' | 'SCOTIA' | 'CIBC' | 'DESJARDINS' | 'NBC' | 'TANGERINE' | 'EQ' | 'OTHER';
  label: string;
  fileTypes: string[];
  hasHeader: boolean;
  dateFormat: 'MDY' | 'MM_DD_YYYY' | 'YYYY_MM_DD' | 'YYYYMMDD' | 'DD_MM_YYYY';
  amountMode: 'signed' | 'debit_credit';
  columnMap: Record<string, string>;
}

export const SYSTEM_PRESETS: SystemPreset[] = [
  {
    institution: 'RBC',
    label: 'RBC Royal Bank',
    fileTypes: ['csv'],
    hasHeader: true,
    dateFormat: 'MDY',
    amountMode: 'signed',
    columnMap: { 'Transaction Date': 'date', 'Description 1': 'description', 'CAD$': 'amount_signed', 'Balance': 'statement_balance' },
  },
  {
    institution: 'TD',
    label: 'TD Canada Trust',
    fileTypes: ['csv'],
    hasHeader: true,
    dateFormat: 'MM_DD_YYYY',
    amountMode: 'debit_credit',
    columnMap: { 'Transaction Date': 'date', 'Description': 'description', 'Withdrawals': 'amount_debit', 'Deposits': 'amount_credit', 'Balance': 'statement_balance' },
  },
  {
    institution: 'BMO',
    label: 'BMO Bank of Montreal',
    fileTypes: ['csv'],
    hasHeader: true,
    dateFormat: 'YYYYMMDD',
    amountMode: 'signed',
    columnMap: { 'Transaction Date': 'date', 'Description': 'description', 'Amount': 'amount_signed', 'Balance': 'statement_balance' },
  },
  {
    institution: 'SCOTIA',
    label: 'Scotiabank',
    fileTypes: ['csv'],
    hasHeader: true,
    dateFormat: 'YYYY_MM_DD',
    amountMode: 'signed',
    columnMap: { 'Date': 'date', 'Description': 'description', 'Amount': 'amount_signed', 'Balance': 'statement_balance' },
  },
  {
    institution: 'CIBC',
    label: 'CIBC',
    fileTypes: ['csv'],
    hasHeader: false, // headerless CSV — positional columns
    dateFormat: 'YYYY_MM_DD',
    amountMode: 'debit_credit',
    columnMap: { 'Column 1': 'date', 'Column 2': 'description', 'Column 3': 'amount_debit', 'Column 4': 'amount_credit' },
  },
  {
    institution: 'DESJARDINS',
    label: 'Desjardins',
    fileTypes: ['csv'],
    hasHeader: true,
    dateFormat: 'YYYY_MM_DD',
    amountMode: 'debit_credit',
    columnMap: { 'Date': 'date', 'Description': 'description', 'Debit': 'amount_debit', 'Credit': 'amount_credit', 'Balance': 'statement_balance' },
  },
  {
    institution: 'NBC',
    label: 'National Bank',
    fileTypes: ['csv'],
    hasHeader: true,
    dateFormat: 'DD_MM_YYYY',
    amountMode: 'signed',
    columnMap: { 'Date': 'date', 'Description': 'description', 'Amount': 'amount_signed', 'Balance': 'statement_balance' },
  },
  {
    institution: 'TANGERINE',
    label: 'Tangerine',
    fileTypes: ['csv'],
    hasHeader: true,
    dateFormat: 'MDY',
    amountMode: 'signed',
    columnMap: { 'Date': 'date', 'Transaction': 'description', 'Amount': 'amount_signed', 'Balance': 'statement_balance' },
  },
  {
    institution: 'EQ',
    label: 'EQ Bank',
    fileTypes: ['ofx', 'qfx'],
    hasHeader: true,
    dateFormat: 'YYYY_MM_DD',
    amountMode: 'signed',
    columnMap: {},
  },
  {
    institution: 'OTHER',
    label: 'Generic CSV',
    fileTypes: ['csv'],
    hasHeader: true,
    dateFormat: 'YYYY_MM_DD',
    amountMode: 'signed',
    columnMap: {}, // full manual mapping
  },
];

export async function ensureImportPresets(): Promise<number> {
  const existing = await db.importPreset.findMany({ where: { isSystem: true }, select: { institution: true } });
  const have = new Set(existing.map((p) => p.institution));
  let created = 0;

  for (const preset of SYSTEM_PRESETS) {
    if (have.has(preset.institution)) continue;
    await db.importPreset.upsert({
      where: { id: `sys-${preset.institution.toLowerCase()}` },
      update: {},
      create: {
        id: `sys-${preset.institution.toLowerCase()}`,
        companyId: null,
        institution: preset.institution,
        label: preset.label,
        fileTypes: preset.fileTypes,
        hasHeader: preset.hasHeader,
        dateFormat: preset.dateFormat,
        amountMode: preset.amountMode,
        columnMap: preset.columnMap as any,
        isSystem: true,
      },
    });
    created++;
  }

  return created;
}
