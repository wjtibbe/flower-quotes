/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "exceljs", "@prisma/client"],
    // Next's default Server Action body limit is 1mb, too small for a typical
    // phone screenshot/photo. Raised to fit the image-vision import flow
    // (uploadFarmOffer) - see MAX_IMAGE_BYTES in src/lib/import/provider.ts,
    // which stays below this so a too-large image still gets a clear,
    // specific error instead of an opaque platform-level rejection.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
