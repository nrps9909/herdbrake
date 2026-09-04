import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://herdbrake-taiwan.agentje0407.chatgpt.site'),
  title: 'HerdBrake Taiwan · Stop the herd before money moves',
  description: 'Pre-execution safety for agentic finance. Detect aggregate treasury risk, hold unsafe payment batches, and release safely with human authorization.',
  openGraph: {
    title: 'HerdBrake Taiwan',
    description: 'Pre-execution safety for agentic finance.',
    type: 'website',
    locale: 'zh_TW',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HerdBrake Taiwan — Stop the herd before money moves' }],
  },
  twitter: { card: 'summary_large_image', title: 'HerdBrake Taiwan', description: 'Stop the herd before money moves.', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant" className="dark"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
