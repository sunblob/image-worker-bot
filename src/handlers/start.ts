import type { MyContext } from '../conversations/compress.ts'

export async function handleStart(ctx: MyContext): Promise<void> {
  await ctx.reply(
    '👋 Welcome to <b>Image Compressor Bot</b>!\n\n' +
      'I can compress your images into WebP, AVIF, JPEG, or PNG — with the quality level you choose.\n\n' +
      'Commands:\n' +
      '/compress — start a compression session\n' +
      '/help — show this message',
    { parse_mode: 'HTML' },
  )
}
