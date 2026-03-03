import { NextRequest, NextResponse } from 'next/server';
import { runEvolutionCycle } from '@/lib/brain';
import tursoClient from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'evolve') {
      // Trigger full evolution cycle
      const result = await runEvolutionCycle();
      return NextResponse.json({
        success: true,
        message: 'Evolution cycle completed',
        data: result,
      });
    }

    if (action === 'status') {
      // Get current system status
      const status = await getSystemStatus();
      return NextResponse.json({
        success: true,
        data: status,
      });
    }

    if (action === 'logs') {
      // Get recent activity logs
      const logs = await getRecentLogs();
      return NextResponse.json({
        success: true,
        data: logs,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const status = await getSystemStatus();
    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

async function getSystemStatus() {
  try {
    // Get recent logs
    const logsResult = await tursoClient.execute({
      sql: 'SELECT * FROM logs ORDER BY created_at DESC LIMIT 10',
      args: [],
    });

    // Get latest metrics
    const metricsResult = await tursoClient.execute({
      sql: 'SELECT * FROM growth_metrics ORDER BY created_at DESC LIMIT 5',
      args: [],
    });

    // Get evolution history
    const evolutionResult = await tursoClient.execute({
      sql: 'SELECT * FROM evolution_history ORDER BY created_at DESC LIMIT 5',
      args: [],
    });

    // Get active content
    const contentResult = await tursoClient.execute({
      sql: 'SELECT * FROM dynamic_content WHERE is_active = 1 ORDER BY updated_at DESC',
      args: [],
    });

    return {
      lastActivity: logsResult.rows[0]?.created_at || null,
      recentLogs: logsResult.rows,
      latestMetrics: metricsResult.rows,
      evolutionHistory: evolutionResult.rows,
      activeContent: contentResult.rows,
      systemHealth: 'operational',
    };
  } catch (error) {
    return {
      systemHealth: 'degraded',
      error: String(error),
    };
  }
}

async function getRecentLogs() {
  try {
    const result = await tursoClient.execute({
      sql: 'SELECT * FROM logs ORDER BY created_at DESC LIMIT 50',
      args: [],
    });
    return result.rows;
  } catch (error) {
    return [];
  }
}
