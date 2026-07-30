-- CreateEnum
CREATE TYPE "FarmOfferSource" AS ENUM ('AI_IMPORT', 'MANUAL');

-- AlterTable
ALTER TABLE "FarmOffer" ADD COLUMN     "source" "FarmOfferSource" NOT NULL DEFAULT 'AI_IMPORT';
