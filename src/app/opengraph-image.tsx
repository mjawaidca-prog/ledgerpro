import { ImageResponse } from 'next/og';

export const alt = 'LedgerPro — Canadian accounting software';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#07111f',
          color: 'white',
          padding: '72px',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', fontSize: 34, fontWeight: 800 }}>
          <div style={{ display: 'flex', width: 58, height: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', background: '#b3261e' }}>
            L
          </div>
          LedgerPro
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', maxWidth: 980 }}>
          <div style={{ fontSize: 70, lineHeight: 1.05, fontWeight: 900 }}>
            Accounting software built for Canadian small businesses
          </div>
          <div style={{ fontSize: 30, color: '#cbd5e1' }}>
            Invoicing, bank reconciliation, Canadian sales tax, and financial reporting in one double-entry ledger.
          </div>
        </div>
        <div style={{ display: 'flex', color: '#fca5a5', fontSize: 24 }}>A product of Nexvar Lab Inc.</div>
      </div>
    ),
    size,
  );
}
