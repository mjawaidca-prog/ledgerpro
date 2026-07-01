/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'pdf-parse'],
    serverExternalPackages: ['@prisma/client', 'pdf-parse'],
  },
};

module.exports = nextConfig;
