import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { roundsDir, writeRound, readRound, listRounds } from '../lib/store.js'

const temporaryHome = await mkdtemp(join(tmpdir(), 'dashboard-storage-'))
const savedEnv = { DSH_HOME: process.env.DSH_HOME, DSH_PROFILE: process.env.DSH_PROFILE }
let count = 0
function check(name, run) { run(); count++; process.stdout.write(`PASS ${name}\n`) }
try {
  process.env.DSH_HOME = temporaryHome
  delete process.env.DSH_PROFILE
  const profile = (name) => join(temporaryHome, 'profiles', name)
  const inProfile = (name) => ({ get: (key) => key === 'settings'
    ? { documentPath: join(profile(name), 'cordis.patch.yml') } : undefined })
  check('Explicit host profile takes precedence', () => assert.equal(
    roundsDir({ app: { profileDir: profile('explicit') } }), join(profile('explicit'), 'dashboard-rounds')))
  check('Settings metadata selects the active desktop profile', () => assert.equal(
    roundsDir(inProfile('desktop')), join(profile('desktop'), 'dashboard-rounds')))
  check('Different profiles use different history directories', () => assert.notEqual(
    roundsDir(inProfile('desktop')), roundsDir(inProfile('research'))))
  check('Plugin installation directory is never used for history', () => assert.equal(
    roundsDir({ baseDir: join(temporaryHome, 'checkout') }), join(profile('multimodel-dashboard'), 'dashboard-rounds')))
  check('Global settings file does not become the history directory', () => assert.equal(
    roundsDir({ settings: { documentPath: join(temporaryHome, 'settings.yaml') } }),
    join(profile('multimodel-dashboard'), 'dashboard-rounds')))
  check('Relative profile paths do not write into the working tree', () => assert.equal(
    roundsDir({ app: { profileDir: '.' } }), join(profile('multimodel-dashboard'), 'dashboard-rounds')))
  process.env.DSH_PROFILE = 'custom'
  check('Explicit DSH_PROFILE fallback is respected', () => assert.equal(
    roundsDir({}), join(profile('custom'), 'dashboard-rounds')))
  process.env.DSH_PROFILE = '../outside'
  check('Traversal in DSH_PROFILE is rejected', () => assert.equal(
    roundsDir({}), join(profile('multimodel-dashboard'), 'dashboard-rounds')))
  check('Unavailable context services safely fall back', () => assert.equal(
    roundsDir({ get() { throw new Error('unavailable') } }), join(profile('multimodel-dashboard'), 'dashboard-rounds')))
  const record = { roundId: 'synthetic-round', question: 'Synthetic fixture', savedAt: '2026-01-01T00:00:00Z', lanes: [] }
  await writeRound(roundsDir(inProfile('desktop')), record)
  assert.deepEqual(await readRound(roundsDir(inProfile('desktop')), record.roundId), record)
  count++; process.stdout.write('PASS Saved record can be read in its owning profile\n')
  assert.equal((await listRounds(roundsDir(inProfile('research')))).length, 0)
  count++; process.stdout.write('PASS Another profile cannot list that saved record\n')
} finally {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  if (dirname(resolve(temporaryHome)) !== resolve(tmpdir()) || !basename(temporaryHome).startsWith('dashboard-storage-')) {
    throw new Error('Temporary test path is outside its expected directory')
  }
  await rm(temporaryHome, { recursive: true, force: true })
}
process.stdout.write(`${count}/${count} storage checks passed; no model calls\n`)
