import {createOllama} from 'ollama-ai-provider'

export const ollama = createOllama({
    baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/api'
})
