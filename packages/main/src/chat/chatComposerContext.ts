import { readFile } from 'fs/promises'
import { relative, resolve, sep } from 'path'
import type { ChatComposerSubmission } from '@aide/shared'

const MAX_MENTIONED_FILE_BYTES = 12_000

const COMMAND_INSTRUCTIONS: Record<string, string> = {
  plan: 'Create a short implementation plan before making changes.',
  explain: 'Focus on explaining the relevant code and behavior clearly.',
  fix: 'Focus on identifying the root cause and implementing the smallest correct fix.',
  tests: 'Focus on adding or updating the smallest useful tests for this work.',
}

export async function buildComposerContext(
  submission: ChatComposerSubmission,
  rootPath: string,
): Promise<{ contextualContent: string; mentionedFiles: string[]; commandId?: string }> {
  const mentionedFiles = sanitizeMentionedFiles(submission.mentionedFiles, rootPath)
  const sections: string[] = []
  const commandInstruction = submission.commandId
    ? COMMAND_INSTRUCTIONS[submission.commandId]
    : undefined
  if (commandInstruction) {
    sections.push(`Requested mode: /${submission.commandId}\n${commandInstruction}`)
  }

  if (mentionedFiles.length > 0) {
    const fileSections = await Promise.all(
      mentionedFiles.map(async (filePath) => formatMentionedFile(rootPath, filePath)),
    )
    sections.push(['Referenced files:', ...fileSections].join('\n\n'))
  }

  sections.push(submission.text)
  return {
    contextualContent: sections.filter(Boolean).join('\n\n'),
    mentionedFiles,
    commandId: submission.commandId,
  }
}

function sanitizeMentionedFiles(paths: string[], rootPath: string): string[] {
  const unique = new Set<string>()
  for (const filePath of paths) {
    if (!filePath) continue
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
    const absolute = resolve(rootPath, normalized)
    if (!isWithinRoot(absolute, rootPath)) continue
    unique.add(relative(rootPath, absolute).replace(/\\/g, '/'))
  }
  return [...unique]
}

function isWithinRoot(candidate: string, rootPath: string): boolean {
  const rel = relative(rootPath, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.includes(`..${sep}`))
}

async function formatMentionedFile(rootPath: string, filePath: string): Promise<string> {
  const absolute = resolve(rootPath, filePath)
  try {
    const content = await readFile(absolute, 'utf-8')
    const trimmed =
      content.length > MAX_MENTIONED_FILE_BYTES
        ? `${content.slice(0, MAX_MENTIONED_FILE_BYTES)}\n...[truncated by aIDE]`
        : content
    return [`- ${filePath}`, '```', trimmed, '```'].join('\n')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `- ${filePath}\n(unavailable: ${message})`
  }
}
