import { type Context, InlineKeyboard, InputFile, type SessionFlavor } from 'grammy'
import { type Conversation, type ConversationFlavor } from '@grammyjs/conversations'
import { compress, pollJob, downloadResult } from '../api.ts'
import { config } from '../config.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

export type SessionData = Record<string, never>

// ConversationFlavor<C> wraps the base context; session flavor is part of the base
type BaseContext = Context & SessionFlavor<SessionData>
export type MyContext = ConversationFlavor<BaseContext>

export type MyConversation = Conversation<MyContext, MyContext>

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ─── Step 1: Format selection ─────────────────────────────────────────────────

async function askFormat(conversation: MyConversation, ctx: MyContext): Promise<string> {
  const keyboard = new InlineKeyboard()
    .text('WebP', 'fmt:webp')
    .text('AVIF', 'fmt:avif')
    .row()
    .text('JPEG', 'fmt:jpeg')
    .text('PNG', 'fmt:png')

  await ctx.reply('🖼 <b>Step 1 of 3 — Choose output format:</b>', {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })

  const fmtCtx = await conversation.waitForCallbackQuery(/^fmt:/)
  await fmtCtx.answerCallbackQuery()
  await fmtCtx.editMessageText(
    `✅ Format: <b>${fmtCtx.callbackQuery.data.split(':')[1].toUpperCase()}</b>`,
    { parse_mode: 'HTML' },
  )

  return fmtCtx.callbackQuery.data.split(':')[1]
}

// ─── Step 2: Quality selection ────────────────────────────────────────────────

async function askQuality(conversation: MyConversation, ctx: MyContext): Promise<number> {
  const keyboard = new InlineKeyboard()
    .text('Low (60)', 'qty:60')
    .text('Medium (80)', 'qty:80')
    .row()
    .text('High (95)', 'qty:95')
    .text('Custom', 'qty:custom')

  await ctx.reply('🎚 <b>Step 2 of 3 — Choose quality level:</b>', {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })

  const qtyCtx = await conversation.waitForCallbackQuery(/^qty:/)
  const value = qtyCtx.callbackQuery.data.split(':')[1]

  if (value !== 'custom') {
    const quality = parseInt(value, 10)
    await qtyCtx.answerCallbackQuery()
    await qtyCtx.editMessageText(`✅ Quality: <b>${quality}</b>`, { parse_mode: 'HTML' })
    return quality
  }

  // Custom quality path
  await qtyCtx.answerCallbackQuery()
  await qtyCtx.editMessageText('✏️ Enter a custom quality value…', { parse_mode: 'HTML' })

  let quality: number | null = null
  while (quality === null) {
    await ctx.reply('Enter a quality value between <b>1</b> and <b>100</b>:', {
      parse_mode: 'HTML',
    })
    const textCtx = await conversation.waitFor('message:text')
    const parsed = parseInt(textCtx.message.text.trim(), 10)
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
      quality = parsed
    } else {
      await textCtx.reply('⚠️ Invalid value. Please enter a whole number between 1 and 100.')
    }
  }

  return quality
}

// ─── Step 3: Image collection ─────────────────────────────────────────────────

interface ImageRef {
  fileId: string
  filename: string
  mimeType: string
  fileSize?: number
}

