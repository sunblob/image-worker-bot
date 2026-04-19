import { config } from './config.ts'

export interface CompressJob {
  id: string
  filename: string
  status?: 'error'
}

export interface JobStatus {
  id: string
  status: 'processing' | 'done' | 'error'
  originalName: string
  sizeBefore: number
  sizeAfter?: number
  ext?: string
  error?: string
  createdAt: number
}

export interface DownloadResult {
  data: ArrayBuffer
  ext: string
}

export async function compress(
  files: File[],
  format: string,
  quality: number,
  urls: string[] = [],
): Promise<CompressJob[]> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  for (const url of urls) {
    formData.append('urls', url)
  }
  formData.append('format', format)
  formData.append('quality', String(quality))

  const response = await fetch(`${config.apiBaseUrl}/compress`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Compress API error ${response.status}: ${text}`)
  }

  const data = (await response.json()) as { jobs: CompressJob[] }
  return data.jobs
}

export async function pollJob(id: string): Promise<JobStatus> {
  const maxAttempts = 80
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${config.apiBaseUrl}/jobs/${id}`)
    if (!response.ok) {
      throw new Error(`Job status API error ${response.status} for job ${id}`)
    }

    const job = (await response.json()) as JobStatus

    if (job.status === 'done') return job
    if (job.status === 'error') {
      throw new Error(job.error ?? `Job ${id} failed with unknown error`)
    }

    await Bun.sleep(1500)
  }

  throw new Error(`Job ${id} timed out after ${(maxAttempts * 1500) / 1000}s`)
}

export async function downloadResult(id: string): Promise<DownloadResult> {
  const response = await fetch(`${config.apiBaseUrl}/jobs/${id}/download`)

  if (!response.ok) {
    throw new Error(`Download API error ${response.status} for job ${id}`)
  }

  const data = await response.arrayBuffer()

  // Try to extract extension from Content-Disposition: attachment; filename="photo.webp"
  let ext = 'bin'
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/i)
  if (filenameMatch) {
    const parts = filenameMatch[1].split('.')
    if (parts.length > 1) ext = parts[parts.length - 1]
  } else {
    // Fall back to Content-Type: image/webp → webp
    const contentType = response.headers.get('Content-Type') ?? ''
    const ctMatch = contentType.match(/image\/(\w+)/)
    if (ctMatch) ext = ctMatch[1]
  }

  return { data, ext }
}
