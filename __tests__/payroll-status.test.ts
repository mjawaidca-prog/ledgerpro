import { payrollConnectionState } from '@/lib/payroll-status';

const base = { apiAccessEnabled: true, planApiAccess: true, activeWriteKeyCount: 0, payrollRunCount: 0 };

describe('payrollConnectionState', () => {
  test('connected when pay runs have posted', () => {
    expect(payrollConnectionState({ ...base, payrollRunCount: 3 })).toBe('connected');
  });
  test('connected history wins even if API access later lapses', () => {
    expect(payrollConnectionState({ apiAccessEnabled: false, planApiAccess: false, activeWriteKeyCount: 0, payrollRunCount: 1 })).toBe('connected');
  });
  test('no_api_access when the company switch is off', () => {
    expect(payrollConnectionState({ ...base, apiAccessEnabled: false })).toBe('no_api_access');
  });
  test('no_api_access when the plan lacks API access', () => {
    expect(payrollConnectionState({ ...base, planApiAccess: false })).toBe('no_api_access');
  });
  test('key_ready when a write key exists but nothing has posted', () => {
    expect(payrollConnectionState({ ...base, activeWriteKeyCount: 1 })).toBe('key_ready');
  });
  test('not_connected otherwise', () => {
    expect(payrollConnectionState(base)).toBe('not_connected');
  });
});
