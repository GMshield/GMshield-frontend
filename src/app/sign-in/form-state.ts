/** What the username form shows after a refused try: the text, the field it is about, and what was typed. */
export type UsernameFormState = {
  readonly username: string;
  readonly termsAccepted: boolean;
  readonly error: string | null;
  readonly field: 'username' | 'terms' | null;
};

export const INITIAL_USERNAME_FORM: UsernameFormState = { username: '', termsAccepted: false, error: null, field: null };
