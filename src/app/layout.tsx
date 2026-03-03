import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Aether Auto-SaaS | Autonomous Growth System",
  description: "Autonomous profit-generating web entity with self-coding capabilities",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
