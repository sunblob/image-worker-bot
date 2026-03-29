import { Bot, session } from 'grammy'
import { conversations, createConversation } from '@grammyjs/conversations'
import { config } from './config.ts'
import {
  compressConversation,
  type MyContext,
  type SessionData,
} from './conversations/compress.ts'
import { handleStart } from './handlers/start.ts'
import { handleHelp } from './handlers/help.ts'

const bot = new Bot<MyContext>(config.botToken)

// Middleware order is critical: session → conversations → createConversation
bot.use(
  session({
    initial: (): SessionData => ({} as SessionData),
  }),
)

bot.use(conversations())
bot.use(createConversation(compressConversation, 'compress'))

// Commands
bot.command('start', handleStart)
bot.command('help', handleHelp)
bot.command('compress', async (ctx) => {
  await ctx.conversation.enter('compress')
})

// Global error handler
bot.catch((err) => {
  console.error('[bot] Unhandled error:', err.error)
})

bot.start({
  onStart: () => console.log(`[bot] image-worker-bot started (API: ${config.apiBaseUrl})`),
})
