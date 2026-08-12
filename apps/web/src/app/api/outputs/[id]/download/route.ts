import { getStorage } from '@msgflow/connectors';
import { assertTenantOwned, prisma } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { handleError } from '@/lib/api';
import { requirePermission } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME_TYPES: Record<string, string> = {
  EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv',
  PDF: 'application/pdf',
  POWERPOINT: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const EXTENSIONS: Record<string, string> = { EXCEL: 'xlsx', CSV: 'csv', PDF: 'pdf', POWERPOINT: 'pptx' };

/** Download the current file, or a specific historical version. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requirePermission('outputs:read');
    const { id } = await params;
    const versionParam = new URL(request.url).searchParams.get('version');

    const output = assertTenantOwned(
      await prisma.output.findUnique({ where: { id } }),
      context.tenantId,
      'Output',
    );

    let storageRef: string | null = null;

    if (versionParam) {
      const version = await prisma.outputVersion.findFirst({
        where: { outputId: output.id, version: Number(versionParam) },
      });
      if (!version) throw new AppError('NOT_FOUND', 'That version does not exist.');
      storageRef = version.storageRef;
    } else {
      storageRef = ((output.config ?? {}) as { storageRef?: string }).storageRef ?? null;
    }

    if (!storageRef) {
      throw new AppError(
        'NOT_FOUND',
        'This output has no generated file yet. Run a sync first, or download from the connected system.',
      );
    }

    const buffer = await getStorage().read(storageRef);
    const extension = EXTENSIONS[output.type] ?? 'bin';
    const safeName = output.name.replace(/[^\w.\- ]/g, '_').trim() || 'output';
    const fileName = versionParam ? `${safeName} (v${versionParam}).${extension}` : `${safeName}.${extension}`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': MIME_TYPES[output.type] ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${fileName}"`,
        'content-length': String(buffer.length),
        'cache-control': 'private, no-store',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
