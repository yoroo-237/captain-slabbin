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

export async function encryptTo(armored, text) {
  const { readKey, createMessage, encrypt } = await lib()
  const encryptionKeys = await readKey({ armoredKey: armored.trim() })
  return encrypt({ message: await createMessage({ text }), encryptionKeys })
}
