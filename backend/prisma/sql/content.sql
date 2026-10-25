-- Captain Slabbin: starter content (FAQ, brands, news, giveaways).
-- Paste into Railway → Postgres → Data → Query, then run. Safe to run twice:
-- rows that already exist (same question, slug or title) are left alone.

BEGIN;

-- ── FAQ ─────────────────────────────────────────────────────────────────────
INSERT INTO "FAQ" (question, answer, category, position, "isActive")
SELECT v.question, v.answer, v.category, v.position, true
FROM (VALUES
  ('How do I pay?',
   'With crypto from your wallet on the site: BTC, LTC, ETH, DOGE or XMR. Add funds once, then every order is paid in one tap. The price is converted and locked the moment you order.',
   'Payment', 1),
  ('How long does a deposit take to show up?',
   'BTC, LTC, DOGE and ETH are credited automatically once the network confirms them, usually 10 to 30 minutes. XMR deposits are checked by hand and credited within a few hours.',
   'Payment', 2),
  ('Is there a minimum deposit?',
   'Deposits start at $20. Each deposit address is valid for 12 hours: send the exact amount shown, from one transaction.',
   'Payment', 3),
  ('What do you need to know about me?',
   'A username and a password, nothing else. Your Telegram is optional and only used so the shop can reach you about an order. No email, no phone number, no ID.',
   'Account', 4),
  ('Where does my invoice go?',
   'As soon as you pay, the invoice is sent to the shop on Telegram. You can also open it in your own Telegram from the confirmation page.',
   'Ordering', 5),
  ('How does delivery work?',
   'At checkout choose "Ship it to me" and enter a US address: it ships in plain, unmarked, vacuum-sealed packaging with tracking. Or choose no delivery and arrange pickup with the crew on Telegram.',
   'Shipping', 6),
  ('How much is shipping and when does it leave?',
   'Shipping is $30 and free on orders over $1,000. Orders paid before 4 PM ship the same day, Monday to Friday. Your tracking number shows up in your account.',
   'Shipping', 7),
  ('Do you ship to every state?',
   'We ship anywhere in the continental US. Message us first for Alaska, Hawaii and PO boxes.',
   'Shipping', 8),
  ('What if something is wrong with my order?',
   'Message the shop from the Messages tab within 48 hours of delivery with a photo. Refunds go back to your wallet, or to the BTC or XMR address saved in your profile.',
   'Ordering', 9),
  ('How do I follow my order?',
   'Your orders, their status and tracking numbers are in your account. You can message the shop at any time from the Messages tab.',
   'Ordering', 10),
  ('Do I have to be 21?',
   'Yes. Everything on this site is for adults 21 and over. By entering the shop you confirm you are.',
   'Account', 11)
) AS v(question, answer, category, position)
WHERE NOT EXISTS (SELECT 1 FROM "FAQ" f WHERE f.question = v.question);

-- ── Brands (house labels) ───────────────────────────────────────────────────
INSERT INTO "Brand" (name, slug) VALUES
  ('Jolly Roger Farms',   'jolly-roger-farms'),
  ('Black Flag Extracts', 'black-flag-extracts'),
  ('Moonshot Rocks',      'moonshot-rocks'),
  ('Deadeye Carts',       'deadeye-carts'),
  ('Powder Keg Rolls',    'powder-keg-rolls'),
  ('Galleon Treats',      'galleon-treats'),
  ('Spore Island',        'spore-island')
ON CONFLICT (slug) DO NOTHING;

-- Attach the demo products (by SKU) to a brand, only where none is set yet
UPDATE "Product" p SET "brandId" = b.id
FROM (VALUES
  ('FL-', 'jolly-roger-farms'),
  ('CO-', 'black-flag-extracts'),
  ('MR-', 'moonshot-rocks'),
  ('DA-', 'deadeye-carts'),
  ('DR-', 'deadeye-carts'),
  ('PR-', 'powder-keg-rolls'),
  ('ED-', 'galleon-treats'),
  ('MU-', 'spore-island')
) AS m(prefix, slug)
JOIN "Brand" b ON b.slug = m.slug
WHERE p.sku LIKE m.prefix || '%' AND p."brandId" IS NULL;

-- ── News ────────────────────────────────────────────────────────────────────
INSERT INTO "NewsArticle" (title, slug, content, "imageUrl", "isPublished", "publishedAt", "updatedAt") VALUES
  ('Captain Slabbin is open',
   'captain-slabbin-is-open',
   'The shop is live. Create an account with just a username, add funds in BTC, LTC, ETH, DOGE or XMR, and order in one tap. Every paid invoice goes straight to the crew on Telegram, and tracked shipping covers the whole continental US.',
   NULL, true, NOW() - INTERVAL '6 days', NOW()),
  ('Fresh drop: White Truffle and Diamonds & Sauce',
   'fresh-drop-white-truffle-diamonds-sauce',
   'Two new arrivals on the shelves this week: White Truffle flower from Jolly Roger Farms and Diamonds & Sauce from Black Flag Extracts. Both are limited, so grab them while they last.',
   NULL, true, NOW() - INTERVAL '3 days', NOW()),
  ('Free shipping over $1,000',
   'free-shipping-over-1000',
   'Orders over $1,000 now ship free. Pay before 4 PM on a weekday and your package leaves the same day, in plain, vacuum-sealed packaging with tracking.',
   NULL, true, NOW() - INTERVAL '1 day', NOW())
ON CONFLICT (slug) DO NOTHING;

-- ── Giveaways ───────────────────────────────────────────────────────────────
INSERT INTO "Giveaway" (title, description, prize, "imageUrl", status, "endsAt", "updatedAt")
SELECT v.title, v.description, v.prize, NULL, v.status, v.ends_at, NOW()
FROM (VALUES
  ('Opening week giveaway',
   'Place any order during opening week and you are automatically entered. One winner is drawn at random and announced on Telegram.',
   '1 lb of Blue Gumbo', 'active', NOW() + INTERVAL '7 days'),
  ('Review and win',
   'Leave a review on a product you bought this month. Every approved review is one entry. Three winners get store credit added to their wallet.',
   '$100 wallet credit x3', 'active', NOW() + INTERVAL '30 days'),
  ('Holiday stash',
   'Coming in December: spend $500 or more in a single order to enter. Details on Telegram closer to the date.',
   'Holiday box: flower, concentrates and edibles', 'draft', NULL::timestamp)
) AS v(title, description, prize, status, ends_at)
WHERE NOT EXISTS (SELECT 1 FROM "Giveaway" g WHERE g.title = v.title);

COMMIT;

-- Check
SELECT 'faq' AS what, COUNT(*) FROM "FAQ"
UNION ALL SELECT 'brands', COUNT(*) FROM "Brand"
UNION ALL SELECT 'products with brand', COUNT(*) FROM "Product" WHERE "brandId" IS NOT NULL
UNION ALL SELECT 'news', COUNT(*) FROM "NewsArticle"
UNION ALL SELECT 'giveaways', COUNT(*) FROM "Giveaway";
