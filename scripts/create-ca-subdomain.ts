#!/usr/bin/env npx tsx
/**
 * Create `ca.attestto.sol` subdomain under `attestto.sol`
 *
 * Uses the same pattern as Cortex user subdomains:
 * - Mint Authority hot wallet owns attestto.sol and creates subdomains
 * - Subdomain stays in hot wallet (SNS domains can't transfer to Squads PDA)
 * - Protected by class key co-signer (transfer/delete requires both signatures)
 *
 * Architecture (from Cortex vault admin):
 *   Mint Authority (hot wallet) → owns attestto.sol, creates subdomains, holds in custody
 *   Squads Vault → funds only (SOL/USDC), cannot hold SNS domains (PDA limitation)
 *   Class Key → co-signer for domain protection (transfer/delete requires both sigs)
 *
 * Usage:
 *   # Dry run (default — prints what it would do)
 *   npx tsx scripts/create-ca-subdomain.ts
 *
 *   # Execute on devnet
 *   SOLANA_NETWORK=devnet npx tsx scripts/create-ca-subdomain.ts --execute
 *
 *   # Execute on mainnet (careful!)
 *   SOLANA_NETWORK=mainnet-beta npx tsx scripts/create-ca-subdomain.ts --execute
 *
 * Environment (reads from Cortex .env or set manually):
 *   SOLANA_MINT_AUTHORITY_SECRET — hot wallet keypair (owns attestto.sol, creates subdomains)
 *   SNS_CLASS_KEY — class key for domain protection co-signing (optional)
 *   SOLANA_NETWORK — devnet | mainnet-beta (default: devnet)
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// ── SNS Constants ──
const SNS_PROGRAM_ID = new PublicKey('namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX')
const SOL_TLD_PARENT = new PublicKey('58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx')
const HASH_PREFIX = 'SPL Name Service'
const NAME_RECORD_HEADER_SIZE = 96

// ── Config ──
const PARENT_DOMAIN = 'attestto'
const SUBDOMAIN = 'ca'
const NETWORK = process.env.SOLANA_NETWORK || 'devnet'
const EXECUTE = process.argv.includes('--execute')

function getRpcUrl(): string {
  if (NETWORK === 'mainnet-beta') return 'https://api.mainnet-beta.solana.com'
  return 'https://api.devnet.solana.com'
}

function hashName(name: string): Buffer {
  return createHash('sha256')
    .update(HASH_PREFIX + name, 'utf8')
    .digest()
}

function deriveDomainKey(name: string, parent?: PublicKey, nameClass?: PublicKey): PublicKey {
  const seeds: Buffer[] = [hashName(name)]
  seeds.push((parent ?? SOL_TLD_PARENT).toBuffer())
  seeds.push((nameClass ?? PublicKey.default).toBuffer())
  const [key] = PublicKey.findProgramAddressSync(seeds, SNS_PROGRAM_ID)
  return key
}

function loadKeypair(path: string): Keypair {
  const raw = readFileSync(path, 'utf-8')
  const arr = JSON.parse(raw)
  return Keypair.fromSecretKey(Uint8Array.from(arr))
}

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  Create ca.attestto.sol subdomain')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Network:    ${NETWORK}`)
  console.log(`  Parent:     ${PARENT_DOMAIN}.sol`)
  console.log(`  Subdomain:  ${SUBDOMAIN}.${PARENT_DOMAIN}.sol`)
  console.log(`  Mode:       ${EXECUTE ? '🔴 EXECUTE' : '🟡 DRY RUN'}`)
  console.log('')

  // Derive keys
  const parentKey = deriveDomainKey(PARENT_DOMAIN)
  const subdomainKey = deriveDomainKey(SUBDOMAIN, parentKey)

  console.log(`  Parent PDA:     ${parentKey.toBase58()}`)
  console.log(`  Subdomain PDA:  ${subdomainKey.toBase58()}`)
  console.log(`  did:sns:ca.attestto → ${subdomainKey.toBase58()}`)
  console.log('')

  if (!EXECUTE) {
    console.log('  ℹ️  Dry run complete. Add --execute to create the subdomain.')
    console.log('  ⚠️  Set SOLANA_MINT_AUTHORITY_SECRET (the hot wallet that owns attestto.sol)')
    return
  }

  // Load mint authority (hot wallet that owns attestto.sol)
  const mintSecret = process.env.SOLANA_MINT_AUTHORITY_SECRET || process.env.WALLET_KEY
  if (!mintSecret) {
    console.error('  ❌ SOLANA_MINT_AUTHORITY_SECRET not set.')
    console.error('     This is the hot wallet that owns attestto.sol and creates subdomains.')
    console.error('     Set it as a JSON array [1,2,3,...] or path to keypair file.')
    process.exit(1)
  }

  // Support both inline secret and file path
  let wallet: Keypair
  if (mintSecret.trim().startsWith('[')) {
    wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(mintSecret)))
  } else if (mintSecret.trim().startsWith('/') || mintSecret.trim().startsWith('~')) {
    wallet = loadKeypair(mintSecret.replace('~', process.env.HOME || ''))
  } else {
    wallet = Keypair.fromSecretKey(Buffer.from(mintSecret, 'base64'))
  }

  // Subdomain owner = same hot wallet (SNS domains can't go to Squads PDA)
  const ownerPubkey = wallet.publicKey

  // Optional: class key for domain protection
  const classKeySecret = process.env.SNS_CLASS_KEY
  let classKeypair: Keypair | null = null
  if (classKeySecret) {
    try {
      if (classKeySecret.trim().startsWith('[')) {
        classKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(classKeySecret)))
      } else {
        classKeypair = Keypair.fromSecretKey(Buffer.from(classKeySecret, 'base64'))
      }
      console.log(`  Class Key:  ${classKeypair.publicKey.toBase58()} (domain protection enabled)`)
    } catch { console.log('  Class Key:  ⚠️ Failed to load, creating without protection') }
  } else {
    console.log('  Class Key:  not set (no domain protection)')
  }

  console.log(`  Authority:  ${wallet.publicKey.toBase58()} (mint authority / parent owner)`)
  console.log(`  Owner:      ${ownerPubkey.toBase58()} (same hot wallet)`)
  console.log('')

  const connection = new Connection(getRpcUrl(), 'confirmed')

  // Check if subdomain already exists
  const existing = await connection.getAccountInfo(subdomainKey)
  if (existing) {
    console.log('  ✅ Subdomain already exists!')
    console.log(`  Account:  ${subdomainKey.toBase58()}`)
    console.log(`  Size:     ${existing.data.length} bytes`)
    return
  }

  // Calculate rent
  const rentExempt = await connection.getMinimumBalanceForRentExemption(NAME_RECORD_HEADER_SIZE)
  console.log(`  Rent:       ${rentExempt / 1e9} SOL`)

  // Build the Create Name instruction
  // SPL Name Service Create instruction layout:
  // [0] u8 instruction (0 = Create)
  // [1..5] u32 hashed_name.len
  // [5..5+len] hashed_name bytes
  // [5+len..5+len+8] u64 lamports
  // [5+len+8..5+len+12] u32 space
  const hashedName = hashName(SUBDOMAIN)
  const nameLen = hashedName.length

  const data = Buffer.alloc(1 + 4 + nameLen + 8 + 4)
  let offset = 0
  data.writeUInt8(0, offset); offset += 1 // instruction = Create
  data.writeUInt32LE(nameLen, offset); offset += 4
  hashedName.copy(data, offset); offset += nameLen
  // lamports as u64 LE
  const lamportsBuf = Buffer.alloc(8)
  lamportsBuf.writeBigUInt64LE(BigInt(rentExempt))
  lamportsBuf.copy(data, offset); offset += 8
  // space as u32 LE
  data.writeUInt32LE(0, offset)

  const nameClass = classKeypair?.publicKey ?? PublicKey.default

  const keys = [
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },    // payer
    { pubkey: subdomainKey, isSigner: false, isWritable: true },        // name account
    { pubkey: ownerPubkey, isSigner: false, isWritable: false },        // owner
    { pubkey: nameClass, isSigner: classKeypair ? true : false, isWritable: false }, // class key
    // parent name
    { pubkey: parentKey, isSigner: false, isWritable: false },
    // parent name owner (must sign)
    { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
  ]

  const ix = new (await import('@solana/web3.js')).TransactionInstruction({
    programId: SNS_PROGRAM_ID,
    keys,
    data,
  })

  const tx = new Transaction().add(ix)
  tx.feePayer = wallet.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash

  const signers: Keypair[] = [wallet]
  if (classKeypair) signers.push(classKeypair)
  tx.sign(...signers)

  console.log('  📡 Sending transaction...')
  const sig = await connection.sendRawTransaction(tx.serialize())
  console.log(`  ⏳ Confirming: ${sig}`)
  await connection.confirmTransaction(sig, 'confirmed')

  console.log('')
  console.log('  ✅ ca.attestto.sol created!')
  console.log(`  TX:         ${sig}`)
  console.log(`  PDA:        ${subdomainKey.toBase58()}`)
  console.log(`  Owner:      ${ownerPubkey.toBase58()}`)
  console.log(`  Explorer:   https://explorer.solana.com/tx/${sig}?cluster=${NETWORK}`)
  console.log('')
  console.log('  did:sns:ca.attestto is now the Attestto Root CA anchor.')
}

main().catch((err) => {
  console.error('  ❌ Error:', err.message || err)
  process.exit(1)
})
