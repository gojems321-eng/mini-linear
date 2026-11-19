/**
 * Quick connectivity probe: does the sandbox's pre-authenticated
 * z-ai-web-dev-sdk gateway accept chat completions for glm-5.3-flash
 * and return parseable JSON? Prints only the parsed result / error type,
 * never credentials.
 */
import ZAI from 'z-ai-web-dev-sdk'

const MODEL = 'glm-5.3-flash'

async function main() {
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    model: MODEL,
    thinking: { type: 'disabled' },
    messages: [
      { role: 'assistant', content: 'You convert rough notes into structured issue JSON. Reply with JSON only: {"title":string,"priority":"LOW"|"MEDIUM"|"HIGH"|"URGENT"}' },
      { role: 'user', content: 'rough note: the login button does nothing when clicked, users are stuck' },
    ],
  })
  const text = completion.choices?.[0]?.message?.content
  console.log('--- raw text (first 500 chars) ---')
  console.log(text?.slice(0, 500))
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    console.log('--- parsed OK ---')
    console.log(JSON.stringify(json, null, 2))
  } catch (error) {
    console.log('--- JSON parse failed:', error.message)
  }
}

main().catch((error) => {
  console.log('PROBE FAILED:', error.name, error.message?.slice(0, 300))
  process.exit(1)
})
