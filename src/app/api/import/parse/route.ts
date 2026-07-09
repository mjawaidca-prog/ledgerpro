import { NextRequest, NextResponse } from 'next/server';
import { parseStatementFile } from '@/lib/import-parser';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File must be ≤ 10 MB' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await parseStatementFile(buffer, file.name);

    return NextResponse.json({
      data: {
        fileName: file.name,
        fileType: result.fileType,
        headers: result.headers,
        rows: result.rows,
        totalRows: result.rows.length,
        errors: result.errors,
        columnMeta: result.columnMeta || null,
      },
    });
  } catch (error: any) {
    console.error('POST /api/import/parse error:', error);
    return NextResponse.json({ error: 'Failed to parse file: ' + (error.message || 'Unknown error') }, { status: 500 });
  }
}
