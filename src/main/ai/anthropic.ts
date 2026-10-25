import Anthropic from '@anthropic-ai/sdk'
import type { AiConfig } from '../settings'
import type { AiClient } from './types'

// Notes and answers are short; a bounded cap keeps a runaway response from burning tokens.
const MAX_TOKENS = 16000

/** The `effort` control exists on Claude's 4.5+ Opus and 5.x models; older ones reject it. */
function supportsEffort(model: string): boolean {
  return /^claude-(opus-(4-[5-9]|[5-9])|sonnet-[5-9]|haiku-[5-9]|fable)/.test(model)
}

function describeError(err: unknown, model: string): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic rejected the API key. Check it in Settings.'
  if (err instanceof Anthropic.PermissionDeniedError) return `This API key doesn't have access to ${model}.`
  if (err instanceof Anthropic.NotFoundError) return `Model "${model}" wasn't found. Choose another in Settings.`
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic is rate limiting this key. Try again in a moment.'
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach Anthropic. Check your internet connection.'
  if (err instanceof Anthropic.APIError) return `Anthropic API error (${err.status ?? 'no status'}): ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

export function anthropicClient(config: AiConfig): AiClient {
  let client: Anthropic
  try {
    // Without a stored key the SDK falls back to ANTHROPIC_API_KEY or an `ant auth login` profile.
    client = config.apiKey ? new Anthropic({ apiKey: config.apiKey }) : new Anthropic()
  } catch {
    throw new Error('Add your Anthropic API key in Settings.')
  }

  return {
    async stream(request, onText, signal) {
      try {
        const stream = client.beta.messages.stream(
          {
            model: config.model,
            max_tokens: MAX_TOKENS,
            ...(supportsEffort(config.model) ? { output_config: { effort: request.effort } } : {}),
            system: [
              { type: 'text', text: request.system },
              { type: 'text', text: request.context, cache_control: { type: 'ephemeral' } }
            ],
            messages: request.messages,
            // If a safety classifier declines, the API retries on its recommended fallback model.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default'
          },
          { signal }
        )
        stream.on('text', (delta) => onText(delta))
        const message = await stream.finalMessage()
        if (message.stop_reason === 'refusal') throw new Error('Claude declined to answer this one.')
        return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
      } catch (err) {
        throw new Error(describeError(err, config.model))
      }
    },

    async listModels() {
      try {
        const ids: string[] = []
        for await (const model of client.models.list()) ids.push(model.id)
        return ids
      } catch (err) {
        throw new Error(describeError(err, config.model))
      }
    }
  }
}
