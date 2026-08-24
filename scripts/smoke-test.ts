/**
 * Smoke test – crypto + database (no Discord connection needed)
 * Run: npx tsx --env-file=.env scripts/smoke-test.ts
 */
import 'dotenv/config';
import { encrypt, decrypt, generateLicenseKey, createRawKeyPayload } from '../src/utils/crypto';
import { users, staff, servers, keys, settings } from '../src/database';
import { randomUUID } from 'node:crypto';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ✓', msg);
}

async function main() {
  console.log('=== Smoke Test HieuTool ===\n');

  // Encryption
  console.log('[1] Crypto');
  const plain = 'test-user-token-abc123XYZ';
  const enc = encrypt(plain);
  const dec = decrypt(enc);
  assert(dec === plain, 'encrypt/decrypt roundtrip');
  assert(enc !== plain, 'ciphertext differs from plaintext');

  const { raw, encrypted } = generateLicenseKey('123456789012345678');
  assert(raw.length === 32, `raw payload length == 32 (got ${raw.length})`);
  assert(encrypted.length > 32, 'encrypted key is longer than raw');
  const raw2 = decrypt(encrypted);
  assert(raw2 === raw, 'license key decrypt matches raw payload');

  // Database
  console.log('\n[2] Database');
  const testUser = '999888777666555444';
  users.upsert(testUser);
  users.setToken(testUser, enc);
  users.setLicensed(testUser, true, 'fake-key');
  users.setTosAccepted(testUser, true);
  const u = users.get(testUser)!;
  assert(u.licensed === 1, 'user licensed');
  assert(u.tos_accepted === 1, 'tos accepted');
  assert(u.encrypted_token === enc, 'token stored');

  const access = users.canUseBot(testUser);
  assert(access.ok === true, 'canUseBot returns ok');

  users.setBanned(testUser, true);
  const banned = users.canUseBot(testUser);
  assert(banned.ok === false, 'banned user cannot use bot');
  assert(users.get(testUser)!.licensed === 0, 'ban revokes license');

  users.setBanned(testUser, false);
  users.setLicensed(testUser, true, 'fake-key');

  // Staff
  staff.add(testUser, 'admin', process.env.OWNER_ID || '0');
  assert(staff.isAdminOrOwner(testUser), 'isAdminOrOwner');
  staff.remove(testUser);

  // Servers
  servers.add('111222333444555666', testUser);
  assert(servers.isAllowed('111222333444555666'), 'server whitelisted');
  servers.remove('111222333444555666');

  // Keys
  const kid = randomUUID();
  const rec = keys.create(kid, raw, encrypted, testUser);
  assert(rec.status === 'unused', 'key created as unused');
  const found = keys.findByEncrypted(encrypted);
  assert(!!found && found.id === kid, 'findByEncrypted works');
  keys.markUsed(kid, testUser);
  assert(keys.get(kid)!.status === 'used', 'key marked used');

  // Settings
  settings.set('test_key', 'test_value');
  assert(settings.get('test_key') === 'test_value', 'settings set/get');

  console.log('\n=== ALL SMOKE TESTS PASSED ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
