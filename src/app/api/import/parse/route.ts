import { NextRequest, NextResponse } from 'next/server';
import { parseStatement } from '@/lib/import-parser';

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

    const content = await file.text();
    const result = parseStatement(content, file.name);

    return NextResponse.json({
      data: {
        fileName: file.name,
        fileType: result.fileType,
        headers: result.headers,
        rows: result.rows.slice(0, 100), // limit preview to 100 rows
        totalRows: result.rows.length,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error('POST /api/import/parse error:', error);
    return NextResponse.json({ error: 'Failed to parse file' }, { status: 500 });
  }
}
