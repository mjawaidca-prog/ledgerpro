import { createCallerFactory, createTRPCContext } from './server'
import { appRouter } from './routers/_app'

const createCaller = createCallerFactory(appRouter)

export function createServerCaller() {
  const ctx = createTRPCContext()
  return createCaller(ctx)
}
