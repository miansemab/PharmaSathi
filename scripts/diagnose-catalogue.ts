import { prisma } from "../server/prisma.js";

async function main() {
  console.log("\n--- Catalogue status counts ---");

  const counts = await prisma.masterMedicine.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  console.table(counts.map((x) => ({
    status: x.status,
    total: x._count._all,
  })));

  console.log("\n--- Panadol records ---");

  const panadol = await prisma.masterMedicine.findMany({
    where: {
      brandName: { contains: "Panadol", mode: "insensitive" },
    },
    select: {
      brandName: true,
      genericName: true,
      strength: true,
      dosageForm: true,
      manufacturer: true,
      registrationNumber: true,
      status: true,
      isActive: true,
    },
    take: 25,
    orderBy: { brandName: "asc" },
  });

  console.table(panadol);

  console.log("\n--- Test manufacturer records ---");

  const testRecords = await prisma.masterMedicine.findMany({
    where: {
      manufacturer: { contains: "test3", mode: "insensitive" },
    },
    select: {
      brandName: true,
      manufacturer: true,
      registrationNumber: true,
      status: true,
      isActive: true,
    },
    take: 15,
  });

  console.table(testRecords);
}

main()
  .catch((error) => {
    console.error("Catalogue diagnostic failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
