import axios from 'axios';
import { HDNodeWallet, JsonRpcProvider, formatEther, parseEther, isAddress } from 'ethers';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { mnemonicToSeedSync } from 'bip39';
import { env } from '../config/env.js';
import { prisma } from '../db.js';
import { appError } from '../utils/formatters.js';

const bip32 = BIP32Factory(ecc);

const CHAIN_MAP = { BTC: 'btc/main', LTC: 'ltc/main', DOGE: 'doge/main' };

// BIP44 coin types — https://github.com/satoshilabs/slips/blob/master/slip-0044.md
const BIP44_COIN = { BTC: 0, LTC: 2, DOGE: 3 };

// Network params for bitcoinjs-lib (P2PKH addresses)
const BTC_NETWORKS = {
  BTC: bitcoin.networks.bitcoin,
  LTC: {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'ltc',
    bip32: { public: 0x019da462, private: 0x019d9cfe },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
  },
  DOGE: {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bech32: 'doge',
    bip32: { public: 0x02facafd, private: 0x02fac398 },
    pubKeyHash: 0x1e,
    scriptHash: 0x16,
    wif: 0x9e,
  },
};

// Smallest output each network relays — a commission output below this is dropped
// (100% goes to the main address) rather than producing a transaction nodes reject.
const DUST_SATS = { BTC: 546, LTC: 5460, DOGE: 1_000_000 };

const trimAmount = sats => (sats / 1e8).toFixed(8).replace(/\.?0+$/, '') || '0';

async function getHdMnemonic() {
  // Seed: DB setting takes priority over env var
  const dbSetting = await prisma.siteSetting.findUnique({ where: { key: 'btc_hd_seed' } });
  const mnemonic  = dbSetting?.value?.trim() || env.btcHdSeed;
  if (!mnemonic) throw appError('BTC/LTC/DOGE HD seed not configured. Set it in Admin → Settings → Crypto.', 500);
  return mnemonic;
}

// Every seed an address may come from: the setting and the env var can differ when one
// of them was changed after deposits were made.
async function seedCandidates() {
  const usable = v => { const t = String(v ?? '').trim(); return t && !t.startsWith('<') ? t : ''; };
  const row = await prisma.siteSetting.findUnique({ where: { key: 'btc_hd_seed' } });
  return [...new Set([usable(row?.value), usable(env.btcHdSeed)].filter(Boolean))];
}

// What each side is still owed on a deposit address (crypto). A customer may pay the same
// address again after a sweep: each sweep only takes what was not swept yet.
export const shopOwed    = d => Math.max(0, Number(d.netAmount) - Number(d.shopSweptAmount || 0));
export const reserveOwed = d => Math.max(0, Number(d.commissionAmount) - Number(d.reserveSweptAmount || 0));