async function collectImages(
  conversation: MyConversation,
  ctx: MyContext,
): Promise<ImageRef[]> {
  const collected: ImageRef[] = []

  const buildKeyboard = (count: number) =>
    new InlineKeyboard().text(
      count === 0 ? '✅ Process (0 images)' : `✅ Process (${count} image${count === 1 ? '' : 's'})`,
      'process',
    )

  const promptMsg = await ctx.reply(
    '📤 <b>Step 3 of 3 — Send your images</b>\n\n' +
      'Send photos or image files (as documents for full resolution).\n' +
      'You can send multiple images or an entire album.\n\n' +
      'Tap <b>✅ Process</b> when you\'re done.',
    { parse_mode: 'HTML', reply_markup: buildKeyboard(0) },
  )

  while (true) {
    const update = await conversation.wait()

    // "Process" button tapped
    if (update.callbackQuery?.data === 'process') {
      if (collected.length === 0) {
        await update.answerCallbackQuery({ text: 'Please send at least one image first!' })
        continue
      }
      await update.answerCallbackQuery({ text: 'Starting compression…' })
      break
    }

    // Telegram-compressed photo
    if (update.message?.photo) {
      const photo = update.message.photo[update.message.photo.length - 1]
      collected.push({
        fileId: photo.file_id,
        filename: `photo_${collected.length + 1}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: photo.file_size,
      })
    }
    // Image sent as a file/document
    else if (
      update.message?.document &&
      update.message.document.mime_type?.startsWith('image/')
    ) {
      const doc = update.message.document
      collected.push({
        fileId: doc.file_id,
        filename: doc.file_name ?? `image_${collected.length + 1}`,
        mimeType: doc.mime_type!,
        fileSize: doc.file_size,
      })
    }
    // Ignore everything else
    else {
      continue
    }

    // Update the "Process" button counter
    try {
      await ctx.api.editMessageReplyMarkup(promptMsg.chat.id, promptMsg.message_id, {
        reply_markup: buildKeyboard(collected.length),
      })
    } catch {
      // Editing can fail if the message markup hasn't changed — safe to ignore
    }
  }

  return collected
}

// ─── File download from Telegram ─────────────────────────────────────────────

async function downloadTelegramFile(
  conversation: MyConversation,
  ctx: MyContext,
  ref: ImageRef,
): Promise<File> {
  return conversation.external(async () => {
    const tgFile = await ctx.api.getFile(ref.fileId)
    const fileUrl = `https://api.telegram.org/file/bot${config.botToken}/${tgFile.file_path}`
    const response = await fetch(fileUrl)
    if (!response.ok) {
      throw new Error(`Failed to download file from Telegram: HTTP ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    return new File([buffer], ref.filename, { type: ref.mimeType })
  })
}

// ─── Main conversation ────────────────────────────────────────────────────────

export async function compressConversation(
  conversation: MyConversation,
  ctx: MyContext,
): Promise<void> {
  const userId = ctx.from?.id ?? 'unknown'

  try {
    const format = await askFormat(conversation, ctx)
    const quality = await askQuality(conversation, ctx)
    const imageRefs = await collectImages(conversation, ctx)

    console.log(
      `[compress] user=${userId} format=${format.toUpperCase()} quality=${quality} images=${imageRefs.length}`,
    )
    for (const [i, ref] of imageRefs.entries()) {
      const sizeStr = ref.fileSize != null ? ` (${formatBytes(ref.fileSize)})` : ''
      console.log(`[compress] user=${userId}  #${i + 1} ${ref.filename}${sizeStr}`)
    }

    // Progress message — we edit it as we go
    const progressMsg = await ctx.reply(
      `⏳ Downloading <b>${imageRefs.length}</b> file${imageRefs.length === 1 ? '' : 's'} from Telegram…`,
      { parse_mode: 'HTML' },
    )

    const editProgress = (text: string) =>
      ctx.api.editMessageText(progressMsg.chat.id, progressMsg.message_id, text, {
        parse_mode: 'HTML',
      })

    // Download all images from Telegram
    const files: File[] = []
    for (const ref of imageRefs) {
      const file = await downloadTelegramFile(conversation, ctx, ref)
      files.push(file)
    }

    await editProgress(
      `⏳ Uploading to compressor (<b>${format.toUpperCase()}</b>, quality <b>${quality}</b>)…`,
    )

    // Submit to API (single batch call)
    const jobs = await conversation.external(() => compress(files, format, quality))

    const validJobs = jobs.filter((j) => !j.status) // exclude immediate errors
    const errorJobs = jobs.filter((j) => j.status === 'error')

    if (validJobs.length === 0) {
      await editProgress('❌ All files failed to process.')
      return
    }

    await editProgress(
      `⏳ Processing <b>${validJobs.length}</b> image${validJobs.length === 1 ? '' : 's'}…`,
    )

    // Poll all jobs concurrently
    const results = await conversation.external(() =>
      Promise.all(validJobs.map((j) => pollJob(j.id))),
    )

    await editProgress('📦 Sending results…')

    // Download and send each result
    for (const result of results) {
      const { data, ext } = await conversation.external(() => downloadResult(result.id))

      const basename = result.originalName.replace(/\.[^.]+$/, '')
      const outputFilename = `${basename}.${ext}`

      const sizeAfter = result.sizeAfter ?? 0
      const savings =
        result.sizeAfter != null && result.sizeBefore > 0
          ? Math.round((1 - result.sizeAfter / result.sizeBefore) * 100)
          : 0

      console.log(
        `[compress] user=${userId}  result: ${result.originalName}` +
          `  ${formatBytes(result.sizeBefore)} → ${formatBytes(sizeAfter)}` +
          `  (-${savings}%)  ${format.toUpperCase()} q${quality}`,
      )

      const caption =
        `📄 <b>${result.originalName}</b>\n` +
        `${formatBytes(result.sizeBefore)} → ${formatBytes(sizeAfter)}\n` +
        `💾 Saved: <b>${savings}%</b>`

      await ctx.replyWithDocument(new InputFile(new Uint8Array(data), outputFilename))

      await ctx.reply(caption, { parse_mode: 'HTML' })
    }

    // Report any files that failed immediately at the /compress stage
    if (errorJobs.length > 0) {
      await ctx.reply(
        `⚠️ ${errorJobs.length} file${errorJobs.length === 1 ? '' : 's'} could not be processed:\n` +
          errorJobs.map((j) => `• ${j.filename}`).join('\n'),
      )
    }

    // Clean up progress message
    try {
      await ctx.api.deleteMessage(progressMsg.chat.id, progressMsg.message_id)
    } catch {
      // Ignore if already deleted
    }

    await ctx.reply(
      `✅ Done! Compressed <b>${results.length}</b> image${results.length === 1 ? '' : 's'}.\n\nRun /compress to compress more.`,
      { parse_mode: 'HTML' },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
    console.error(`[compress] user=${userId} error: ${message}`)
    await ctx.reply(
      `❌ <b>Error:</b> ${message}\n\nPlease try again with /compress.`,
      { parse_mode: 'HTML' },
    )
  }
}
