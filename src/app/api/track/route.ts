import { NextRequest, NextResponse } from 'next/server';
import tursoClient, { initializeDatabase } from '@/lib/db';

type TrackEventType = 'page_view' | 'affiliate_click' | 'affiliate_sale' | 'saas_sale';

interface TrackPayload {
  eventType?: string;
  value?: number;
  sessionId?: string;
  source?: string;
  affiliateId?: number;
  metadata?: Record<string, unknown>;
}

const ALLOWED_EVENTS: TrackEventType[] = ['page_view', 'affiliate_click', 'affiliate_sale', 'saas_sale'];

function normalizeEventType(value: unknown): TrackEventType | null {
  const eventType = String(value || '').trim().toLowerCase();
  return ALLOWED_EVENTS.includes(eventType as TrackEventType) ? (eventType as TrackEventType) : null;
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();

    const body = (await request.json()) as TrackPayload;
    const eventType = normalizeEventType(body.eventType);

    if (!eventType) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid eventType. Allowed: page_view, affiliate_click, affiliate_sale, saas_sale',
        },
        { status: 400 }
      );
    }

    const value = Math.max(0, safeNumber(body.value));
    const affiliateId = Math.trunc(safeNumber(body.affiliateId));
    const source = String(body.source || 'web').slice(0, 64);
    const sessionId = String(body.sessionId || '').slice(0, 128) || null;
    const metadata = JSON.stringify({
      ...(body.metadata || {}),
      affiliateId: affiliateId > 0 ? affiliateId : null,
    });

    await tursoClient.execute({
      sql: `
        INSERT INTO tracking_events (event_type, value, session_id, source, metadata)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [eventType, value, sessionId, source, metadata],
    });

    if (affiliateId > 0 && eventType === 'affiliate_click') {
      await tursoClient.execute({
        sql: 'UPDATE affiliate_links SET clicks = clicks + 1 WHERE id = ?',
        args: [affiliateId],
      });
    }

    if (affiliateId > 0 && eventType === 'affiliate_sale') {
      await tursoClient.execute({
        sql: 'UPDATE affiliate_links SET revenue = revenue + ? WHERE id = ?',
        args: [value, affiliateId],
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        eventType,
        value,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
