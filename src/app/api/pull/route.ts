const OLLAMA = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/api'

export async function POST(req: Request){
    const {model} = await req.json()

    const ollamaRes = await fetch(`${OLLAMA}/pull`, {
        method: 'POST',
        body: JSON.stringify({name: model, stream: true}),
    })

    const stream = new ReadableStream({
        async start(controller){
            const reader = ollamaRes.body!.getReader()
            const decoder = new TextDecoder()
            while(true){
                const {done, value} = await reader.read()
                if(done) break
                const lines = decoder.decode(value).split('\n').filter(Boolean)
                for(const line of lines){
                    try{
                        const data = JSON.parse(line)
                        const progress = data.total ? Math.round((data.completed/data.total) * 100) :0
                        controller.enqueue(`data: ${JSON.stringify({status: data.status, progress})}\n\n`)
                    }catch{}
                }
            }
        controller.close()
        },
    })

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
        }
    })
}