export const cryptoService = {
  // The coins the admin has set up to receive payments (Admin → Settings → Crypto):
  // BTC / LTC / DOGE need the HD seed, ETH its seed, XMR its address. The bot's
  // checkout offers these and nothing else.
  async payableCoins() {
    const rows = await prisma.siteSetting.findMany({ where: { key: { in: ['btc_hd_seed', 'xmr_address'] } } });
    const set = v => { const t = String(v ?? '').trim(); return t && !t.startsWith('<') ? t : ''; };
    const val = k => set(rows.find(r => r.key === k)?.value);
    const coins = [];
    if (val('btc_hd_seed') || set(env.btcHdSeed)) coins.push('BTC', 'LTC', 'DOGE');
    // ETH payments are seen through the Alchemy webhook: without it nothing would be detected
    if (set(env.ethHdSeed) && set(env.alchemy.apiKey) && set(env.alchemy.webhookId) && set(env.alchemy.authToken)) coins.push('ETH');
    if (val('xmr_address') || set(env.xmrAddress)) coins.push('XMR');
    return coins;
  },

  async generateAddress(currency, depositId) {
    switch (currency) {
      case 'BTC':
      case 'LTC':
      case 'DOGE':
        return this._hdBitcoin(currency, depositId);
      case 'ETH':
        return this._alchemy(depositId);
      case 'XMR':
        return this._xmr();
      default:
        throw appError(`Unsupported currency: ${currency}`, 400);
    }
  },

  // Derive the key and P2PKH address of a deposit: m/44'/{coin}'/0'/0/{depositId}.
  // Single source of truth for address generation, sweep signing and verification.
  async deriveUtxoKey(currency, depositId, mnemonic) {
    const network = BTC_NETWORKS[currency];
    if (!network) throw appError(`Unsupported currency: ${currency}`, 400);

    const root  = bip32.fromSeed(mnemonicToSeedSync(mnemonic || await getHdMnemonic()), network);
    const child = root.derivePath(`m/44'/${BIP44_COIN[currency]}'/0'/0/${depositId}`);
    const { address } = bitcoin.payments.p2pkh({ pubkey: Buffer.from(child.publicKey), network });
    return { child, address, network };
  },

  // The signing key of a deposit address, from whichever seed actually produced it. Signing
  // with a key that does not match the address is what makes a node answer "Script was NOT
  // verified successfully": nothing is signed unless the derived address is the deposit's own.
  async depositKey(currency, dep) {
    const seeds = await seedCandidates();
    if (!seeds.length) throw appError('BTC/LTC/DOGE HD seed not configured. Set it in Admin → Settings → Crypto.', 500);
    for (const mnemonic of seeds) {
      const key = await this.deriveUtxoKey(currency, dep.id, mnemonic);
      if (key.address === dep.address) return key;
    }
    throw appError(`Deposit #${dep.id}: its address ${dep.address} does not come from the configured HD seed${seeds.length > 1 ? 's' : ''} at index ${dep.id}. It was created with another seed: put that seed back in Settings → Crypto (or BTC_HD_SEED) to move these funds.`, 409);
  },

  // Every payment a customer made to a deposit address: one entry per confirmed incoming
  // transaction, oldest first ({ hash, amount }), plus whether one is still unconfirmed.
  // The change our own sweeps and refunds send back to the address is not a payment: a
  // transaction that also spends from the address is ours, so it is left out.
  async incomingPayments(deposit) {
    const { currency, address } = deposit;
    if (CHAIN_MAP[currency]) {
      if (!env.blockcypherToken) throw appError('BLOCKCYPHER_TOKEN not configured', 500);
      const { data } = await axios.get(
        `https://api.blockcypher.com/v1/${CHAIN_MAP[currency]}/addrs/${address}?limit=2000&token=${env.blockcypherToken}`,
        { timeout: 15000 });
      const refs = data.txrefs || [];
      const ours = new Set(refs.filter(r => r.tx_input_n >= 0).map(r => r.tx_hash));
      const byTx = new Map();
      for (const r of refs) {
        if (r.tx_input_n !== -1 || ours.has(r.tx_hash)) continue;
        const cur = byTx.get(r.tx_hash) || { hash: r.tx_hash, sats: 0, height: r.block_height };
        cur.sats += r.value;
        byTx.set(r.tx_hash, cur);
      }
      const payments = [...byTx.values()].sort((a, b) => a.height - b.height).map(p => ({ hash: p.hash, amount: p.sats / 1e8 }));
      return { payments, pending: (data.unconfirmed_n_tx || 0) > 0 };
    }
    if (currency === 'ETH') {
      if (!env.alchemy.apiKey) throw appError('ALCHEMY_API_KEY not configured', 500);
      const { data } = await axios.post(`https://eth-mainnet.g.alchemy.com/v2/${env.alchemy.apiKey}`, {
        jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers',
        params: [{ fromBlock: '0x0', toAddress: address, category: ['external'], excludeZeroValue: true, withMetadata: false, maxCount: '0x3e8' }],
      }, { timeout: 15000 });
      if (data.error) throw appError(`Alchemy: ${data.error.message}`, 502);
      const payments = (data.result?.transfers || [])
        .filter(t => t.asset === 'ETH' && Number(t.value) > 0 && String(t.from).toLowerCase() !== address.toLowerCase())
        .sort((a, b) => parseInt(a.blockNum, 16) - parseInt(b.blockNum, 16))
        .map(t => ({ hash: t.hash, amount: Number(t.value) }));
      return { payments, pending: false };
    }
    return { payments: [], pending: false }; // XMR: one shared address, checked by hand
  },

  isValidUtxoAddress(currency, address) {
    try { bitcoin.address.toOutputScript(address, BTC_NETWORKS[currency]); return true; }
    catch { return false; }
  },

  // HD wallet address derivation — same pattern as ETH, no BlockCypher payment forward needed
  async _hdBitcoin(currency, depositId) {
    const { address } = await this.deriveUtxoKey(currency, depositId);

    // Register BlockCypher webhook only if PUBLIC_URL is set (optional — polling works without it)
    const hookId = env.publicUrl && env.blockcypherToken
      ? await this._registerAddressWebhook(CHAIN_MAP[currency], address)
      : null;

    return { address, hookId };
  },

  // Register a confirmed-tx webhook on a specific address
  async _registerAddressWebhook(chain, address) {
    try {
      const { data } = await axios.post(
        `https://api.blockcypher.com/v1/${chain}/hooks?token=${env.blockcypherToken}`,
        {
          event:         'confirmed-tx',
          address,
          url:           `${env.publicUrl}/api/webhooks/blockcypher`,
          confirmations: 1,
        }
      );
      return data.id || null;
    } catch (err) {
      // Non-fatal: the address is still valid — admin can confirm manually if webhook fails
      console.warn(`[BlockCypher] Failed to register webhook for ${address}:`, err.message);
      return null;
    }
  },

  async _alchemy(depositId) {
    if (!env.ethHdSeed) throw appError('ETH_HD_SEED not configured', 500);

    const wallet  = HDNodeWallet.fromPhrase(env.ethHdSeed, undefined, `m/44'/60'/0'/0/${depositId}`);
    const address = wallet.address;

    if (env.alchemy.webhookId && env.alchemy.authToken) {
      await axios.patch(
        'https://dashboard.alchemy.com/api/update-webhook-addresses',
        {
          webhook_id:          env.alchemy.webhookId,
          addresses_to_add:    [address],
          addresses_to_remove: [],
        },
        { headers: { 'X-Alchemy-Token': env.alchemy.authToken } },
      ).catch(err => console.warn('[Alchemy] Failed to update webhook:', err.message));
    }

    return { address, ethIndex: depositId };
  },

  async _xmr() {
    const setting = await prisma.siteSetting.findUnique({ where: { key: 'xmr_address' } });
    const address = setting?.value || env.xmrAddress;
    if (!address) throw appError('XMR address not configured (Admin → Settings → Crypto)', 500);
    return { address };
  },

  // Delete a BlockCypher address webhook (hookId stored on deposit)
  async deleteBlockcypherHook(hookId, currency) {
    const chain = CHAIN_MAP[currency];
    if (!chain || !hookId || !env.blockcypherToken) return;
    try {
      await axios.delete(
        `https://api.blockcypher.com/v1/${chain}/hooks/${hookId}?token=${env.blockcypherToken}`
      );
    } catch (err) {
      // Try as a legacy payment forward (backward compat with deposits created before this change)
      try {
        await axios.delete(
          `https://api.blockcypher.com/v1/${chain}/forwards/${hookId}?token=${env.blockcypherToken}`
        );
      } catch {
        console.warn(`[BlockCypher] Could not delete hook/forward ${hookId}:`, err.message);
      }
    }
  },

  // List all address webhooks registered on BlockCypher
  async _listHooks(chain) {
    if (!env.blockcypherToken) return [];
    try {
      const { data } = await axios.get(
        `https://api.blockcypher.com/v1/${chain}/hooks?token=${env.blockcypherToken}`
      );
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn(`[BlockCypher] Failed to list hooks for ${chain}:`, err.message);
      return [];
    }
  },

  // List all legacy payment forwards (for purge backward compat)
  async _listForwards(chain) {
    if (!env.blockcypherToken) return [];
    try {
      const { data } = await axios.get(
        `https://api.blockcypher.com/v1/${chain}/forwards?token=${env.blockcypherToken}`
      );
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn(`[BlockCypher] Failed to list forwards for ${chain}:`, err.message);
      return [];
    }
  },

  // Purge ALL webhooks and legacy forwards for BTC/LTC/DOGE on BlockCypher
  async purgeAllBlockcypherForwards(currencies = ['BTC', 'LTC', 'DOGE']) {
    const results = { deleted: 0, failed: 0 };

    for (const currency of currencies) {
      const chain = CHAIN_MAP[currency];
      if (!chain || !env.blockcypherToken) continue;

      // Delete address webhooks (new approach)
      for (const hook of await this._listHooks(chain)) {
        try {
          await axios.delete(
            `https://api.blockcypher.com/v1/${chain}/hooks/${hook.id}?token=${env.blockcypherToken}`
          );
          results.deleted++;
        } catch { results.failed++; }
      }

      // Delete legacy payment forwards (old approach)
      for (const fwd of await this._listForwards(chain)) {
        try {
          await axios.delete(
            `https://api.blockcypher.com/v1/${chain}/forwards/${fwd.id}?token=${env.blockcypherToken}`
          );
          results.deleted++;
        } catch { results.failed++; }
      }
    }

    return results;
  },

  // Poll blockchain directly to check if a deposit has been received
  async checkDepositOnChain(deposit) {
    if (['BTC', 'LTC', 'DOGE'].includes(deposit.currency)) {
      if (!env.blockcypherToken) throw appError('BLOCKCYPHER_TOKEN not configured', 500);
      const chain = CHAIN_MAP[deposit.currency];

      const { data } = await axios.get(
        `https://api.blockcypher.com/v1/${chain}/addrs/${deposit.address}?token=${env.blockcypherToken}`,
        { timeout: 8000 }
      );

      const totalReceivedSats = data.total_received || 0;
      const pendingSats       = data.unconfirmed_balance || 0;

      if (totalReceivedSats === 0) {
        return { confirmed: false, pending: pendingSats > 0, pendingSats };
      }

      // Credited in crypto, so no price is needed to confirm
      return { confirmed: true, cryptoAmount: totalReceivedSats / 1e8 };

    } else if (deposit.currency === 'ETH') {
      if (!env.alchemy.apiKey) throw appError('ALCHEMY_API_KEY not configured', 500);

      const provider   = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${env.alchemy.apiKey}`);
      const balance    = await provider.getBalance(deposit.address);
      const balanceEth = parseFloat(formatEther(balance));

      if (balanceEth <= 0.0001) return { confirmed: false, pending: false };

      return { confirmed: true, cryptoAmount: balanceEth };
    }

    return { confirmed: false, pending: false }; // XMR — manual only
  },

  // Two independent sweeps share the deposit addresses:
  //   'shop'    (admin)       — the customer-credited share (netAmount - shopSweptAmount)
  //   'reserve' (super admin) — the deposit commission (commissionAmount - reserveSweptAmount)
  // Each sweep sends only what is still owed to its side (minus its network fee) and returns
  // the other share to the deposit address as change, so their order doesn't matter.
  // opts.refresh(dep): credits payments made to the address since it was read (never sweep
  //   money the customer was not credited), returns the fresh deposit.
  // opts.budget: at most this much (coins) in all, oldest deposits first; the last one may be
  //   swept in part (the rest stays owed). null = everything owed.
  // Returns one result per deposit; the caller records what was swept.
  async sweepUtxoShare(kind, currency, destinationAddress, opts = {}) {
    const chain = CHAIN_MAP[currency];
    if (!chain) throw appError(`Unsupported currency: ${currency}`, 400);
    if (!env.blockcypherToken) throw appError('BLOCKCYPHER_TOKEN not configured', 500);
    if (!this.isValidUtxoAddress(currency, destinationAddress)) {
      throw appError(`Invalid ${currency} ${kind === 'shop' ? 'destination' : 'reserve'} address`, 400);
    }

    const network = BTC_NETWORKS[currency];
    const dust    = DUST_SATS[currency];
    const toSats  = n => Math.round(Number(n) * 1e8);
    let left = opts.budget != null ? toSats(opts.budget) : Infinity;

    const deposits = await prisma.deposit.findMany({
      where: kind === 'shop'
        ? { currency, status: 'confirmed', shopSweptAt: null }
        : { currency, status: 'confirmed', reserveSweptAt: null, commissionAmount: { gt: 0 } },
      orderBy: { id: 'asc' },
    });

    let feePerByte = { BTC: 10, LTC: 10, DOGE: 1000 }[currency]; // fallback sats/byte
    try {
      const { data: chainInfo } = await axios.get(
        `https://api.blockcypher.com/v1/${chain}?token=${env.blockcypherToken}`
      );
      feePerByte = Math.ceil((chainInfo.low_fee_per_kb || feePerByte * 1000) / 1000);
    } catch { /* use fallback */ }

    // P2PKH tx size: 10 (overhead) + inputs*148 + outputs*34
    const feeFor = (inputs, outputs) => feePerByte * (10 + inputs * 148 + outputs * 34);
    const snapshot = d => ({ netAmount: d.netAmount, commissionAmount: d.commissionAmount, amountReceived: d.amountReceived });

    const results = [];

    for (const listed of deposits) {
      if (left < dust) break;
      let dep = listed;
      try {
        if (opts.refresh) dep = await opts.refresh(listed);
        const { child, address } = await this.depositKey(currency, dep);

        const { data } = await axios.get(
          `https://api.blockcypher.com/v1/${chain}/addrs/${address}?unspentOnly=true&token=${env.blockcypherToken}`
        );
        const utxos = (data.txrefs || []).filter(u => !u.spent);
        const totalSats = utxos.reduce((sum, u) => sum + u.value, 0);
        if (totalSats === 0) {
          // Really empty (an older sweep emptied it): both sides settled. Otherwise our
          // previous transaction's change is not confirmed yet.
          const finalBalance = data.final_balance ?? data.balance ?? 0;
          results.push(finalBalance > 0
            ? { depositId: dep.id, address, status: 'skipped', reason: 'waiting for a previous transaction from this address to confirm: sweep again after it does' }
            : { depositId: dep.id, address, status: 'empty', settle: true, dep: snapshot(dep) });
          continue;
        }

        // What must stay on the address for the other side. A share below dust can't be a
        // change output, so it goes along and the other side is settled.
        const owedMine  = toSats(kind === 'shop' ? shopOwed(dep) : reserveOwed(dep));
        let keep = kind === 'shop'
          ? (dep.reserveSweptAt ? 0 : toSats(reserveOwed(dep)))
          : (dep.shopSweptAt ? 0 : Math.max(0, totalSats - toSats(reserveOwed(dep))));
        // A chosen amount smaller than what this deposit owes: take only that
        const partial = left < owedMine;
        if (partial) keep = Math.max(0, totalSats - left);
        let settlesOther = false;
        if (keep > 0 && keep < dust) { keep = 0; settlesOther = true; }

        const fee  = feeFor(utxos.length, keep > 0 ? 2 : 1);
        const send = totalSats - keep - fee;
        if (send < dust) {
          results.push({ depositId: dep.id, address, status: 'skipped', reason: `Share too small to cover the network fee (${fee} sats @ ${feePerByte} sat/byte)` });
          continue;
        }

        const psbt = new bitcoin.Psbt({ network });
        for (const utxo of utxos) {
          const { data: txData } = await axios.get(
            `https://api.blockcypher.com/v1/${chain}/txs/${utxo.tx_hash}?includeHex=true&token=${env.blockcypherToken}`
          );
          psbt.addInput({
            hash:           utxo.tx_hash,
            index:          utxo.tx_output_n,
            nonWitnessUtxo: Buffer.from(txData.hex, 'hex'),
          });
        }
        psbt.addOutput({ address: destinationAddress, value: send });
        if (keep > 0) psbt.addOutput({ address, value: keep }); // the other share, back to the deposit address

        for (let i = 0; i < utxos.length; i++) psbt.signInput(i, child);
        psbt.finalizeAllInputs();

        const txHex = psbt.extractTransaction().toHex();
        const { data: broadcast } = await axios.post(
          `https://api.blockcypher.com/v1/${chain}/txs/push?token=${env.blockcypherToken}`,
          { tx: txHex }
        );

        const taken = send + fee; // what left this side's share, fee included
        left -= taken;
        results.push({
          depositId: dep.id, address, status: 'swept', txHash: broadcast.tx?.hash,
          amount: trimAmount(send), fee: trimAmount(fee), taken: taken / 1e8,
          partial: partial && !settlesOther, settlesOther, commissionPct: Number(dep.commissionPct), dep: snapshot(dep),
        });
      } catch (err) {
        results.push({ depositId: dep.id, address: dep.address, status: 'error', reason: err.response?.data?.error || err.message });
      }
    }

    return results;
  },

  // ETH equivalent: one transfer of this sweep's share; the other share simply stays on the address.
  async sweepEthShare(kind, destinationAddress, opts = {}) {
    if (!env.ethHdSeed)      throw appError('ETH_HD_SEED not configured', 500);
    if (!env.alchemy.apiKey) throw appError('ALCHEMY_API_KEY not configured', 500);
    if (!isAddress(destinationAddress)) throw appError(`Invalid ETH ${kind === 'shop' ? 'destination' : 'reserve'} address`, 400);

    const provider = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${env.alchemy.apiKey}`);
    const deposits = await prisma.deposit.findMany({
      where: kind === 'shop'
        ? { currency: 'ETH', status: 'confirmed', shopSweptAt: null, ethIndex: { not: null } }
        : { currency: 'ETH', status: 'confirmed', reserveSweptAt: null, commissionAmount: { gt: 0 }, ethIndex: { not: null } },
      orderBy: { id: 'asc' },
    });
    if (deposits.length === 0) return [];

    const GAS_LIMIT = 21000n;
    const feeData   = await provider.getFeeData();
    const gasPrice  = feeData.gasPrice ?? feeData.maxFeePerGas;
    if (!gasPrice) throw appError('Could not fetch gas price from Alchemy', 500);
    const gasCost   = GAS_LIMIT * gasPrice;
    const toWei     = n => parseEther(Number(n).toFixed(8));
    let left = opts.budget != null ? toWei(opts.budget) : null;
    const snapshot = d => ({ netAmount: d.netAmount, commissionAmount: d.commissionAmount, amountReceived: d.amountReceived });

    const results = [];
    for (const listed of deposits) {
      if (left != null && left <= 0n) break;
      let dep = listed;
      try {
        if (opts.refresh) dep = await opts.refresh(listed);
        const wallet  = HDNodeWallet.fromPhrase(env.ethHdSeed, undefined, `m/44'/60'/0'/0/${dep.ethIndex}`).connect(provider);
        const balance = await provider.getBalance(wallet.address);
        if (balance === 0n) { results.push({ depositId: dep.id, address: wallet.address, status: 'empty', settle: true, dep: snapshot(dep) }); continue; }

        const owedReserve = toWei(reserveOwed(dep));
        let keep = kind === 'shop'
          ? (dep.reserveSweptAt ? 0n : owedReserve)
          : (dep.shopSweptAt ? 0n : (balance > owedReserve ? balance - owedReserve : 0n));
        const owedMine = toWei(kind === 'shop' ? shopOwed(dep) : reserveOwed(dep));
        const partial = left != null && left < owedMine;
        if (partial) keep = balance > left ? balance - left : 0n;
        const value = balance - keep - gasCost;
        if (value <= 0n) {
          results.push({ depositId: dep.id, address: wallet.address, status: 'skipped', reason: 'Share too small to cover gas' });
          continue;
        }

        const tx = await wallet.sendTransaction({ to: destinationAddress, value, gasLimit: GAS_LIMIT, gasPrice });
        const taken = value + gasCost;
        if (left != null) left -= taken;
        results.push({
          depositId: dep.id, address: wallet.address, status: 'swept', txHash: tx.hash,
          amount: formatEther(value), taken: Number(formatEther(taken)), partial, commissionPct: Number(dep.commissionPct), dep: snapshot(dep),
        });
      } catch (err) {
        results.push({ depositId: dep.id, address: dep.address, status: 'error', reason: err.shortMessage || err.message });
      }
    }
    return results;
  },

  // Sends `amount` (crypto) from a deposit's own address to `destination`, the network fee
  // taken off what is sent; whatever else is on the address stays there (the commission,
  // the rest of the deposit). BTC / LTC / DOGE / ETH only: XMR has no key here.
  // Returns { txHash, sent }.
  async refundFromDeposit(dep, amount, destination) {
    const qty = Number(amount);
    if (!(qty > 0)) throw appError('Nothing to refund', 400);
    if (dep.currency === 'ETH') {
      if (!env.ethHdSeed || !env.alchemy.apiKey) throw appError('ETH is not configured', 500);
      if (!isAddress(destination)) throw appError('Invalid ETH refund address', 400);
      if (dep.ethIndex == null) throw appError('This deposit has no ETH key index', 400);
      const provider = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${env.alchemy.apiKey}`);
      const wallet   = HDNodeWallet.fromPhrase(env.ethHdSeed, undefined, `m/44'/60'/0'/0/${dep.ethIndex}`).connect(provider);
      const feeData  = await provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
      if (!gasPrice) throw appError('Could not fetch gas price from Alchemy', 500);
      const gasCost  = 21000n * gasPrice;
      const want     = parseEther(qty.toFixed(8));
      const balance  = await provider.getBalance(wallet.address);
      if (balance < want) throw appError('The deposit address holds less than the amount to refund', 409);
      const value = want - gasCost;
      if (value <= 0n) throw appError('The amount is too small to cover the network fee', 409);
      const tx = await wallet.sendTransaction({ to: destination, value, gasLimit: 21000n, gasPrice });
      return { txHash: tx.hash, sent: formatEther(value) };
    }

    const currency = dep.currency;
    const chain = CHAIN_MAP[currency];
    if (!chain) throw appError(`${currency} refunds are sent by hand from the shop's wallet`, 400);
    if (!env.blockcypherToken) throw appError('BLOCKCYPHER_TOKEN not configured', 500);
    if (!this.isValidUtxoAddress(currency, destination)) throw appError(`Invalid ${currency} refund address`, 400);

    const network = BTC_NETWORKS[currency];
    const dust = DUST_SATS[currency];
    const { child, address } = await this.depositKey(currency, dep);

    let feePerByte = { BTC: 10, LTC: 10, DOGE: 1000 }[currency];
    try {
      const { data: info } = await axios.get(`https://api.blockcypher.com/v1/${chain}?token=${env.blockcypherToken}`);
      feePerByte = Math.ceil((info.low_fee_per_kb || feePerByte * 1000) / 1000);
    } catch { /* fallback */ }
    const feeFor = (inputs, outputs) => feePerByte * (10 + inputs * 148 + outputs * 34);

    const { data } = await axios.get(`https://api.blockcypher.com/v1/${chain}/addrs/${address}?unspentOnly=true&token=${env.blockcypherToken}`);
    const utxos = data.txrefs || [];
    const totalSats = utxos.reduce((sum, u) => sum + u.value, 0);
    const wantSats = Math.round(qty * 1e8);
    if (totalSats < wantSats) throw appError('The deposit address holds less than the amount to refund', 409);

    // The rest goes back to the deposit address, unless it is dust (then it goes with the refund)
    let change = totalSats - wantSats;
    let fee = feeFor(utxos.length, change >= dust ? 2 : 1);
    if (change < dust) change = 0;
    const send = (change ? wantSats : totalSats) - fee;
    if (send < dust) throw appError('The amount is too small to cover the network fee', 409);

    const psbt = new bitcoin.Psbt({ network });
    for (const utxo of utxos) {
      const { data: txData } = await axios.get(`https://api.blockcypher.com/v1/${chain}/txs/${utxo.tx_hash}?includeHex=true&token=${env.blockcypherToken}`);
      psbt.addInput({ hash: utxo.tx_hash, index: utxo.tx_output_n, nonWitnessUtxo: Buffer.from(txData.hex, 'hex') });
    }
    psbt.addOutput({ address: destination, value: send });
    if (change) psbt.addOutput({ address, value: change });
    for (let i = 0; i < utxos.length; i++) psbt.signInput(i, child);
    psbt.finalizeAllInputs();
    const { data: pushed } = await axios.post(`https://api.blockcypher.com/v1/${chain}/txs/push?token=${env.blockcypherToken}`, { tx: psbt.extractTransaction().toHex() });
    return { txHash: pushed.tx?.hash, sent: trimAmount(send) };
  },
};
