import './globals.css'
import localFont from 'next/font/local'
import { LOGO } from '@/lib/brand'

const poppins = localFont({
  src: [
    { path: './fonts/Poppins-Regular.woff2', weight: '400' },
    { path: './fonts/Poppins-Bold.woff2', weight: '700' },
  ],
})

const title = 'Review — Cascade Online'
const description = 'Preview your new site and leave feedback right on the page.'

export const metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'https://review.cascadeonline.dev'),
  title,
  description,
  // ponytail: private links — keep them out of search results.
  robots: { index: false, follow: false },
  openGraph: { title, description, images: [LOGO], siteName: 'Cascade Online Design', type: 'website' },
  twitter: { card: 'summary', title, description, images: [LOGO] },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={poppins.className}>{children}</body>
    </html>
  )
}
