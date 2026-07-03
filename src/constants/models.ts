import type { ModelEntry } from '@/types/index'

export const MODEL_REGISTRY: ModelEntry[] = [
  { id: 'qwen3.5:cloud',          label: 'Qwen 3.5',         size: '4.7 GB',  downloaded: true  },
  { id: 'gemma4',                 label: 'Gemma 4',          size: '5.0 GB',  downloaded: true  },
  { id: 'qwen3.6',                label: 'Qwen 3.6',         size: '5.2 GB',  downloaded: true  },
  { id: 'nemotron-3-super:cloud', label: 'Nemotron 3 Super', size: '12 GB',   downloaded: false },
  { id: 'gemma4:31b-cloud',       label: 'Gemma 4 31B',      size: '19 GB',   downloaded: false },
  { id: 'qwen3.5:397B-cloud',     label: 'Qwen 3.5 397B',    size: '230 GB',  downloaded: false },
  { id: 'kimi-k2.5:cloud',        label: 'Kimi K2.5',        size: '9.8 GB',  downloaded: false },
]
