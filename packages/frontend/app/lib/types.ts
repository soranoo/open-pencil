export interface UsageSummary {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface GenerationResult {
  designId: string
  editorUrl: string
  summary: string
  usage: UsageSummary
}
