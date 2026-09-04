import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://herdbrake-taiwan.agentje0407.chatgpt.site'),
  title: 'HerdBrake Taiwan · Agentic Payment Assurance',
  description: 'Detect coordinated treasury-agent risk before money moves.',
  openGraph: {
    title: 'HerdBrake Taiwan',
    description: 'Detect the herd. Hold before money moves.',
    type: 'website',
    locale: 'zh_TW',
    images: [{ url: '/herdbrake-og.svg', width: 1200, height: 630, alt: 'HerdBrake Taiwan agentic payment assurance' }],
  },
  twitter: { card: 'summary_large_image', title: 'HerdBrake Taiwan', description: 'Detect the herd. Hold before money moves.', images: ['/herdbrake-og.svg'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant" className="dark"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
