'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type SyntheticEvent } from 'react';

import { checkFile, type FileCheck } from '@/client/upload/sniff';

import { PillButton, SolidPillButton } from '../PillButton';
import { StatePill } from '../StatePill';

import {
  fill,
  formatSize,
  isImageFormat,
  KINDS,
  MAX_SET_BYTES,
  MAX_SET_IMAGES,
  problemText,
  SHOWN_FORMATS,
  UPLOAD_LANGUAGES,
  withoutExtension,
  type Answers,
  type BelongingChoice,
  type ImageFormat,
  type Kind,
  type UploadLanguage,
  type UploadTexts,
} from './types';
import styles from './Uploads.module.css';
import { useUploads, type LiveUpload } from './UploadsProvider';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Chosen = { readonly id: number; readonly file: File; readonly check: FileCheck | null };
/** The dialog's questions, in order (Story 1.21 adds the set question and the page order for several images). */
type StepName = 'files' | 'set' | 'order' | 'kind' | 'belonging' | 'language';
type SetMode = 'pages' | 'separate';
/** What the file picker offers (any file can still be chosen: the check decides). */
const ACCEPT = '.pdf,.txt,.md,.markdown,.jpg,.jpeg,.png,.webp,.tif,.tiff,.bmp,.heic,.heif,application/pdf,text/plain,text/markdown,image/*';
const FORMAT_LABELS: Readonly<Record<ImageFormat, string>> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', tiff: 'TIFF', bmp: 'BMP', heic: 'HEIC' };

function imageFormatOf(item: Chosen): ImageFormat | null {
  const format = item.check?.ok === true ? item.check.format : null;
  return isImageFormat(format) ? format : null;
}

export type UploadDialogProps = {
  readonly open: boolean;
  /** Called by "Fechar" and by Esc; the sidebar gives focus back to "Adicionar Arquivo". */
  readonly onClose: () => void;
};

/**
 * The guided upload (Story 1.14): a 560px modal dialog, one question per step with its count ("Passo N de 4"), each
 * choice a full-width row with its explanation: the files, what they are, where they belong (the current campaign or
 * its system), their language; then the progress. Built like `ConfirmationDialog`: `showModal()`, Tab kept inside,
 * Esc closes (and is marked handled, so the sidebar does not also close). It never opens another dialog. Closing it
 * never stops an upload: those belong to the provider.
 *
 * A chosen file is checked at once in the browser ({@link checkFile}); a refused one is named with its reason and the
 * accepted formats, announced at once, and never sent.
 *
 * Story 1.21: with two or more images chosen, a step asks whether they are the pages of one material (the default) or
 * each a material; other files stay materials of their own. As pages, an order step follows: the material's name
 * (the first image's file name without its extension), and the images in a list the GM reorders by dragging them, by
 * their "Subir" and "Descer" buttons, or with Alt+↑ and Alt+↓ on a focused row; each move is announced politely
 * ("foto-2.jpg, página 3 de 5"). A thumbnail shows the images a browser can show; HEIC and TIFF get their format's
 * name. Past 500 images or 2 GB in all the set is refused here with the limit. "Enviar" confirms the order: it never
 * changes afterwards.
 */
