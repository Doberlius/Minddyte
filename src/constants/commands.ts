import type { SlashCommand } from '@/types/index'

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/help',      desc: 'Show all available commands'       },
  { cmd: '/memory',    desc: 'Show active nodes this session'    },
  { cmd: '/mode',      desc: 'Switch focus | explore mode'       },
  { cmd: '/clear',     desc: 'Clear all active nodes'            },
  { cmd: '/save',      desc: 'Save session to Memory Archive'    },
  { cmd: '/connect',   desc: 'Manually attach a node'            },
  { cmd: '/forget',    desc: 'Detach a specific node'            },
  { cmd: '/summarize', desc: 'Summarize this conversation'       },
  { cmd: '/node',      desc: 'Create a new Brain node'           },
  { cmd: '/rename',    desc: 'Rename the current session'        },
  { cmd: '/new',       desc: 'Start a new session'               },
  { cmd: '/search',    desc: 'Search sessions and nodes'         },
  { cmd: '/brain',     desc: 'Open mini Brain panel inline'      },
  { cmd: '/model',     desc: 'Open model switcher'               },
]
