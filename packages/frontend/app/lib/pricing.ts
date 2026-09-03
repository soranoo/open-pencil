import type { UsageSummary } from './types'

export const PRICING = {
  standard: { input: 0.22, cachedInput: 0.007, output: 0.66 },
  peak: { input: 0.44, cachedInput: 0.014, output: 1.32 }
} as const

export function calculateCost(usage: UsageSummary, rate: keyof typeof PRICING): number {
  const pricing = PRICING[rate]
  return (
    (usage.inputTokens / 1_000_000) * pricing.input +
    (usage.cachedInputTokens / 1_000_000) * pricing.cachedInput +
    (usage.outputTokens / 1_000_000) * pricing.output
  )
}

export function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatCost(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  }).format(value)
}
