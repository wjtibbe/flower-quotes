import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/lib/seedData";

const prisma = new PrismaClient();

seedDatabase(prisma)
  .then((message) => console.log(message))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
