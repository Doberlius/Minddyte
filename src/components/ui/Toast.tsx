'use client'

interface ToastProps{
    message: string
}

export function Toast({message}: ToastProps){
    if(!message) return null

    return (
        <div
            className="pop"
            style={{
                position: 'fixed', bottom: 24, left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--ink)', color: '#fff',
                padding: '9px 18px', borderRadius: 8,
                fontSize: 12, fontWeight: 500,
                zIndex: 1000, whiteSpace: 'nowrap',
                pointerEvents: 'none',
            }}
    
        >
        {message}
        </div>
    )
}