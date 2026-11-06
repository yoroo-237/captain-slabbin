// A replica's cart/invoice in the original bot's own layout. The importer extracts a
// template from the captured cart/invoice screen; cartPay renders the real order into
// it. Always falls back to the shop's standard invoice when there is no usable
// template. The extracted template is a draft: it is stored on the style and the user
// refines it by hand in the editor.

const PRICE = /(?:[$€£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:USD|EUR|GBP))/i;
const TOTAL = /\b(total|montant|à\s*payer|to\s*pay|amount\s*due|grand\s*total)\b/i;
const SHIP = /\b(shipping|delivery|livraison|exp[ée]dition|postage)\b/i;
const hasPrice = l => PRICE.test(l);

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Replace {tokens}; a token with no value becomes '', then blank lines left behind are
// collapsed so dropped optional lines (no voucher, free shipping) leave no gap.
function fill(tpl, map) {
  return String(tpl)
    .replace(/\{(\w+)\}/g, (_, k) => (map[k] != null ? String(map[k]) : ''))
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// invoice: { template, item, sep?, voucher?, freeShipping? }
// ctx: { order, items:[{qty,name,option,price,lineTotal}], subtotal, shipping, voucherCode, discount, total, paid, wallet }
// money: the shop's price formatter (so amounts read exactly like the rest of the bot)
export function renderInvoice(invoice, ctx, money = v => `$${Number(v || 0).toFixed(2)}`) {
  if (!invoice?.template) return null;
  // The template and item pattern are the original's plain text: escape them for the
  // HTML parse_mode (a bare '&' or '<' in a 'Terms & Conditions' footer would otherwise
  // make Telegram reject the whole message). The substituted values are escaped too.
  const itemTpl = invoice.item || '{qty} × {name}  ·  {line_total}';
  const items = (ctx.items || []).map(i => fill(esc(itemTpl), {
    qty: i.qty, name: esc(i.name), option: esc(i.option || ''), price: money(i.price), line_total: money(i.lineTotal),
  })).join(invoice.sep || '\n');
  return fill(esc(invoice.template), {
    items,
    order: esc(ctx.order || ''),
    subtotal: money(ctx.subtotal || 0),
    shipping: Number(ctx.shipping) > 0 ? money(ctx.shipping) : (invoice.freeShipping || 'free'),
    voucher: ctx.voucherCode ? fill(esc(invoice.voucher || '🎟 {code}  −{amount}'), { code: esc(ctx.voucherCode), amount: money(ctx.discount || 0) }) : '',
    total: money(ctx.total || 0),
    paid: ctx.paid ? esc(ctx.paid) : '',
    wallet: ctx.wallet != null ? money(ctx.wallet) : '',
  });
}

// Builds a draft invoice template from the captured screens: the richest cart/invoice
// screen (a total line plus the most price-bearing lines). The item block becomes
// {items}, the amounts become {total}/{shipping}, everything else (header, footer,
// emojis, wording) is kept verbatim so the replica's invoice reads like the original.
// Returns { template, item, sep, draft:true } or null when nothing fits.
export function extractInvoiceTemplate(screens) {
  const best = (screens || [])
    .map(s => {
      const raw = String(s.raw || s.html || '');
      const lines = raw.split('\n');
      const totalIdx = lines.findIndex(l => TOTAL.test(l) && hasPrice(l));
      return { raw, lines, totalIdx, prices: lines.filter(hasPrice).length };
    })
    .filter(c => c.totalIdx > 0 && c.prices >= 2)
    .sort((a, b) => b.prices - a.prices)[0];
  if (!best) return null;

  const { lines, totalIdx } = best;
  const firstItem = lines.findIndex(hasPrice);
  if (firstItem < 0 || firstItem >= totalIdx) return null;
  const shipIdx = lines.findIndex((l, i) => i >= firstItem && i < totalIdx && SHIP.test(l));
  // The item block runs from the first priced line to the shipping line or the total
  const blockEnd = shipIdx > firstItem ? shipIdx : totalIdx;

  const header = lines.slice(0, firstItem).join('\n').trim();
  const footer = lines.slice(totalIdx + 1).join('\n').trim();
  const totalLine = lines[totalIdx].replace(PRICE, '{total}');
  const shipLine = shipIdx > 0 ? lines[shipIdx].replace(PRICE, '{shipping}') : '';

  // One cart line, with the product name — a generic default the user refines in the
  // editor (the original's exact per-item layout can't be read back reliably, since
  // name, options and prices are often spread over several lines)
  const item = '{qty} × {name}  ·  {line_total}';
  void blockEnd;

  // Header and footer are paragraphs (blank line between); the items/shipping/total
  // stay one block. Empty parts drop out without collapsing the paragraph spacing.
  const body = ['{items}', shipLine, totalLine].filter(Boolean).join('\n');
  const template = [header, body, footer].filter(Boolean).join('\n\n');

  // `source` keeps the original's exact invoice text so the editor can show it next to
  // the draft for the user to match by hand.
  return { template, item, sep: '\n', draft: true, source: best.raw.slice(0, 2000) };
}
