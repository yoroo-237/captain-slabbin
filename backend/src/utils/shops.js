// The shops the admin keeps apart: the website (source null: its products,
// shelves, orders) and each bot catalog (a `source` such as 'qt', sold by the
// bots whose style names it). ?shop=site | <source> | all (or nothing) = every shop.
const sourceOf = shop => (shop === 'site' ? null : String(shop).toLowerCase().replace(/[^a-z0-9]/g, '') || null);
const all = shop => !shop || shop === 'all';

// Products, categories, vouchers: their own `source`
export const shopWhere = shop => (all(shop) ? {} : { source: sourceOf(shop) });

// Orders: the shop of the products they hold
export const orderShopWhere = shop => (all(shop) ? {} : { items: { some: { product: { source: sourceOf(shop) } } } });

// The source a new record gets from the shop being viewed ('site' or none = the website)
export const newSource = shop => (all(shop) ? null : sourceOf(shop));
