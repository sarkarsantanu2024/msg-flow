import { z } from 'zod';
import { getAIProvider } from '@msgflow/ai';
import { createLogger } from '@msgflow/logger';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const log = createLogger('api:schema-propose');

/**
 * Propose an extraction schema from a photo/screenshot of the user's existing
 * document — their spreadsheet, register page, or form. The proposal lands in
 * the automation builder as editable field drafts; nothing is persisted here.
 * The image itself is also not persisted: it goes to the AI provider and is
 * gone, because it may show live business data the user never asked us to keep.
 */
const bodySchema = z.object({
  // ~7 MB of base64 ≈ a 5 MB image — beyond that, phone screenshots have gone wrong.
  imageBase64: z.string().min(100).max(10_000_000),
  mediaType: z.enum(['image/jpeg', 'image/png']),
  hint: z.string().max(500).optional(),
});

export const POST = route(async (request: Request) => {
  const context = await requirePermission('automations:manage');
  const input = bodySchema.parse(await readJson(request));

  const provider = getAIProvider();
  const { data, meta } = await provider.proposeSchemaFromImage(input);

  log.info('Schema proposed from image', {
    tenantId: context.tenantId,
    provider: meta.provider,
    fields: data.fields.length,
  });

  return ok({ proposal: data, provider: meta.provider });
});
