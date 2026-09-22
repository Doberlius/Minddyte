import { describe, it, expect } from 'vitest'
import { chooseProvider, hostedModels } from '@/lib/provider'
import { clientFor } from '@/lib/ollama'

/**
 * Which provider answers is decided by environment alone, so it is a pure
 * function over `env` and therefore testable without a network or a daemon.
 * The rule that matters: a deployment with a key must never silently fall
 * back to a localhost daemon that is not there.
 */
describe('chooseProvider', () => {
  const KEY = 'sk-test-key'

  it('prefers the hosted provider when a key is present', () => {
    const choice = chooseProvider({ HOSTED_API_KEY: KEY } as unknown as NodeJS.ProcessEnv)

    expect(choice.kind).toBe('hosted')
    expect(choice.kind === 'hosted' && choice.apiKey).toBe(KEY)
  })

  it('never falls back to localhost once a key is set', () => {
    // The failure this prevents: a deployed instance quietly trying
    // 127.0.0.1 and reporting "no model" instead of "your key is wrong".
    const choice = chooseProvider({
      HOSTED_API_KEY: KEY,
      OLLAMA_BASE_URL: 'http://localhost:11434',
    } as unknown as NodeJS.ProcessEnv)

    expect(choice.kind).toBe('hosted')
  })

  it('uses the local daemon when there is no key', () => {
    const choice = chooseProvider({ OLLAMA_BASE_URL: 'http://localhost:11434' } as unknown as NodeJS.ProcessEnv)

    expect(choice.kind).toBe('local')
    expect(choice.kind === 'local' && choice.baseURL).toBe('http://localhost:11434/api')
  })

  it('defaults the local base url when nothing is set at all', () => {
    const choice = chooseProvider({} as unknown as NodeJS.ProcessEnv)

    expect(choice.kind).toBe('local')
    expect(choice.kind === 'local' && choice.baseURL).toBe('http://localhost:11434/api')
  })

  it('honours a requested model that this deployment offers', () => {
    const env = { HOSTED_API_KEY: KEY } as unknown as NodeJS.ProcessEnv
    const models = hostedModels(env)
    const choice = chooseProvider(env, models[1].id)

    expect(choice.kind === 'hosted' && choice.model).toBe(models[1].id)
  })

  it('refuses a model this deployment does not offer, rather than passing it upstream', () => {
    // A request naming an arbitrary model is a request to spend money on
    // something nobody chose. Fall back to the default instead.
    const env = { HOSTED_API_KEY: KEY } as unknown as NodeJS.ProcessEnv
    const models = hostedModels(env)
    const choice = chooseProvider(env, 'some-enormous-model')

    expect(choice.kind === 'hosted' && choice.model).toBe(models[0].id)
  })

  it('says what is wrong when a key is set but the model list is empty', () => {
    const choice = chooseProvider({ HOSTED_API_KEY: KEY, HOSTED_MODEL_IDS: '' } as unknown as NodeJS.ProcessEnv)

    expect(choice.kind).toBe('none')
    expect(choice.kind === 'none' && choice.reason.length).toBeGreaterThan(20)
  })

  it('treats a list of blank entries as no list at all', () => {
    // "HOSTED_MODEL_IDS=, ," is a plausible way to end up with nothing,
    // and it must reach the same named failure as an empty string.
    const choice = chooseProvider({ HOSTED_API_KEY: KEY, HOSTED_MODEL_IDS: ' , ,' } as unknown as NodeJS.ProcessEnv)

    expect(choice.kind).toBe('none')
  })

  it('refuses to fall back to localhost when HOSTED_API_KEY is empty but HOSTED_BASE_URL is set', () => {
    // The Railway/Vercel deploy mistake: the variable name exists with an
    // empty value because someone forgot to paste the secret. A configured
    // HOSTED_BASE_URL next to it proves the intent was hosted, not local.
    const choice = chooseProvider({
      HOSTED_API_KEY: '',
      HOSTED_BASE_URL: 'https://example.com/api',
    } as unknown as NodeJS.ProcessEnv)

    expect(choice.kind).toBe('none')
    expect(choice.kind === 'none' && choice.reason).toMatch(/HOSTED_API_KEY/)
  })

  it('catches a whitespace-only key the same way, when HOSTED_MODEL_IDS is set', () => {
    const choice = chooseProvider({
      HOSTED_API_KEY: '   ',
      HOSTED_MODEL_IDS: 'gpt-oss:120b-cloud',
    } as unknown as NodeJS.ProcessEnv)

    expect(choice.kind).toBe('none')
    expect(choice.kind === 'none' && choice.reason).toMatch(/HOSTED_API_KEY/)
  })

  it('stays local when none of the three hosted variables are set at all', () => {
    // The fix for the two tests above must not catch a plain developer
    // machine that has never heard of any hosted variable.
    const choice = chooseProvider({ HOSTED_API_KEY: '' } as unknown as NodeJS.ProcessEnv)

    expect(choice.kind).toBe('local')
  })

  it('defaults the hosted base url when HOSTED_BASE_URL is unset', () => {
    const choice = chooseProvider({ HOSTED_API_KEY: KEY } as unknown as NodeJS.ProcessEnv)

    expect(choice.kind === 'hosted' && choice.baseURL).toBe('https://ollama.com/api')
  })

  it('honours an explicit HOSTED_BASE_URL, and falls back to the default when it is blank', () => {
    const overridden = chooseProvider({
      HOSTED_API_KEY: KEY,
      HOSTED_BASE_URL: 'https://example.com/api',
    } as unknown as NodeJS.ProcessEnv)
    expect(overridden.kind === 'hosted' && overridden.baseURL).toBe('https://example.com/api')

    const blank = chooseProvider({
      HOSTED_API_KEY: KEY,
      HOSTED_BASE_URL: '   ',
    } as unknown as NodeJS.ProcessEnv)
    expect(blank.kind === 'hosted' && blank.baseURL).toBe('https://ollama.com/api')
  })

  it('clientFor throws on a none choice, carrying the reason', () => {
    // clientFor's own docblock says construction is local object creation,
    // not a connection — so this needs no network and no mock.
    const reason = 'HOSTED_API_KEY is empty, but HOSTED_BASE_URL is set.'

    expect(() => clientFor({ kind: 'none', reason })).toThrow(reason)
  })
})
