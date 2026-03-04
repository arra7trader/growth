import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Aether Auto-SaaS | Autonomous Growth System',
  description: 'Autonomous profit-generating web entity with self-coding capabilities',
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
