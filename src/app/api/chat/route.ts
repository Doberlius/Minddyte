import {streamText, convertToModelMessages, type UIMessage} from 'ai'
import {ollama} from '@/lib/ollama'
import {resolveModel} from '@/constants/models'

export async function POST(req: Request){
    const {
        messages,
        activeNodes = [],
        mode = 'explore',
        model,
    }: {
        messages: UIMessage[]
        activeNodes?: {label: string; summary?: string}[]
        mode?: 'focus' | 'explore'
        model?: string
    } = await req.json()

    // Never hand an arbitrary client string to the provider — fall back to the
    // default for anything not in the registry.
    const modelId = resolveModel(model)

    const nodeContext = activeNodes
    .map((n) =>
        `-${n.label}${n.summary ? ': ' + n.summary: ''}`
    ).join('\n')

    const systemPrompt = 
        mode === 'focus'
            ? `You are Minddyte. Respond ONLY using the provided node context.\n\nActive nodes:\n${nodeContext}`
            : `You are Minddyte, a context-aware knowledge assistant. Use the node context to inform your response. You may also draw on general knowledge.\n\nActive nodes:\n${nodeContext || 'None — exploring freely.'}`

    const result = streamText({
        model: ollama(modelId),
        system: systemPrompt,
        messages: await convertToModelMessages(messages),
        maxOutputTokens: 2048,
    })

    return result.toUIMessageStreamResponse()
}