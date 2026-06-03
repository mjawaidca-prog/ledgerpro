import { initTRPC } from '@trpc/server'
import superjson from 'superjson'

export function createTRPCContext() {
  return {}
}

export type TRPCContext = ReturnType<typeof createTRPCContext>

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
})

export const router = t.router
export const publicProcedure = t.procedure
export const createCallerFactory = t.createCallerFactory
