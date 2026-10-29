// PGP in the browser, loaded only when needed (openpgp is large). The address is
// encrypted on the customer's device: the server only ever receives the message.

const lib = () => import('openpgp')

// "ABCD 1234 …", or null when the text is not a usable public key
export async function fingerprint(armored) {
  if (!armored?.trim()) return null
  try {
    const { readKey } = await lib()
    const key = await readKey({ armoredKey: armored.trim() })
    return key.isPrivate() ? null : key.getFingerprint().toUpperCase().match(/.{1,4}/g).join(' ')
  } catch { return null }
}

// A new key pair, made on this device. The private key comes back locked with the
// passphrase: it is only ever saved as a file by the admin, never sent anywhere.
export async function generateKeyPair(name, passphrase) {
  const { generateKey } = await lib()
  const { publicKey, privateKey } = await generateKey({ type: 'ecc', curve: 'curve25519', userIDs: [{ name }], passphrase, format: 'armored' })
  return { publicKey: publicKey.trim(), privateKey }
}

// An address encrypted to the shop's key, read with the private key file and its passphrase
export async function decryptWith(armoredPrivate, passphrase, armoredMessage) {
  const { readPrivateKey, decryptKey, readMessage, decrypt } = await lib()
  let key = await readPrivateKey({ armoredKey: armoredPrivate.trim() })
  if (!key.isDecrypted()) key = await decryptKey({ privateKey: key, passphrase })
  const { data } = await decrypt({ message: await readMessage({ armoredMessage }), decryptionKeys: key })
  return data
}

export async function encryptTo(armored, text) {
  const { readKey, createMessage, encrypt } = await lib()
  const encryptionKeys = await readKey({ armoredKey: armored.trim() })
  return encrypt({ message: await createMessage({ text }), encryptionKeys })
}
