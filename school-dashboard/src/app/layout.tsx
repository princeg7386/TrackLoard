import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'School Bus Transport Management Platform',
  description: 'Production-grade school bus transport safety and fleet operations platform',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-slate-50">
      <body className="h-full antialiased font-sans flex flex-col">{children}</body>
    </html>
  );
}
