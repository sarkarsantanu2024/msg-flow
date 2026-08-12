import { previewWorkbook, parseCsv, buildStorageRef, getStorage } from '@msgflow/connectors';
import { AppError } from '@msgflow/types';
import type { WorkbookPreview } from '@msgflow/types';
import { ok, route } from '@/lib/api';
import { requirePermission } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Upload an existing workbook and describe it.
 *
 * This is step one of "maintain the file I already use": read the real
 * worksheets and columns so the user maps their extracted fields onto columns
 * that genuinely exist, rather than typing header names from memory.
 *
 * The file is stored immediately, so the mapping the user builds refers to the
 * exact bytes that were inspected.
 */
export const POST = route(async (request: Request) => {
  const context = await requirePermission('outputs:manage');

  const formData = await request.formData().catch(() => {
    throw new AppError('VALIDATION_FAILED', 'Expected a multipart file upload.');
  });

  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new AppError('VALIDATION_FAILED', 'No file was provided.');
  }
  if (file.size === 0) {
    throw new AppError('VALIDATION_FAILED', 'That file is empty.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'Files larger than 25 MB are not supported.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name || 'upload.xlsx';
  const isCsv = /\.csv$/i.test(fileName);

  let preview: WorkbookPreview;

  if (isCsv) {
    const rows = parseCsv(buffer.toString('utf8'));
    if (rows.length === 0) throw new AppError('VALIDATION_FAILED', 'That CSV file has no readable rows.');

    const header = rows[0];
    const sample = rows.slice(1, 9);

    preview = {
      fileName,
      checksum: '',
      sizeBytes: buffer.length,
      worksheets: [
        {
          name: 'CSV',
          rowCount: Math.max(0, rows.length - 1),
          columnCount: header.length,
          columns: header.map((headerValue, index) => ({
            index: index + 1,
            letter: String.fromCharCode(65 + (index % 26)),
            header: headerValue.trim() || `Column ${index + 1}`,
            sampleValues: sample.map((r) => r[index] ?? '').filter((v) => v !== '').slice(0, 5),
            inferredType: 'string' as const,
          })),
          warnings: [],
        },
      ],
    };
  } else {
    preview = await previewWorkbook(buffer, fileName);
  }

  const storageRef = buildStorageRef(context.tenantId, 'uploads', fileName);
  const stored = await getStorage().write(storageRef, buffer);

  return ok({
    ...preview,
    checksum: stored.checksum,
    storageRef: stored.storageRef,
  });
});
