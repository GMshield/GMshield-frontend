'use client';

import { useState } from 'react';

import { NamedIcon, type IconName } from './Icons';
import styles from './ItemList.module.css';

/**
 * A material's first page as a small picture (usability pass, 2026-11-21), from this site's picture relay. Decorative:
 * the row's name says what it is. It loads when it nears the screen; a material whose first page has no picture (a
 * text file) shows the list's icon instead, as does a picture that fails to load.
 */
export function Thumbnail({ src, icon }: { readonly src: string; readonly icon: IconName }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <NamedIcon name={icon} size={22} />;
  }
  // A plain <img>: the picture comes from this site's own relay with the visitor's session cookie, which the image
  // optimizer (a server-side fetch without that cookie) could not read.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.thumbnail} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
