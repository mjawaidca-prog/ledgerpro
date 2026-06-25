import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import { compare } from 'bcryptjs';

// Extend the built-in session types for multi-company
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      image?: string;
      activeCompanyId: string | null;
      activeCompanyName: string | null;
      availableCompanies: { id: string; name: string; role: string }[];
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    activeCompanyId: string | null;
    activeCompanyName: string | null;
    availableCompanies: { id: string; name: string; role: string }[];
  }
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db) as any,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password are required');
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email },
          include: {
            memberships: {
              include: { company: true },
            },
          },
        });

        if (!user || !user.passwordHash) {
          throw new Error('Invalid email or password');
        }

        const isValid = await compare(credentials.password, user.passwordHash);
        if (!isValid) {
          throw new Error('Invalid email or password');
        }

        // Get first company (or null if no memberships)
        const primaryMembership = user.memberships[0] || null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          activeCompanyId: primaryMembership?.company?.id || null,
          activeCompanyName: primaryMembership?.company?.name || null,
          availableCompanies: user.memberships.map((m) => ({
            id: m.company.id,
            name: m.company.name,
            role: m.role,
          })),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.activeCompanyId = (user as any).activeCompanyId;
        token.activeCompanyName = (user as any).activeCompanyName;
        token.availableCompanies = (user as any).availableCompanies || [];
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.activeCompanyId = token.activeCompanyId as string | null;
      session.user.activeCompanyName = token.activeCompanyName as string | null;
      session.user.availableCompanies = (token.availableCompanies as any[]) || [];
      return session;
    },
  },
};

export async function getServerSession() {
  const { getServerSession: getSession } = await import('next-auth');
  return getSession(authOptions);
}
