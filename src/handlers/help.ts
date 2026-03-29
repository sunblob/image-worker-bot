import type { MyContext } from '../conversations/compress.ts'

export async function handleHelp(ctx: MyContext): Promise<void> {
  await ctx.reply(
    '<b>Image Compressor Bot — Help</b>\n\n' +
      '<b>Commands:</b>\n' +
      '/compress — start compressing images\n' +
      '/help — show this message\n\n' +
      '<b>How it works:</b>\n' +
      '1. Run /compress\n' +
      '2. Pick an output format (WebP, AVIF, JPEG, PNG)\n' +
      '3. Pick a quality level (or enter a custom value 1–100)\n' +
      '4. Send one or more images — photos or files\n' +
      '5. Tap ✅ Process when done\n' +
      '6. Receive your compressed images with size savings\n\n' +
      '<b>Tips:</b>\n' +
      '• Send images <i>as files</i> to preserve original resolution\n' +
      '• You can send an entire photo album at once\n' +
      '• WebP / AVIF give the best compression for web use',
    { parse_mode: 'HTML' },
  )
}
