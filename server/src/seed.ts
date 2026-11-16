/**
 * Development-only sample data. Goes through the real services, so every
 * business rule applies. Refuses to run in production.
 *
 *   bun run seed
 */
import { loadConfig } from './config';
import { buildContainer } from './container';
import { runMigrations } from './infrastructure/db/migrate';
import { DrizzleUserRepository } from './infrastructure/repositories/user-repositories';

const config = loadConfig();
if (config.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV is production.');
  process.exit(1);
}

const { services, database } = buildContainer(config);
await runMigrations(database);
await services.users.bootstrapAdmin(config.ADMIN_EMAIL, config.ADMIN_PASSWORD);

if ((await services.products.search({}, { page: 1, pageSize: 1 })).total > 0) {
  console.log('Products already exist; skipping seed.');
  await database.close();
  process.exit(0);
}

const adminUser = config.ADMIN_EMAIL ? await new DrizzleUserRepository(database.db).findByEmail(config.ADMIN_EMAIL) : null;
if (!adminUser) throw new Error('Admin user not found; set ADMIN_EMAIL and ADMIN_PASSWORD');

const staff = await services.users.create({
  email: 'staff@stockpilot.local',
  name: 'Sam Rivera',
  password: 'staff-password-123',
  role: 'STAFF',
});

const [fasteners, tools, electrical] = await Promise.all(
  ['Fasteners', 'Hand tools', 'Electrical'].map((name) => services.categories.create(name)),
);

type Seed = [sku: string, name: string, cents: number, categoryId: string, stock: number, policy: Parameters<typeof services.products.create>[0]['reorderPolicy']];
const catalog: Seed[] = [
  ['BOLT-M8-40', 'Hex bolt M8 × 40 mm', 18, fasteners!.id, 640, { kind: 'FIXED', reorderPoint: 200 }],
  ['NUT-M8', 'Hex nut M8', 6, fasteners!.id, 150, { kind: 'FIXED', reorderPoint: 200 }],
  ['WASH-M8', 'Flat washer M8', 3, fasteners!.id, 900, { kind: 'PERCENT_OF_MAX', maxStock: 2000, percent: 20 }],
  ['SCRW-WD-4X30', 'Wood screw 4 × 30 mm', 4, fasteners!.id, 1200, { kind: 'PERCENT_OF_MAX', maxStock: 5000, percent: 10 }],
  ['HAM-CLAW-16', 'Claw hammer 16 oz', 1899, tools!.id, 24, { kind: 'FIXED', reorderPoint: 10 }],
  ['SCRDRV-SET-6', 'Screwdriver set, 6 pieces', 2450, tools!.id, 8, { kind: 'FIXED', reorderPoint: 10 }],
  ['TAPE-5M', 'Tape measure 5 m', 899, tools!.id, 40, { kind: 'FIXED', reorderPoint: 12 }],
  ['CABLE-25-50M', 'Cable 2.5 mm², 50 m drum', 6400, electrical!.id, 12, { kind: 'FIXED', reorderPoint: 4 }],
  ['SOCKET-DBL', 'Double wall socket', 749, electrical!.id, 3, { kind: 'FIXED', reorderPoint: 6 }],
  ['LED-GU10-5W', 'LED bulb GU10 5 W', 349, electrical!.id, 260, { kind: 'PERCENT_OF_MAX', maxStock: 400, percent: 25 }],
];

const ids: string[] = [];
for (const [sku, name, unitPriceCents, categoryId, stock, reorderPolicy] of catalog) {
  const product = await services.products.create({ sku, name, unitPriceCents, categoryId, reorderPolicy });
  ids.push(product.id);
  await services.stock.receive(product.id, stock, 'Opening stock', adminUser.id);
}

// A few orders in different states.
const o1 = await services.orders.place({ lines: [{ productId: ids[0]!, quantity: 120 }, { productId: ids[1]!, quantity: 40 }] }, staff.id);
await services.orders.fulfil(o1.id, staff.id);
await services.orders.place({ lines: [{ productId: ids[4]!, quantity: 6 }, { productId: ids[6]!, quantity: 30 }] }, staff.id);
const o3 = await services.orders.place({ lines: [{ productId: ids[7]!, quantity: 2 }] }, staff.id);
await services.orders.cancel(o3.id);
await services.stock.adjust(ids[9]!, -12, 'Damaged in delivery', adminUser.id);

console.log('Seeded sample data. Staff login: staff@stockpilot.local / staff-password-123');
await database.close();
