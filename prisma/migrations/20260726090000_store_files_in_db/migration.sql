-- Fix: uploads and generated exports were written to the local filesystem
-- (process.cwd()/storage/...), which crashes on Vercel because serverless
-- functions have no writable/durable disk outside their own request-scoped
-- /tmp. File bytes now live directly in Postgres instead. Additive only -
-- storagePath/filePath columns are kept (as labels), nothing dropped.

-- AlterTable
ALTER TABLE "SourceUpload" ADD COLUMN     "fileData" BYTEA;

-- AlterTable
ALTER TABLE "QuoteExport" ADD COLUMN     "fileData" BYTEA;