export function UploadDialog({ open, onClose }: UploadDialogProps) {
  const { texts, belonging, live, send, announce } = useUploads();
  const t = texts.upload.dialog;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [step, setStep] = useState(1);
  const [chosen, setChosen] = useState<readonly Chosen[]>([]);
  const [kind, setKind] = useState<Kind>('rulebook');
  const [chosenPlace, setPlace] = useState<BelongingChoice>(belonging === null ? 'none' : 'campaign');
  // The campaign can come or go while the dialog stays mounted: the choice follows what there is to choose.
  const place: BelongingChoice = belonging === null ? 'none' : chosenPlace === 'none' ? 'campaign' : chosenPlace;
  const [language, setLanguage] = useState<UploadLanguage>('detect');
  const [batch, setBatch] = useState<number | null>(null);
  const [setMode, setSetMode] = useState<SetMode>('pages');
  const [order, setOrder] = useState<readonly number[]>([]);
  const [setName, setSetName] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const focusAfterMove = useRef<{ readonly id: number; readonly target: 'up' | 'down' } | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // A new opening starts again from the files (state adjusted while rendering, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setStep(1);
      setChosen([]);
      setBatch(null);
      setSetMode('pages');
      setOrder([]);
      setSetName(null);
    }
  }

  // Each step's first control takes focus, so the keyboard goes on from the question.
  useEffect(() => {
    if (open) {
      dialogRef.current?.querySelector<HTMLElement>(`fieldset input:checked, [data-step-focus]`)?.focus();
    }
  }, [step, open]);

  const acceptedItems = chosen.filter((item) => item.check?.ok === true);
  const imageItems = acceptedItems.filter((item) => imageFormatOf(item) !== null);
  const otherFiles = acceptedItems.filter((item) => imageFormatOf(item) === null).map((item) => item.file);
  const checking = chosen.some((item) => item.check === null);
  const asSet = imageItems.length >= 2 && setMode === 'pages';
  // The order the GM set, then any image chosen since, in the order chosen.
  const imageIds = imageItems.map((item) => item.id);
  const orderedIds = [...order.filter((id) => imageIds.includes(id)), ...imageIds.filter((id) => !order.includes(id))];
  const ordered = orderedIds.flatMap((id) => imageItems.filter((item) => item.id === id));
  const name = setName ?? (ordered[0] === undefined ? '' : withoutExtension(ordered[0].file.name));
  const setBytes = ordered.reduce((sum, item) => sum + item.file.size, 0);
  const tooMany = ordered.length > MAX_SET_IMAGES;
  const tooLarge = setBytes > MAX_SET_BYTES;
  const nameMissing = name.trim() === '';
  const steps: readonly StepName[] = [
    'files',
    ...(imageItems.length >= 2 ? (['set'] as const) : []),
    ...(asSet ? (['order'] as const) : []),
    'kind',
    'belonging',
    'language',
  ];
  const current: StepName | null = steps[step - 1] ?? null;
  const questions = steps.length;

  // After a keyboard move the row's button takes focus again (React moves the row in the page, which loses focus): the
  // same one, or the other when the move disabled it (at the top or the bottom).
  useEffect(() => {
    const target = focusAfterMove.current;
    if (target === null) {
      return;
    }
    focusAfterMove.current = null;
    const row = dialogRef.current?.querySelector<HTMLElement>(`[data-image-id="${target.id}"]`);
    const button =
      row?.querySelector<HTMLButtonElement>(`[data-move="${target.target}"]:not([disabled])`) ?? row?.querySelector<HTMLButtonElement>('[data-move]:not([disabled])');
    button?.focus();
  });

  function move(id: number, to: number, focus: 'up' | 'down' | null) {
    const from = orderedIds.indexOf(id);
    if (from < 0 || to < 0 || to >= orderedIds.length || from === to) {
      return;
    }
    const next = [...orderedIds];
    next.splice(from, 1);
    next.splice(to, 0, id);
    setOrder(next);
    focusAfterMove.current = focus === null ? null : { id, target: focus };
    const item = ordered[from];
    if (item !== undefined) {
      announce(fill(t.order.moved, { name: item.file.name, page: to + 1, total: next.length }));
    }
  }

  /** Alt+↑ and Alt+↓ on a row's "Subir" or "Descer" (the row's focusable controls) move its image. */
  function onRowKeyDown(event: KeyboardEvent<HTMLLIElement>, id: number, index: number) {
    const control = (event.target as HTMLElement).dataset.move;
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || (control !== 'up' && control !== 'down')) {
      return;
    }
    event.preventDefault();
    move(id, event.key === 'ArrowUp' ? index - 1 : index + 1, control);
  }

  function onDragStart(event: DragEvent<HTMLLIElement>, id: number) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(id));
    setDragging(id);
  }

  function onDragOver(event: DragEvent<HTMLLIElement>) {
    if (dragging !== null) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function onDrop(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault();
    const id = dragging ?? Number(event.dataTransfer.getData('text/plain'));
    setDragging(null);
    if (Number.isInteger(id)) {
      move(id, index, null);
    }
  }

  const blocked =
    (current === 'files' && (acceptedItems.length === 0 || checking)) || (current === 'order' && (tooMany || tooLarge || nameMissing));

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    const added = files.map((file) => ({ id: nextId.current++, file, check: null }));
    setChosen((all) => [...all, ...added]);
    for (const item of added) {
      const check = await checkFile(item.file);
      setChosen((all) => all.map((other) => (other.id === item.id ? { ...other, check } : other)));
      if (!check.ok) {
        announce(fill(t.files.refused[check.reason], { name: item.file.name }), true);
      }
    }
  }

  function onSend() {
    const answers: Answers = { kind, belonging: place, language };
    // An image that is not a page of a set is a set of one, named as a file is.
    const sets = asSet
      ? [{ name: name.trim(), files: ordered.map((item) => item.file) }]
      : imageItems.map((item) => ({ name: item.file.name, files: [item.file] }));
    setBatch(send({ files: otherFiles, sets }, answers));
    setStep(questions + 1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      trapTab(event);
    }
  }

  function onNativeCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onClose();
  }

  const choice = <T extends string>(name: string, value: T, current: T, set: (value: T) => void, label: string, description: string) => (
    <li key={value}>
      <label className={styles.choice}>
        <input type="radio" name={name} value={value} checked={current === value} onChange={() => set(value)} />
        <span className={styles.choiceLabel}>{label}</span>
        <span className={styles.choiceDescription}>{description}</span>
      </label>
    </li>
  );

  const sending = live.filter((upload) => batch !== null && upload.batch === batch);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onKeyDown={onKeyDown} onCancel={onNativeCancel}>
      <div className={styles.dialogHead}>
        <div>
          <h2 id={titleId} className={styles.title}>
            {current === null ? t.progress.title : t.title}
          </h2>
          {current === null ? null : <p className={styles.step}>{fill(t.step, { step, total: questions })}</p>}
        </div>
        <button type="button" className={styles.close} aria-label={t.close} onClick={onClose}>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="16" height="16">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>

      {current === 'files' ? (
        <section aria-labelledby={`${titleId}-files`}>
          <h3 id={`${titleId}-files`} className={styles.legend}>
            {t.files.question}
          </h3>
          <p className={styles.lead}>{t.files.lead}</p>
          <input ref={inputRef} type="file" multiple hidden accept={ACCEPT} onChange={(event) => void onFiles(event)} data-testid="upload-files" />
          <PillButton data-step-focus="" onClick={() => inputRef.current?.click()}>
            {t.files.choose}
          </PillButton>
          {chosen.length === 0 ? (
            <p className={styles.note}>{t.files.none}</p>
          ) : (
            <ul className={styles.files}>
              {chosen.map((item) => (
                <li key={item.id} className={styles.file}>
                  <ChosenFile item={item} texts={t.files} language={texts.language} />
                  <PillButton
                    aria-label={fill(t.files.remove, { name: item.file.name })}
                    onClick={() => setChosen((all) => all.filter((other) => other.id !== item.id))}
                  >
                    {t.files.removeShort}
                  </PillButton>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {current === 'set' ? (
        <fieldset className={styles.question}>
          <legend className={styles.legend}>{fill(t.set.question, { count: imageItems.length })}</legend>
          <ul className={styles.choices}>
            {choice('set', 'pages', setMode, setSetMode, t.set.pages.label, t.set.pages.description)}
            {choice('set', 'separate', setMode, setSetMode, t.set.separate.label, t.set.separate.description)}
          </ul>
        </fieldset>
      ) : null}

      {current === 'order' ? (
        <section aria-labelledby={`${titleId}-order`}>
          <h3 id={`${titleId}-order`} className={styles.legend}>
            {t.order.question}
          </h3>
          <p className={styles.lead}>{t.order.lead}</p>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t.order.name}</span>
            <input
              className={styles.text}
              type="text"
              value={name}
              maxLength={255}
              required
              aria-invalid={nameMissing}
              onChange={(event) => setSetName(event.target.value)}
              data-step-focus=""
            />
          </label>
          {nameMissing ? (
            <p className={styles.note} role="alert">
              {t.order.nameRequired}
            </p>
          ) : null}
          {tooMany || tooLarge ? (
            <p className={styles.note} role="alert">
              {tooMany
                ? fill(t.order.tooMany, { count: ordered.length, limit: MAX_SET_IMAGES })
                : fill(t.order.tooLarge, { size: formatSize(setBytes, texts.language) })}
            </p>
          ) : null}
          <ol className={styles.pages} aria-label={t.order.list}>
            {ordered.map((item, index) => {
              const format = imageFormatOf(item) ?? 'jpeg';
              const fileName = item.file.name;
              return (
                <li
                  key={item.id}
                  className={styles.pageRow}
                  data-image-id={item.id}
                  data-dragging={dragging === item.id ? 'true' : undefined}
                  draggable
                  aria-label={fill(t.order.row, { name: fileName, page: index + 1, total: ordered.length })}
                  onKeyDown={(event) => onRowKeyDown(event, item.id, index)}
                  onDragStart={(event) => onDragStart(event, item.id)}
                  onDragOver={onDragOver}
                  onDrop={(event) => onDrop(event, index)}
                  onDragEnd={() => setDragging(null)}
                >
                  <Thumbnail file={item.file} format={format} />
                  <span className={styles.pageText}>
                    <span className={styles.pageNumber} id={`${titleId}-page-${item.id}`}>
                      {fill(t.order.page, { page: index + 1 })}
                    </span>
                    <span className={styles.name}>{fileName}</span>
                  </span>
                  <span className={styles.moves}>
                    <PillButton data-move="up" aria-label={fill(t.order.up, { name: fileName })} aria-describedby={`${titleId}-page-${item.id}`} disabled={index === 0} onClick={() => move(item.id, index - 1, index - 1 === 0 ? 'down' : 'up')}>
                      {t.order.upShort}
                    </PillButton>
                    <PillButton
                      data-move="down"
                      aria-label={fill(t.order.down, { name: fileName })}
                      aria-describedby={`${titleId}-page-${item.id}`}
                      disabled={index === ordered.length - 1}
                      onClick={() => move(item.id, index + 1, index + 1 === ordered.length - 1 ? 'up' : 'down')}
                    >
                      {t.order.downShort}
                    </PillButton>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {current === 'kind' ? (
        <fieldset className={styles.question}>
          <legend className={styles.legend}>{t.kind.question}</legend>
          <ul className={styles.choices}>
            {KINDS.map((value) => choice('kind', value, kind, setKind, t.kind[value].label, t.kind[value].description))}
          </ul>
        </fieldset>
      ) : null}

      {current === 'belonging' ? (
        <fieldset className={styles.question}>
          <legend className={styles.legend}>{t.belonging.question}</legend>
          <ul className={styles.choices}>
            {belonging === null
              ? choice('belonging', 'none', place, setPlace, t.belonging.none.label, t.belonging.none.description)
              : [
                  choice('belonging', 'campaign', place, setPlace, fill(t.belonging.campaign.label, { campaign: belonging.campaign.name }), t.belonging.campaign.description),
                  choice('belonging', 'system', place, setPlace, fill(t.belonging.system.label, { system: belonging.system.name }), t.belonging.system.description),
                ]}
          </ul>
        </fieldset>
      ) : null}

      {current === 'language' ? (
        <fieldset className={styles.question}>
          <legend className={styles.legend}>{t.language.question}</legend>
          <ul className={styles.choices}>
            {UPLOAD_LANGUAGES.map((value) => choice('language', value, language, setLanguage, t.language[value].label, t.language[value].description))}
          </ul>
        </fieldset>
      ) : null}

      {current === null ? (
        <section>
          <p className={styles.lead}>{t.progress.lead}</p>
          <ul className={styles.files}>
            {sending.map((upload) => (
              <SendingFile key={upload.key} upload={upload} />
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.dialogActions}>
        {step > 1 && current !== null ? <PillButton onClick={() => setStep(step - 1)}>{t.back}</PillButton> : null}
        {current !== null && step < questions ? (
          <SolidPillButton disabled={blocked} onClick={() => setStep(step + 1)}>
            {t.next}
          </SolidPillButton>
        ) : null}
        {current !== null && step === questions ? <SolidPillButton onClick={onSend}>{t.send}</SolidPillButton> : null}
        {current === null ? (
          <SolidPillButton data-step-focus="" onClick={onClose}>
            {t.close}
          </SolidPillButton>
        ) : null}
      </div>
    </dialog>
  );
}

function ChosenFile({
  item,
  texts,
  language,
}: {
  readonly item: Chosen;
  readonly texts: UploadTexts['upload']['dialog']['files'];
  readonly language: UploadTexts['language'];
}) {
  const name = item.file.name;
  if (item.check === null) {
    return <p className={styles.refused}>{fill(texts.checking, { name })}</p>;
  }
  if (!item.check.ok) {
    return (
      <p className={styles.refused}>
        <span className={styles.refusedWord}>{texts.refusedWord}</span> {fill(texts.refused[item.check.reason], { name })}
      </p>
    );
  }
  return (
    <p className={styles.refused}>
      <span className={styles.name}>{name}</span> · {formatSize(item.file.size, language)} · {texts.accepted}
    </p>
  );
}

/**
 * A small picture of an image the browser can show (JPG, PNG, WebP, BMP), drawn on a canvas (the page's policy allows
 * no other image source) and turned upright by its EXIF orientation; HEIC and TIFF, which browsers do not show, get
 * their format's name instead.
 */
function Thumbnail({ file, format }: { readonly file: File; readonly format: ImageFormat }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shown = SHOWN_FORMATS.has(format) && typeof globalThis.createImageBitmap === 'function';
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!shown || canvas === null) {
      return;
    }
    let cancelled = false;
    globalThis
      .createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: THUMBNAIL * 2, resizeQuality: 'low' })
      .then(
        (bitmap) => {
          const context = canvas.getContext('2d');
          if (!cancelled && context !== null) {
            const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
            const width = bitmap.width * scale;
            const height = bitmap.height * scale;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
          }
          bitmap.close();
        },
        () => undefined,
      );
    return () => {
      cancelled = true;
    };
  }, [file, shown]);
  if (!shown) {
    return (
      <span className={styles.thumbnail} data-placeholder="" aria-hidden="true">
        {FORMAT_LABELS[format]}
      </span>
    );
  }
  // The canvas sits in a hidden span: it is never focusable, and a screen reader skips it.
  return (
    <span className={styles.thumbnail} aria-hidden="true">
      <canvas ref={canvasRef} width={THUMBNAIL * 2} height={THUMBNAIL * 2} />
    </span>
  );
}

/** A thumbnail's side in CSS pixels (drawn at twice that for sharp screens). */
const THUMBNAIL = 48;

function SendingFile({ upload }: { readonly upload: LiveUpload }) {
  const { texts } = useUploads();
  const state = upload.phase === 'failed' ? 'failed' : upload.phase === 'waiting' ? 'waiting' : 'uploading';
  const percent = upload.size > 0 ? Math.floor((upload.sent / upload.size) * 100) : 0;
  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.name}>{upload.name}</span>
        <StatePill state={state} word={texts.states[state]} />
      </div>
      <progress className={styles.line} value={upload.sent} max={Math.max(upload.size, 1)} aria-label={fill(texts.upload.tray.sent, { percent })} />
      {upload.phase === 'failed' ? <p className={styles.note}>{problemText(upload.problem, texts.errors)}</p> : null}
    </li>
  );
}

function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
  const dialog = event.currentTarget;
  const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.hidden);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !(active instanceof Node) || !dialog.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}
