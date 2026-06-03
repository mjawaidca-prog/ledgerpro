import { AppShell } from '@/components/layout/AppShell'
import { ContactsContent } from '@/components/contacts/ContactsContent'
import { createServerCaller } from '@/lib/trpc/trpc'

export type ContactRow = {
  id: string
  name: string
  company: string
  type: 'Customer' | 'Supplier'
  email: string
  phone: string
  outstandingBalance: number
  status: 'Active' | 'Inactive'
  initials: string
  color: string
}

export type ContactStats = {
  total: number
  customers: number
  suppliers: number
  customerBalance: number
  supplierBalance: number
  outstandingBalance: number
}

const FALLBACK_CONTACTS: ContactRow[] = [
  { id: '1',  name: 'Marcus Webb',  company: 'Atlas Logistics',     type: 'Customer', email: 'marcus.webb@atlaslogistics.com', phone: '(415) 555-0142', outstandingBalance: 24900.00, status: 'Active',   initials: 'MW', color: '#0f8a53' },
  { id: '2',  name: 'Priya Nair',   company: 'Summit Health',       type: 'Customer', email: 'priya.nair@summithealth.org',   phone: '(617) 555-0119', outstandingBalance: 18200.00, status: 'Active',   initials: 'PN', color: '#3074ef' },
  { id: '3',  name: 'Tom Vega',     company: 'Vertex Partners',     type: 'Customer', email: 't.vega@vertexpartners.com',     phone: '(312) 555-0173', outstandingBalance: 7300.00,  status: 'Active',   initials: 'TV', color: '#4b5666' },
  { id: '4',  name: 'Renee Park',   company: 'WeWork',              type: 'Supplier', email: 'ar@wework.com',                 phone: '(646) 555-0111', outstandingBalance: 3500.00,  status: 'Active',   initials: 'RP', color: '#1f6feb' },
  { id: '5',  name: 'Harold Means', company: 'Harbor Foods',        type: 'Customer', email: 'accounts@harborfoods.com',      phone: '(206) 555-0164', outstandingBalance: 1540.00,  status: 'Inactive', initials: 'HM', color: '#697587' },
  { id: '6',  name: 'Jordan Pike',  company: 'Amazon Web Services', type: 'Supplier', email: 'billing@aws.amazon.com',        phone: '(206) 555-0100', outstandingBalance: 1284.30,  status: 'Active',   initials: 'JP', color: '#ec912d' },
  { id: '7',  name: 'Carla Boyd',   company: 'State Farm',          type: 'Supplier', email: 'billing@statefarm.com',         phone: '(309) 555-0177', outstandingBalance: 1200.00,  status: 'Inactive', initials: 'CB', color: '#cf353c' },
  { id: '8',  name: 'Dana Cho',     company: 'Brightline Studio',   type: 'Customer', email: 'dana@brightlinestudio.com',     phone: '(212) 555-0188', outstandingBalance: 980.00,   status: 'Active',   initials: 'DC', color: '#b97c12' },
  { id: '9',  name: 'Sam Idris',    company: 'Adobe Inc.',          type: 'Supplier', email: 'ar@adobe.com',                  phone: '(408) 555-0136', outstandingBalance: 599.88,   status: 'Active',   initials: 'SI', color: '#e0484e' },
  { id: '10', name: 'Elena Ruiz',   company: 'Riverside Café',      type: 'Customer', email: 'elena@riversidecafe.com',       phone: '(503) 555-0150', outstandingBalance: 0.00,     status: 'Active',   initials: 'ER', color: '#16a063' },
]

const FALLBACK_STATS: ContactStats = {
  total: 10,
  customers: 6,
  suppliers: 4,
  customerBalance: 52920,
  supplierBalance: 6584,
  outstandingBalance: 46336,
}

export default async function ContactsPage() {
  const caller = createServerCaller()

  let contacts: ContactRow[] = FALLBACK_CONTACTS
  let stats: ContactStats = FALLBACK_STATS

  try {
    const [dbContacts, dbStats] = await Promise.all([
      caller.contacts.list({}),
      caller.contacts.stats(),
    ])
    if (dbContacts.length > 0) {
      contacts = dbContacts as ContactRow[]
    }
    if (dbStats) {
      stats = dbStats as ContactStats
    }
  } catch {
    // use fallback
  }

  return (
    <AppShell>
      <ContactsContent contacts={contacts} stats={stats} />
    </AppShell>
  )
}
