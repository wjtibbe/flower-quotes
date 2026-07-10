-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Origin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Destination"("id") ON DELETE SET NULL ON UPDATE CASCADE;
