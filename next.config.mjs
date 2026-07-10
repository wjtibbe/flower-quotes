/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "exceljs", "@prisma/client"],
  },
};

export default nextConfig;
