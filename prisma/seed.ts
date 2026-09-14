import { prisma, pool } from "./index";
async function main() {
  
}
main()
  .then(async () => {
    await prisma.$disconnect();
    await pool?.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool?.end();
    process.exit(1);
  });
