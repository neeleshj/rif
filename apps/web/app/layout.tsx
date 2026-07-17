import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RIF Mutant Detector',
  description:
    'Enter an N x N DNA grid and detect whether the sequence belongs to a mutant. A Rent It Furnished technical test.',
};

export const viewport: Viewport = {
  themeColor: '#060d0b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
