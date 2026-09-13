// Thin wrapper around the Plaid SDK (BF-1). Environment-driven so sandbox
// and production never share credentials. Every caller passes a user/actor
// for the audit trail; tokens themselves never enter this module's logs.

import { Configuration, PlaidApi, PlaidEnvironments, CountryCode, Products } from 'plaid';

function configFor() {
  const env = process.env.PLAID_ENV ?? 'sandbox';
  if (env === 'production' && !process.env.PLAID_SECRET_PRODUCTION) {
    throw new Error('PLAID_SECRET_PRODUCTION is not configured.');
  }
  const secret = env === 'production' ? process.env.PLAID_SECRET_PRODUCTION : process.env.PLAID_SECRET_SANDBOX;
  if (!process.env.PLAID_CLIENT_ID || !secret) {
    throw new Error('Plaid credentials are not configured in this environment.');
  }
  const baseOptions =
    env === 'sandbox' ? { sandbox: true } : env === 'development' ? { development: true } : { production: true };
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env as 'sandbox' | 'development' | 'production'],
      baseOptions: { headers: { 'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID, 'PLAID-SECRET': secret, ...baseOptions } },
    })
  );
}

function client(): PlaidApi {
  return configFor();
}

export interface LinkTokenResult {
  linkToken: string;
  expiration: string;
}

/** Creates a Plaid Link token scoped to Canadian transactions. */
export async function createLinkToken(opts: { userId: string; companyName: string }): Promise<LinkTokenResult> {
  const res = await client().linkTokenCreate({
    user: { client_user_id: opts.userId },
    client_name: opts.companyName,
    language: 'en',
    country_codes: [CountryCode.Ca],
    products: [Products.Transactions],
  });
  if (!res.data.link_token) {
    throw new Error('Plaid returned no link token.');
  }
  return { linkToken: res.data.link_token, expiration: res.data.expiration };
}

/** Exchanges a public token for an access token (caller encrypts it at once). */
export async function exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
  const res = await client().itemPublicTokenExchange({ public_token: publicToken });
  return { accessToken: res.data.access_token, itemId: res.data.item_id };
}

export interface ProviderAccount {
  providerAccountId: string;
  name: string;
  mask: string | null;
  subtype: string | null;
  currency: string;
  currentBalance: number | null;
  availableBalance: number | null;
}

/** Lists accounts for an item. */
export async function getItemAccounts(accessToken: string): Promise<ProviderAccount[]> {
  const res = await client().accountsGet({ access_token: accessToken });
  return res.data.accounts.map((a) => ({
    providerAccountId: a.account_id,
    name: a.name,
    mask: a.mask ?? null,
    subtype: a.subtype ?? null,
    currency: a.balances?.iso_currency_code ?? 'CAD',
    currentBalance: a.balances?.current ?? null,
    availableBalance: a.balances?.available ?? null,
  }));
}

export interface ProviderItem {
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
  consentExpiresAt: string | null;
  status: string | null;
}

/** Fetches item + institution metadata for a connection. */
export async function getItem(accessToken: string): Promise<ProviderItem> {
  const item = await client().itemGet({ access_token: accessToken });
  const d = item.data;
  let institutionName: string | null = null;
  if (d.item.institution_id) {
    try {
      const inst = await client().institutionsGetById({
        institution_id: d.item.institution_id,
        country_codes: [CountryCode.Ca],
      });
      institutionName = inst.data.institution.name;
    } catch {
      institutionName = null;
    }
  }
  return {
    itemId: d.item.item_id,
    institutionId: d.item.institution_id ?? null,
    institutionName,
    // Provider-reported expiry, when the institution schedules one — never
    // invented. (Consent expiry is not a general Canadian banking feature.)
    consentExpiresAt: d.item.consent_expiration_time ?? null,
    status: d.status?.investments?.last_successful_update || d.status?.transactions?.last_successful_update ? null : null,
  };
}

/** Removes the item at the provider — called BEFORE the local token is deleted. */
export async function removeItem(accessToken: string): Promise<void> {
  await client().itemRemove({ access_token: accessToken });
}
