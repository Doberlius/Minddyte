import { describe, it, expect } from 'vitest'
import { chooseProvider, hostedModels } from '@/lib/provider'

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
})
