const DATABASE_NAME = 'token-killer-local-vault'
const DATABASE_VERSION = 2
const KEY_STORE = 'keys'
const ACCOUNT_STORE = 'accounts'
const SECRET_STORE = 'secrets'
const MASTER_KEY_ID = 'oauth-master-key'

function openVault() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(ACCOUNT_STORE)) {
        const accounts = database.createObjectStore(ACCOUNT_STORE, { keyPath: 'id' })
        accounts.createIndex('provider', 'provider', { unique: false })
        accounts.createIndex('identity', ['provider', 'identityKey'], { unique: true })
      }
      if (!database.objectStoreNames.contains(SECRET_STORE)) {
        database.createObjectStore(SECRET_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开凭据保险箱'))
  })
}

function transactionResult(transaction, request) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(request?.result)
    transaction.onerror = () => reject(transaction.error || request?.error || new Error('凭据保险箱操作失败'))
    transaction.onabort = () => reject(transaction.error || new Error('凭据保险箱操作已中止'))
  })
}

async function getMasterKey(database) {
  const readSavedKey = async () => {
    const transaction = database.transaction(KEY_STORE, 'readonly')
    const request = transaction.objectStore(KEY_STORE).get(MASTER_KEY_ID)
    return transactionResult(transaction, request)
  }
  const saved = await readSavedKey()
  if (saved?.key) return saved.key

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  try {
    const writeTransaction = database.transaction(KEY_STORE, 'readwrite')
    const writeRequest = writeTransaction.objectStore(KEY_STORE).add({ id: MASTER_KEY_ID, key })
    await transactionResult(writeTransaction, writeRequest)
    return key
  } catch {
    const winner = await readSavedKey()
    if (winner?.key) return winner.key
    throw new Error('无法创建凭据加密密钥')
  }
}

async function encryptCredential(database, credential) {
  const key = await getMasterKey(database)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(credential))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { iv, ciphertext }
}

async function decryptCredential(database, record) {
  try {
    const key = await getMasterKey(database)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
      key,
      record.ciphertext,
    )
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    throw new Error(`无法解密 ${record.displayName || '该账号'}；站点密钥可能已被清除`)
  }
}

function publicAccount(record) {
  return {
    id: record.id,
    provider: record.provider,
    identityKey: record.identityKey,
    displayName: record.displayName,
    planType: record.planType || '',
    expiresAt: Number(record.expiresAt || 0),
    createdAt: Number(record.createdAt || 0),
    updatedAt: Number(record.updatedAt || 0),
  }
}

export async function listLocalAccounts() {
  const database = await openVault()
  try {
    const transaction = database.transaction(ACCOUNT_STORE, 'readonly')
    const request = transaction.objectStore(ACCOUNT_STORE).getAll()
    const records = await transactionResult(transaction, request)
    return records
      .map(publicAccount)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  } finally {
    database.close()
  }
}

export async function getLocalAccount(id) {
  const database = await openVault()
  try {
    const transaction = database.transaction(ACCOUNT_STORE, 'readonly')
    const request = transaction.objectStore(ACCOUNT_STORE).get(id)
    const record = await transactionResult(transaction, request)
    if (!record) throw new Error('没有找到所选订阅账号')
    return { ...publicAccount(record), credential: await decryptCredential(database, record) }
  } finally {
    database.close()
  }
}

export async function saveLocalAccount(account) {
  if (!account?.provider || !account?.identityKey || !account?.credential) {
    throw new Error('订阅账号数据不完整')
  }
  const database = await openVault()
  try {
    const lookupTransaction = database.transaction(ACCOUNT_STORE, 'readonly')
    const lookupRequest = lookupTransaction.objectStore(ACCOUNT_STORE).index('identity').get([
      account.provider,
      account.identityKey,
    ])
    const existing = await transactionResult(lookupTransaction, lookupRequest)
    const now = Date.now()
    const encrypted = await encryptCredential(database, account.credential)
    const record = {
      id: existing?.id || account.id || crypto.randomUUID(),
      provider: account.provider,
      identityKey: account.identityKey,
      displayName: account.displayName || existing?.displayName || account.provider,
      planType: account.planType || existing?.planType || '',
      expiresAt: Number(account.credential.expiresAt || account.expiresAt || 0),
      createdAt: Number(existing?.createdAt || account.createdAt || now),
      updatedAt: now,
      ...encrypted,
    }
    const writeTransaction = database.transaction(ACCOUNT_STORE, 'readwrite')
    const writeRequest = writeTransaction.objectStore(ACCOUNT_STORE).put(record)
    await transactionResult(writeTransaction, writeRequest)
    return publicAccount(record)
  } finally {
    database.close()
  }
}

export async function deleteLocalAccount(id) {
  const database = await openVault()
  try {
    const transaction = database.transaction(ACCOUNT_STORE, 'readwrite')
    const request = transaction.objectStore(ACCOUNT_STORE).delete(id)
    await transactionResult(transaction, request)
  } finally {
    database.close()
  }
}

export async function getEncryptedSecret(id) {
  const database = await openVault()
  try {
    const transaction = database.transaction(SECRET_STORE, 'readonly')
    const request = transaction.objectStore(SECRET_STORE).get(id)
    const record = await transactionResult(transaction, request)
    if (!record) return ''
    const payload = await decryptCredential(database, { ...record, displayName: '已保存的凭据' })
    return typeof payload.value === 'string' ? payload.value : ''
  } finally {
    database.close()
  }
}

export async function saveEncryptedSecret(id, value) {
  const database = await openVault()
  try {
    const encrypted = await encryptCredential(database, { value: String(value || '') })
    const transaction = database.transaction(SECRET_STORE, 'readwrite')
    const request = transaction.objectStore(SECRET_STORE).put({ id, updatedAt: Date.now(), ...encrypted })
    await transactionResult(transaction, request)
  } finally {
    database.close()
  }
}

export async function deleteEncryptedSecret(id) {
  const database = await openVault()
  try {
    const transaction = database.transaction(SECRET_STORE, 'readwrite')
    const request = transaction.objectStore(SECRET_STORE).delete(id)
    await transactionResult(transaction, request)
  } finally {
    database.close()
  }
}

export function clearLocalVault() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error('无法清除凭据保险箱'))
    request.onblocked = () => reject(new Error('凭据正在被其他页面使用，请关闭其他 Token Killer 标签页后重试'))
  })
}
