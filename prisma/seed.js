require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("Seed skipped. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in a secure environment before running.");
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: "Company Admin",
      email,
      passwordHash,
      role: "ADMIN",
      status: "APPROVED",
      businessName: "Vardhaman Trading Co"
    }
  });
  console.log("Admin account ensured. Change the password after first login.");
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
