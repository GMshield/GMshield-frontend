'use client';

import { useId } from 'react';

import { translator, type Language } from '@/messages';
import { PAGE_SIZES } from '@/paging';
import { VIEW_DENSITIES, VIEW_LAYOUTS, type ListView } from '@/view-cookie';

import { NamedIcon } from './Icons';
import { useDisclosure } from './useDisclosure';
import styles from './ViewMenu.module.css';

export type ViewMenuProps = {
  readonly view: ListView;
  readonly language: Language;
  /** Whether the list has thumbnails to show or hide (the files). */
  readonly previews?: boolean;
  /** Whether the list is paged, so the rows a page holds can be chosen. */
  readonly sizes?: boolean;
  readonly onChange: (view: ListView) => void;
};

/**
 * "Exibição" (usability pass, 2026-11-21): the display options of a list, in one menu at the right of its toolbar. A
 * disclosure button opens a small panel of labelled groups: the layout (list or grid), the spacing (comfortable or
 * compact), for a paged list how many rows a page holds, and, for the files, whether thumbnails show. Each choice applies at once and is remembered in this browser.
 * Esc, with focus in the button or the panel, closes it and gives focus back to the button; a press outside closes it.
 */
export function ViewMenu({ view, language, previews = false, sizes = false, onChange }: ViewMenuProps) {
  const t = translator(language);
  const { open, setOpen, container, button } = useDisclosure();
  const id = useId();

  return (
    <div ref={container} className={styles.menu}>
      <button ref={button} type="button" className={styles.trigger} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <NamedIcon name="view" size={18} />
        {t('view.menu')}
        <NamedIcon name="chevronDown" size={16} />
      </button>
      <div id={id} role="group" aria-label={t('view.menu')} className={styles.panel} hidden={!open}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('view.layout')}</legend>
          <div className={styles.segments}>
            {VIEW_LAYOUTS.map((layout) => (
              <label key={layout} className={styles.segment}>
                <input
                  type="radio"
                  name={`${id}-layout`}
                  className={styles.radio}
                  checked={view.layout === layout}
                  onChange={() => onChange({ ...view, layout })}
                />
                <span className={styles.segmentLabel}>
                  <NamedIcon name={layout} size={18} />
                  {t(`view.${layout}`)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('view.density')}</legend>
          <div className={styles.segments}>
            {VIEW_DENSITIES.map((density) => (
              <label key={density} className={styles.segment}>
                <input
                  type="radio"
                  name={`${id}-density`}
                  className={styles.radio}
                  checked={view.density === density}
                  onChange={() => onChange({ ...view, density })}
                />
                <span className={styles.segmentLabel}>{t(`view.${density}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {sizes ? (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>{t('view.perPage')}</legend>
            <div className={styles.segments}>
              {PAGE_SIZES.map((size) => (
                <label key={size} className={styles.segment}>
                  <input
                    type="radio"
                    name={`${id}-size`}
                    className={styles.radio}
                    checked={view.size === size}
                    onChange={() => onChange({ ...view, size })}
                  />
                  <span className={styles.segmentLabel}>{size}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {previews ? (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>{t('view.previews')}</legend>
            <label className={styles.check}>
              <input type="checkbox" checked={view.previews} onChange={(event) => onChange({ ...view, previews: event.target.checked })} />
              {t('view.showPreviews')}
            </label>
          </fieldset>
        ) : null}
      </div>
    </div>
  );
}
