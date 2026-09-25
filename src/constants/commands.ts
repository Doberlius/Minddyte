import type { SlashCommand } from '@/types/index'

/**
 * NOT BUILT. Ideas for future commands, kept as a to-do list (ticket 08, Q11).
 * None of these work, and /help does not read this file. The commands that
 * DO work live in src/components/chat/commands.ts.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/help',      desc: 'Show all available commands'       },
  { cmd: '/mode',      desc: 'Switch focus | explore mode'       },
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
