import PROMPT_TEMPLATE from './system-prompt.md?raw'

import { MAX_AGENT_STEPS } from '@/app/ai/tools'

export const SYSTEM_PROMPT = PROMPT_TEMPLATE.replaceAll(
  '{{MAX_AGENT_STEPS}}',
  String(MAX_AGENT_STEPS)
)