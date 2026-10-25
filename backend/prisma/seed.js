import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

// Runs on every deploy (see .nixpacks.toml): settings and categories are upserted
// without overwriting admin edits, staff accounts are only created when missing,
// and demo products are only added to an empty catalog.

const prisma = new PrismaClient();

const SETTINGS = [
  ['site_name',               'Captain Slabbin'],
  ['site_password',           process.env.SITE_PASSWORD || 'CSC'],
  ['maintenance_mode',        'false'],
  ['registration_open',       'true'],
  ['shipping_cost',           '30'],
  ['shipping_free_threshold', '1000'],
  ['shipping_deadline_h',     '16'],
  ['shipping_deadline_m',     '0'],
  ['points_rate',             '0.5'],
  ['deposit_expiry_hours',    '12'],
  ['min_deposit',             '20'],
  ['max_deposit',             '25000'],
  ['btc_address',             ''],
  ['ltc_address',             ''],
  ['doge_address',            ''],
  ['eth_address',             ''],
  ['xmr_address',             ''],
  ['support_phone',           ''],
  ['signal_url',              ''],
  ['telegram_username',       ''],
  ['telegram_chat_id',        ''],
  ['promo_enabled',           'true'],
  ['promo_headline',          '$50 off per unit on every order placed through the website'],
  ['super_sweep_commission_pct', '10'],
];

// [slug, name, children]
const CATEGORIES = [
  ['flower',       'Flower'],
  ['concentrates', 'Concentrates'],
  ['moonrocks',    'Moonrocks'],
  ['disposables',  'Disposables', [['authentic-disposables', 'Authentic Disposables'], ['replica-disposables', 'Replica Disposables']]],
  ['prerolls',     'Prerolls'],
  ['edibles',      'Edibles'],
  ['mush',         'Mush'],
];

// Demo catalog — replace from Admin → Products. [sku, name, category, price, compareAt, unit, badge, stock]
const DEMO_PRODUCTS = [
  ['FL-101', 'Blue Gumbo',            'flower',                1150, null, 'per lb',      'Top Shelf', 12],
  ['FL-102', 'Cherry Zoda',           'flower',                 950, 1100, 'per lb',      null,        8],
  ['FL-103', 'White Truffle',         'flower',                 875, null, 'per lb',      'New',       20],
  ['FL-104', 'Lemon Cherry Gelato',   'flower',                1250, null, 'per lb',      'Exotic',    5],
  ['FL-105', 'Purple Candy Smalls',   'flower',                 550,  700, 'per lb',      null,        30],
  ['CO-201', 'Live Badder — A Tier',  'concentrates',           600, null, 'per oz',      null,        15],
  ['CO-202', 'Crumble — B Tier',      'concentrates',           380,  450, 'per oz',      null,        25],
  ['CO-203', 'Diamonds & Sauce',      'concentrates',           750, null, 'per oz',      'New',       10],
  ['MR-301', 'Classic Moonrocks',     'moonrocks',              900, null, 'per lb',      null,        14],
  ['MR-302', 'Blue Dream Moonrocks',  'moonrocks',             1050, 1200, 'per lb',      null,        6],
  ['DA-401', '2G Authentic Dual',     'authentic-disposables',   18, null, 'per unit',    null,        400],
  ['DA-402', '1G Live Resin Pod',     'authentic-disposables',   14,   16, 'per unit',    null,        250],
  ['DR-451', '2G Switch — Mixed',     'replica-disposables',      9, null, 'per unit',    'Best Value', 900],
  ['DR-452', '1G Classic Cart',       'replica-disposables',      6, null, 'per unit',    null,        1200],
  ['PR-501', 'Infused Prerolls 10pk', 'prerolls',                45, null, 'per 10 pack', null,        80],
  ['PR-502', 'Hash Holes',            'prerolls',                25,   30, 'per unit',    'New',       60],
  ['ED-601', 'Gummies 500mg',         'edibles',                 12, null, 'per bag',     null,        300],
  ['ED-602', 'Chocolate Bar 1000mg',  'edibles',                 18, null, 'per bar',     null,        150],
  ['MU-701', 'Golden Teacher (oz)',   'mush',                   120, null, 'per oz',      null,        40],
  ['MU-702', 'Penis Envy (oz)',       'mush',                   160,  190, 'per oz',      'Potent',    25],
];

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Staff accounts come from the environment; when no password is set a random
// one is generated and printed once — it is never written in the code.
// Staff accounts come from ADMIN_* / SUPERADMIN_* once: created on the first
// deploy, then left alone, so a username or password changed from the admin
// profile survives every redeploy (the seed runs on each build). Set
// RESET_STAFF_PASSWORDS=true for one deploy to get back in after a lost
// password: the environment's account is restored with its password.
async function ensureStaff(username, password, role) {
  const flag = `seeded_${role}`;
  const existing = await prisma.user.findUnique({ where: { username } });

  if (process.env.RESET_STAFF_PASSWORDS === 'true' && password) {
    const passwordHash = await bcrypt.hash(password, 12);
    if (existing) await prisma.user.update({ where: { username }, data: { passwordHash, role, isActive: true } });
    else await prisma.user.create({ data: { username, passwordHash, role } });
    console.log(`✅ ${role} "${username}" restored from the environment (RESET_STAFF_PASSWORDS) — remove that variable now`);
    return;
  }

  const done = await prisma.siteSetting.findUnique({ where: { key: flag } });
  if (existing || done) {
    if (!done) await prisma.siteSetting.create({ data: { key: flag, value: 'true' } });
    return; // already set up (and maybe renamed or given a new password since)
  }
  const pwd = password || crypto.randomBytes(9).toString('base64url');
  await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash(pwd, 12), role } });
  await prisma.siteSetting.create({ data: { key: flag, value: 'true' } });
  console.log(`✅ ${role} "${username}" created${password ? '' : ` — generated password: ${pwd} (change it after signing in)`}`);
}

async function main() {
  console.log('🌱 Seeding Captain Slabbin…');

  for (const [key, value] of SETTINGS) {
    await prisma.siteSetting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  console.log('✅ Settings');

  await ensureStaff(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD, 'admin');
  await ensureStaff(process.env.SUPERADMIN_USERNAME || 'superadmin', process.env.SUPERADMIN_PASSWORD, 'superadmin');

  for (const [i, [slug, name, children = []]] of CATEGORIES.entries()) {
    const parent = await prisma.category.upsert({ where: { slug }, update: {}, create: { slug, name, position: i } });
    for (const [j, [cslug, cname]] of children.entries()) {
      await prisma.category.upsert({ where: { slug: cslug }, update: {}, create: { slug: cslug, name: cname, parentId: parent.id, position: j } });
    }
  }
  console.log('✅ Categories');

  if (process.env.SEED_DEMO_PRODUCTS === 'false' || await prisma.product.count() > 0) {
    console.log('ℹ️  Catalog not empty (or SEED_DEMO_PRODUCTS=false) — demo products skipped');
    return;
  }
  for (const [sku, name, cat, price, compareAt, unitLabel, badge, stock] of DEMO_PRODUCTS) {
    const category = await prisma.category.findUnique({ where: { slug: cat } });
    await prisma.product.create({
      data: {
        sku, name, slug: slugify(`${name}-${sku}`), price, compareAtPrice: compareAt, unitLabel, badge, stock,
        isFeatured: !!badge, categoryId: category.id,
        description: `${name}. Lab-tested, packed fresh and shipped discreetly. Message us for bulk pricing.`,
      },
    });
  }
  console.log(`✅ ${DEMO_PRODUCTS.length} demo products`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
