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

export const cryptoService = {
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
  //   'shop'    (admin)       — the customer-credited share (Deposit.netAmount)
  //   'reserve' (super admin) — the deposit commission (Deposit.commissionAmount)
  // Each sweep sends only its own share (minus its network fee) and returns the
  // other share to the deposit address as change, so their order doesn't matter.
  // Returns one result per eligible deposit; the caller records what was swept.
  async sweepUtxoShare(kind, currency, destinationAddress) {
    const chain = CHAIN_MAP[currency];
    if (!chain) throw appError(`Unsupported currency: ${currency}`, 400);
    if (!env.blockcypherToken) throw appError('BLOCKCYPHER_TOKEN not configured', 500);
    if (!this.isValidUtxoAddress(currency, destinationAddress)) {
      throw appError(`Invalid ${currency} ${kind === 'shop' ? 'destination' : 'reserve'} address`, 400);
    }

    const network  = BTC_NETWORKS[currency];
    const dust     = DUST_SATS[currency];
    const mnemonic = await getHdMnemonic();

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
    const toSats = n => Math.round(Number(n) * 1e8);

    const results = [];

    for (const dep of deposits) {
      const { child, address } = await this.deriveUtxoKey(currency, dep.id, mnemonic);

      let utxos = [];
      try {
        const { data } = await axios.get(
          `https://api.blockcypher.com/v1/${chain}/addrs/${address}?unspentOnly=true&token=${env.blockcypherToken}`
        );
        utxos = data.txrefs || [];
      } catch (err) {
        results.push({ depositId: dep.id, address, status: 'error', reason: 'UTXO fetch failed: ' + err.message });
        continue;
      }

      const totalSats = utxos.reduce((sum, u) => sum + u.value, 0);
      if (totalSats === 0) {
        // Deposits credited before commissions existed and already emptied get settled
        // so they stop being queried on every sweep.
        results.push({ depositId: dep.id, address, status: 'empty', settle: kind === 'shop' && toSats(dep.commissionAmount) === 0 });
        continue;
      }

      // What must stay on the address for the other sweep. A share below dust
      // can't be a change output, so it goes along and the other side is settled.
      const commission = toSats(dep.commissionAmount);
      let keep = kind === 'shop'
        ? (dep.reserveSweptAt ? 0 : commission)
        : (dep.shopSweptAt ? 0 : Math.max(0, totalSats - commission));
      let settlesOther = false;
      if (keep > 0 && keep < dust) { keep = 0; settlesOther = true; }

      const fee  = feeFor(utxos.length, keep > 0 ? 2 : 1);
      const send = totalSats - keep - fee;
      if (send < dust) {
        results.push({ depositId: dep.id, address, status: 'skipped', reason: `Share too small to cover the network fee (${fee} sats @ ${feePerByte} sat/byte)` });
        continue;
      }

      try {
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

        results.push({
          depositId: dep.id, address, status: 'swept', txHash: broadcast.tx?.hash,
          amount: trimAmount(send), fee: trimAmount(fee), settlesOther, commissionPct: Number(dep.commissionPct),
        });
      } catch (err) {
        results.push({ depositId: dep.id, address, status: 'error', reason: err.response?.data?.error || err.message });
      }
    }

    return results;
  },

  // ETH equivalent: one transfer of this sweep's share; the other share simply
  // stays on the address.
  async sweepEthShare(kind, destinationAddress) {
    if (!env.ethHdSeed)      throw appError('ETH_HD_SEED not configured', 500);
    if (!env.alchemy.apiKey) throw appError('ALCHEMY_API_KEY not configured', 500);
    if (!isAddress(destinationAddress)) throw appError(`Invalid ETH ${kind === 'shop' ? 'destination' : 'reserve'} address`, 400);

    const provider = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${env.alchemy.apiKey}`);
    const deposits = await prisma.deposit.findMany({
      where: kind === 'shop'
        ? { currency: 'ETH', status: 'confirmed', shopSweptAt: null, ethIndex: { not: null } }
        : { currency: 'ETH', status: 'confirmed', reserveSweptAt: null, commissionAmount: { gt: 0 }, ethIndex: { not: null } },
    });
    if (deposits.length === 0) return [];

    const GAS_LIMIT = 21000n;
    const feeData   = await provider.getFeeData();
    const gasPrice  = feeData.gasPrice ?? feeData.maxFeePerGas;
    if (!gasPrice) throw appError('Could not fetch gas price from Alchemy', 500);
    const gasCost   = GAS_LIMIT * gasPrice;
    const toWei     = n => parseEther(Number(n).toFixed(8));

    const results = [];
    for (const dep of deposits) {
      const wallet  = HDNodeWallet.fromPhrase(env.ethHdSeed, undefined, `m/44'/60'/0'/0/${dep.ethIndex}`).connect(provider);
      const balance = await provider.getBalance(wallet.address);
      if (balance === 0n) { results.push({ depositId: dep.id, address: wallet.address, status: 'empty' }); continue; }

      const commission = toWei(dep.commissionAmount);
      const keep = kind === 'shop'
        ? (dep.reserveSweptAt ? 0n : commission)
        : (dep.shopSweptAt ? 0n : (balance > commission ? balance - commission : 0n));
      const value = balance - keep - gasCost;
      if (value <= 0n) {
        results.push({ depositId: dep.id, address: wallet.address, status: 'skipped', reason: 'Share too small to cover gas' });
        continue;
      }

      try {
        const tx = await wallet.sendTransaction({ to: destinationAddress, value, gasLimit: GAS_LIMIT, gasPrice });
        results.push({
          depositId: dep.id, address: wallet.address, status: 'swept', txHash: tx.hash,
          amount: formatEther(value), commissionPct: Number(dep.commissionPct),
        });
      } catch (err) {
        results.push({ depositId: dep.id, address: wallet.address, status: 'error', reason: err.shortMessage || err.message });
      }
    }
    return results;
  },
};
