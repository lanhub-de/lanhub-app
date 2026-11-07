import type { MetadataRoute } from 'next';

// Lets people add LanHub to their phone or computer as an app icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LanHub',
    short_name: 'LanHub',
    start_url: '/',
    display: 'standalone',
    background_color: '#fbf8f5',
    theme_color: '#a30000',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
