import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';
import { UserRole } from '@whatsapp-platform/common';

const prisma = new PrismaClient();

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required before seeding users`);
  }

  return value;
}

async function main() {
  const superadminEmail = requiredEnv('SUPERADMIN_EMAIL');
  const superadminPassword = requiredEnv('SUPERADMIN_PASSWORD');
  const adminEmail = requiredEnv('DEFAULT_ADMIN_EMAIL');
  const adminPassword = requiredEnv('DEFAULT_ADMIN_PASSWORD');

  const superadmin = await prisma.user.upsert({
    where: { email: superadminEmail },
    update: {
      role: UserRole.SUPERADMIN,
      isActive: true,
      name: 'Platform Owner',
    },
    create: {
      email: superadminEmail,
      passwordHash: hashSync(superadminPassword, 10),
      role: UserRole.SUPERADMIN,
      isActive: true,
      name: 'Platform Owner',
    },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: UserRole.ADMIN,
      isActive: true,
      name: 'Default Admin',
      parentAdminId: superadmin.id,
    },
    create: {
      email: adminEmail,
      passwordHash: hashSync(adminPassword, 10),
      role: UserRole.ADMIN,
      isActive: true,
      name: 'Default Admin',
      parentAdminId: superadmin.id,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
