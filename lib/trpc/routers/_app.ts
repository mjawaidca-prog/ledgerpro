import { router } from '../server'
import { dashboardRouter } from './dashboard'
import { invoicesRouter } from './invoices'
import { expensesRouter } from './expenses'
import { bankingRouter } from './banking'
import { coaRouter } from './coa'
import { contactsRouter } from './contacts'

export const appRouter = router({
  dashboard: dashboardRouter,
  invoices: invoicesRouter,
  expenses: expensesRouter,
  banking: bankingRouter,
  coa: coaRouter,
  contacts: contactsRouter,
})

export type AppRouter = typeof appRouter
