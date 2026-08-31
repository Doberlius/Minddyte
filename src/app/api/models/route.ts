const OLLAMA = process.env.OLLAMA_BASE_URL ??  'http://localhost:11434/api'

export async function GET() {
    try{
        const res = await fetch(`${OLLAMA}/tags`)
        if(!res.ok) return Response.json([], {status: 200})
        const {models} = await res.json()
        return Response.json(models ?? [])    
    }catch{
        return Response.json([], {status: 200})
    }
}

export async function DELETE(req: Request) {
    const {model} = await req.json()
    await fetch(`${OLLAMA}/delete`, {
        method: "DELETE",
        body: JSON.stringify({name: model}),
    })
    return Response.json({success: true})
}