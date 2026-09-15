import { bankFeedPilotAllowed } from '@/lib/bank-feed/pilot';
import { plaidAmountToLedger } from '@/lib/bank-feed/plaid-client';
describe('BF-5 production pilot boundary', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  test('production is closed by default and only selected companies pass', () => {
    process.env.PLAID_ENV = 'production'; delete process.env.BANK_FEED_PILOT_COMPANY_IDS;
    expect(bankFeedPilotAllowed('a')).toBe(false);
    process.env.BANK_FEED_PILOT_COMPANY_IDS = 'a, b';
    expect(bankFeedPilotAllowed('a')).toBe(true); expect(bankFeedPilotAllowed('c')).toBe(false);
    process.env.BANK_FEEDS_DISABLED = 'true'; expect(bankFeedPilotAllowed('a')).toBe(false);
  });
  test('production hosting cannot silently use sandbox feeds', () => {
    process.env.VERCEL_ENV = 'production'; process.env.PLAID_ENV = 'sandbox';
    expect(bankFeedPilotAllowed('a')).toBe(false);
  });
  test('Plaid purchase, deposit, refund and card repayment use LedgerPro signs', () => {
    expect(plaidAmountToLedger(12.34)).toBe(-12.34);
    expect(plaidAmountToLedger(-1000)).toBe(1000);
    expect(plaidAmountToLedger(-12.34)).toBe(12.34);
    expect(plaidAmountToLedger(-250)).toBe(250);
    expect(() => plaidAmountToLedger(NaN)).toThrow();
  });
});
