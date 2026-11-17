'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from 'react';

import { checkFile, type FileCheck } from '@/client/upload/sniff';

import { PillButton, SolidPillButton } from '../PillButton';
import { StatePill } from '../StatePill';

import {
  fill,
  formatSize,
  KINDS,
  problemText,
  UPLOAD_LANGUAGES,
  type Answers,
  type BelongingChoice,
  type Kind,
  type UploadLanguage,
  type UploadTexts,
} from './types';
import styles from './Uploads.module.css';
import { useUploads, type LiveUpload } from './UploadsProvider';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** The questions; the progress after them is not counted. */
const QUESTIONS = 4;

type Chosen = { readonly id: number; readonly file: File; readonly check: FileCheck | null };

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
  const [place, setPlace] = useState<BelongingChoice>(belonging === null ? 'none' : 'campaign');
  const [language, setLanguage] = useState<UploadLanguage>('detect');
  const [batch, setBatch] = useState<number | null>(null);
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
    }
  }

  // Each step's first control takes focus, so the keyboard goes on from the question.
  useEffect(() => {
    if (open) {
      dialogRef.current?.querySelector<HTMLElement>(`fieldset input:checked, [data-step-focus]`)?.focus();
    }
  }, [step, open]);

  const accepted = chosen.filter((item) => item.check?.ok === true).map((item) => item.file);
  const checking = chosen.some((item) => item.check === null);

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
    setBatch(send(accepted, answers));
    setStep(QUESTIONS + 1);
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
        <span className={styles.choiceText}>
          <span className={styles.choiceLabel}>{label}</span>
          <span className={styles.choiceDescription}>{description}</span>
        </span>
      </label>
    </li>
  );

  const sending = live.filter((upload) => batch !== null && upload.batch === batch);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onKeyDown={onKeyDown} onCancel={onNativeCancel}>
      <div className={styles.dialogHead}>
        <div>
          <h2 id={titleId} className={styles.title}>
            {step > QUESTIONS ? t.progress.title : t.title}
          </h2>
          {step > QUESTIONS ? null : <p className={styles.step}>{fill(t.step, { step, total: QUESTIONS })}</p>}
        </div>
        <button type="button" className={styles.close} aria-label={t.close} onClick={onClose}>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="16" height="16">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>

      {step === 1 ? (
        <section aria-labelledby={`${titleId}-files`}>
          <h3 id={`${titleId}-files`} className={styles.legend}>
            {t.files.question}
          </h3>
          <p className={styles.lead}>{t.files.lead}</p>
          <input ref={inputRef} type="file" multiple hidden onChange={(event) => void onFiles(event)} data-testid="upload-files" />
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

      {step === 2 ? (
        <fieldset className={styles.question}>
          <legend className={styles.legend}>{t.kind.question}</legend>
          <ul className={styles.choices}>
            {KINDS.map((value) => choice('kind', value, kind, setKind, t.kind[value].label, t.kind[value].description))}
          </ul>
        </fieldset>
      ) : null}

      {step === 3 ? (
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

      {step === 4 ? (
        <fieldset className={styles.question}>
          <legend className={styles.legend}>{t.language.question}</legend>
          <ul className={styles.choices}>
            {UPLOAD_LANGUAGES.map((value) => choice('language', value, language, setLanguage, t.language[value].label, t.language[value].description))}
          </ul>
        </fieldset>
      ) : null}

      {step > QUESTIONS ? (
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
        {step > 1 && step <= QUESTIONS ? <PillButton onClick={() => setStep(step - 1)}>{t.back}</PillButton> : null}
        {step < QUESTIONS ? (
          <SolidPillButton disabled={step === 1 && (accepted.length === 0 || checking)} onClick={() => setStep(step + 1)}>
            {t.next}
          </SolidPillButton>
        ) : null}
        {step === QUESTIONS ? <SolidPillButton onClick={onSend}>{t.send}</SolidPillButton> : null}
        {step > QUESTIONS ? (
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
