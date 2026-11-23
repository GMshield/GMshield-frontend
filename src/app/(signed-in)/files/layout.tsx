import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { sectionMetadata } from '../section-metadata';

/** Every page of this section is titled after its sidebar entry (usability pass, 2026-11-21). */
export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('files');
}

export default function SectionLayout({ children }: { readonly children: ReactNode }) {
  return children;
}
