import { NextRequest, NextResponse } from 'next/server';
import tursoClient, { initializeDatabase } from '@/lib/db';

function safeInt(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await initializeDatabase();

    const params = await context.params;
    const affiliateId = safeInt(params.id);
    if (affiliateId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid affiliate id' }, { status: 400 });
    }

    const linkResult = await tursoClient.execute({
      sql: `
        SELECT affiliate_url, is_active
        FROM affiliate_links
        WHERE id = ?
        LIMIT 1
      `,
      args: [affiliateId],
    });

    const row = linkResult.rows[0] as Record<string, unknown> | undefined;
    const isActive = Number(row?.is_active) === 1;
    const targetUrl = String(row?.affiliate_url || '');

    if (!isActive || !targetUrl.startsWith('http')) {
      return NextResponse.json({ success: false, error: 'Affiliate link not found or inactive' }, { status: 404 });
    }

    const sessionId = request.cookies.get('aether_sid')?.value || null;
    const metadata = JSON.stringify({
      affiliateId,
      path: request.nextUrl.pathname,
      query: request.nextUrl.search || '',
    });

    await tursoClient.execute({
      sql: `
        INSERT INTO tracking_events (event_type, value, session_id, source, metadata)
        VALUES ('affiliate_click', 0, ?, 'affiliate_redirect', ?)
      `,
      args: [sessionId, metadata],
    });

    await tursoClient.execute({
      sql: 'UPDATE affiliate_links SET clicks = clicks + 1 WHERE id = ?',
      args: [affiliateId],
    });

    return NextResponse.redirect(targetUrl, { status: 302 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
