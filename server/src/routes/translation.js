import { z } from 'zod';
import { fail } from '../errors.js';
import { reserve } from '../translation.js';
import { providerPayload } from '../provider.js';
import { validate, uuid, languages } from '../schemas.js';

const translationRequest = z.object({
  tenant_id: uuid,
  request_id: uuid,
  text: z.string().min(1).max(40000).refine(text => text.trim().length > 0),
  source: z.enum(languages).nullable().optional(),
  target: z.enum(languages),
  style: z.enum(['faithful', 'formal', 'casual', 'polished']).default('faithful'),
}).strict();

export function installTranslation(app, { pool, config, translate }) {
  app.post('/api/translate', async (req, res) => {
    const body = validate(translationRequest, req.body);
    const reserved = await reserve(pool, req.user, body, config);
    const start = Date.now();
    let result;
    try {
      result = await translate(
        providerPayload(body, reserved.tenant), reserved.tenant.credential,
        reserved.providerKey, reserved.providerBaseURL,
      );
      if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('Empty response');
    } catch {
      await pool.query("UPDATE usage SET status='failed',duration_ms=$1 WHERE id=$2", [Date.now() - start, reserved.id]);
      fail(502, 'provider_unavailable');
    }
    await pool.query(`
      UPDATE usage SET status='success',input_tokens=$1,output_tokens=$2,duration_ms=$3 WHERE id=$4
    `, [result.input_tokens || 0, result.output_tokens || 0, Date.now() - start, reserved.id]);
    // Emit a complete validated translation. Neither a partial provider body nor
    // upstream diagnostic data may become replacement text in a native client.
    res.type('text/event-stream').send(
      `data: ${JSON.stringify({ choices: [{ delta: { content: result.text } }] })}\n\ndata: [DONE]\n\n`,
    );
  });
}
