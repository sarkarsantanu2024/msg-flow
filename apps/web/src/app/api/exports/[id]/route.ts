import { getStorage } from '@msgflow/connectors';
import { assertTenantOwned, prisma } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { handleError } from '@/lib/api';
import { requirePermission } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requirePermission('exports:create');
    const { id } = await params;

    const record = assertTenantOwned(
      await prisma.export.findUnique({ where: { id } }),
      context.tenantId,
      'Export',
    );

    if (!record.storageRef) throw new AppError('NOT_FOUND', 'That export has no file.');
    if (record.expiresAt && record.expiresAt < new Date()) {
      throw new AppError('NOT_FOUND', 'That export has expired. Generate a new one.');
    }

    const buffer = await getStorage().read(record.storageRef);

    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': MIME[record.format] ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${record.fileName}"`,
        'content-length': String(buffer.length),
        'cache-control': 'private, no-store',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
